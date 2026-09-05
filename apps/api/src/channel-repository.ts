import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { channelBindingSchema, channelEnvelopeSchema, pairingSessionSchema, type ChannelBinding, type ChannelEnvelope, type PairingSession } from "@niuma/contracts";
import { consumePairingSession, createPairingSession, normalizeExpiry, transitionPairingSession } from "@niuma/channel-adapter";
import { migrations } from "./migrations.js";
import { compareSemver, modelRouteInputSchema, type ModelRoute, type ModelRouteInput } from "./model-catalog.js";

export class ChannelRepository {
  constructor(readonly pool: Pool) {}
  async migrate() { await this.pool.query(migrations); }
  async close() { await this.pool.end(); }

  async registerDevice(id: string, publicKeyPem: string) {
    const existing = await this.pool.query<{ public_key_pem: string }>("SELECT public_key_pem FROM device_installations WHERE id=$1", [id]);
    if (existing.rowCount && existing.rows[0]!.public_key_pem !== publicKeyPem) throw new Error("设备身份已存在且公钥不匹配");
    await this.pool.query("INSERT INTO device_installations(id,public_key_pem) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET last_seen_at=now()", [id, publicKeyPem]);
  }
  async publicKey(deviceId: string) { return (await this.pool.query<{ public_key_pem: string }>("SELECT public_key_pem FROM device_installations WHERE id=$1", [deviceId])).rows[0]?.public_key_pem; }

  async createModelSession(deviceId: string, tokenHash: string, expiresAt: Date, clientVersion = "0.1.0", now = new Date()) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const recent = await client.query("SELECT count(*)::int AS count FROM model_gateway_sessions WHERE device_installation_id=$1 AND created_at>$2", [deviceId, new Date(now.getTime() - 60 * 60_000).toISOString()]);
      if (Number(recent.rows[0]?.count ?? 0) >= 20) throw new Error("模型会话创建过于频繁，请稍后重试");
      await client.query("UPDATE model_gateway_sessions SET revoked_at=$2 WHERE device_installation_id=$1 AND revoked_at IS NULL AND expires_at<=$2", [deviceId, now.toISOString()]);
      const id = randomUUID();
      await client.query("INSERT INTO model_gateway_sessions(id,token_hash,device_installation_id,created_at,expires_at,client_version) VALUES($1,$2,$3,$4,$5,$6)", [id, tokenHash, deviceId, now.toISOString(), expiresAt.toISOString(), clientVersion]);
      await client.query("COMMIT");
      return { id, expiresAt: expiresAt.toISOString() };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async consumeModelSession(tokenHash: string, now = new Date()) {
    const result = await this.pool.query<{ device_installation_id: string; client_version: string }>("UPDATE model_gateway_sessions SET request_count=request_count+1,last_used_at=$2 WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>$2 AND request_count<max_requests RETURNING device_installation_id,client_version", [tokenHash, now.toISOString()]);
    const row = result.rows[0]; return row ? { deviceInstallationId: row.device_installation_id, clientVersion: row.client_version } : undefined;
  }

  async listModelRoutes() { return (await this.pool.query("SELECT * FROM model_routes ORDER BY logical_model_id,sort_order,fallback_priority,created_at")).rows.map(toModelRoute); }

  async createModelRoute(raw: ModelRouteInput, actor: string, idempotencyKey: string, now = new Date()) {
    const input = modelRouteInputSchema.parse(raw); const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const repeated = (await client.query("SELECT operation,response FROM admin_idempotency_keys WHERE key=$1 FOR UPDATE", [idempotencyKey])).rows[0];
      if (repeated) { if (repeated.operation !== "model-route.create") throw new Error("幂等键已用于其他操作"); await client.query("COMMIT"); return { ...repeated.response, repeated: true } as { route: ModelRoute; repeated: boolean }; }
      const id = randomUUID(); const values = modelRouteValues(input);
      const row = (await client.query(`INSERT INTO model_routes(id,logical_model_id,display_name,provider,provider_model_id,endpoint,capabilities,input_price_microunits_per_million,output_price_microunits_per_million,cache_price_microunits_per_million,context_limit,output_limit,enabled,sort_order,health,fallback_priority,minimum_client_version,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18) RETURNING *`, [id, ...values, now.toISOString()])).rows[0];
      const route = toModelRoute(row); const response = { route, repeated: false };
      await client.query("INSERT INTO admin_idempotency_keys(key,operation,response,created_at) VALUES($1,'model-route.create',$2,$3)", [idempotencyKey, response, now.toISOString()]);
      await client.query("INSERT INTO admin_audit_events(id,actor,action,resource,idempotency_key,after_version,summary,created_at) VALUES($1,$2,'create',$3,$4,$5,$6,$7)", [randomUUID(), actor, `model-route:${id}`, idempotencyKey, route.version, { logicalModelId: route.logicalModelId, enabled: route.enabled }, now.toISOString()]);
      await client.query("COMMIT"); return response;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async updateModelRoute(id: string, raw: ModelRouteInput, actor: string, idempotencyKey: string, now = new Date()) {
    const input = modelRouteInputSchema.parse(raw); const client = await this.pool.connect(); const operation = `model-route.update:${id}`;
    try {
      await client.query("BEGIN");
      const repeated = (await client.query("SELECT operation,response FROM admin_idempotency_keys WHERE key=$1 FOR UPDATE", [idempotencyKey])).rows[0];
      if (repeated) { if (repeated.operation !== operation) throw new Error("幂等键已用于其他操作"); await client.query("COMMIT"); return { ...repeated.response, repeated: true } as { route: ModelRoute; repeated: boolean }; }
      const beforeRow = (await client.query("SELECT * FROM model_routes WHERE id=$1 FOR UPDATE", [id])).rows[0]; if (!beforeRow) throw new Error("模型路由不存在");
      const before = toModelRoute(beforeRow); const values = modelRouteValues(input);
      const row = (await client.query(`UPDATE model_routes SET logical_model_id=$2,display_name=$3,provider=$4,provider_model_id=$5,endpoint=$6,capabilities=$7,input_price_microunits_per_million=$8,output_price_microunits_per_million=$9,cache_price_microunits_per_million=$10,context_limit=$11,output_limit=$12,enabled=$13,sort_order=$14,health=$15,fallback_priority=$16,minimum_client_version=$17,version=version+1,updated_at=$18 WHERE id=$1 RETURNING *`, [id, ...values, now.toISOString()])).rows[0];
      const route = toModelRoute(row); const response = { route, repeated: false };
      await client.query("INSERT INTO admin_idempotency_keys(key,operation,response,created_at) VALUES($1,$2,$3,$4)", [idempotencyKey, operation, response, now.toISOString()]);
      await client.query("INSERT INTO admin_audit_events(id,actor,action,resource,idempotency_key,before_version,after_version,summary,created_at) VALUES($1,$2,'update',$3,$4,$5,$6,$7,$8)", [randomUUID(), actor, `model-route:${id}`, idempotencyKey, before.version, route.version, { logicalModelId: route.logicalModelId, enabled: route.enabled, health: route.health }, now.toISOString()]);
      await client.query("COMMIT"); return response;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async resolveModelRoute(logicalModelId: string, clientVersion: string) {
    const routes = (await this.pool.query("SELECT * FROM model_routes WHERE logical_model_id=$1 AND enabled=true AND health IN ('healthy','degraded') ORDER BY CASE health WHEN 'healthy' THEN 0 ELSE 1 END,sort_order,fallback_priority,created_at", [logicalModelId])).rows.map(toModelRoute);
    return routes.find(route => compareSemver(clientVersion, route.minimumClientVersion) >= 0);
  }

  async publicModelCatalog(clientVersion: string) {
    const routes = (await this.pool.query("SELECT * FROM model_routes WHERE enabled=true AND health IN ('healthy','degraded') ORDER BY sort_order,fallback_priority,created_at")).rows.map(toModelRoute).filter(route => compareSemver(clientVersion, route.minimumClientVersion) >= 0);
    const seen = new Set<string>(); return routes.flatMap(route => { if (seen.has(route.logicalModelId)) return []; seen.add(route.logicalModelId); return [{ id: route.logicalModelId, displayName: route.displayName, capabilities: route.capabilities }]; });
  }

  async createPairing(deviceId: string, now = new Date()) {
    const created = createPairingSession("telegram", deviceId, now); await insertPairing(this.pool, created.session); return created;
  }
  async pairing(id: string, deviceId: string, now = new Date()) { const row = (await this.pool.query("SELECT * FROM channel_pairing_sessions WHERE id=$1 AND device_installation_id=$2", [id, deviceId])).rows[0]; if (!row) throw new Error("扫码会话不存在"); const session = normalizeExpiry(toPairing(row), now); if (session.status === "expired" && row.status !== "expired") await this.pool.query("UPDATE channel_pairing_sessions SET status='expired' WHERE id=$1 AND status NOT IN ('consumed','cancelled','failed')", [id]); return session; }
  async cancelPairing(id: string, deviceId: string, now = new Date()) { const current = await this.pairing(id, deviceId, now); const cancelled = transitionPairingSession(current, "cancel", now); await updatePairing(this.pool, cancelled); return cancelled; }

  async consumeTelegram(token: string, identity: { channelUserId: string; chatId: string }, now = new Date()) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN"); const hash = createHash("sha256").update(token).digest("hex");
      const row = (await client.query("SELECT * FROM channel_pairing_sessions WHERE token_hash=$1 FOR UPDATE", [hash])).rows[0]; if (!row) throw new Error("扫码凭证无效");
      let session = normalizeExpiry(toPairing(row), now); if (session.status === "pending") session = transitionPairingSession(session, "scan", now); if (session.status === "scanned") session = transitionPairingSession(session, "confirm", now);
      const active = await client.query<{ device_installation_id: string }>("SELECT device_installation_id FROM channel_bindings WHERE channel='telegram' AND channel_user_id=$1 AND chat_id=$2 AND status='active' FOR UPDATE", [identity.channelUserId, identity.chatId]);
      if (active.rowCount && active.rows[0]!.device_installation_id !== session.deviceInstallationId) throw new Error("该 Telegram 账号已绑定其他设备");
      const consumed = consumePairingSession(session, token, { ...identity, scope: "direct" }, now);
      await updatePairing(client, consumed.session);
      if (!active.rowCount) await client.query("INSERT INTO channel_bindings(id,channel,channel_user_id,chat_id,device_installation_id,scope,status,created_at,last_verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [consumed.binding.id, consumed.binding.channel, consumed.binding.channelUserId, consumed.binding.chatId, consumed.binding.deviceInstallationId, consumed.binding.scope, consumed.binding.status, consumed.binding.createdAt, consumed.binding.lastVerifiedAt]);
      await client.query("COMMIT"); return active.rowCount ? await this.bindingForTelegram(identity.channelUserId, identity.chatId) : consumed.binding;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async bindingForTelegram(userId: string, chatId: string): Promise<ChannelBinding | undefined> { const row = (await this.pool.query("SELECT * FROM channel_bindings WHERE channel='telegram' AND channel_user_id=$1 AND chat_id=$2 AND status='active'", [userId, chatId])).rows[0]; return row ? toBinding(row) : undefined; }
  async listBindings(deviceId: string) { return (await this.pool.query("SELECT * FROM channel_bindings WHERE device_installation_id=$1 ORDER BY created_at DESC", [deviceId])).rows.map(toBinding); }
  async revokeBinding(id: string, deviceId: string, now = new Date()) { const result = await this.pool.query("UPDATE channel_bindings SET status='revoked',revoked_at=$3 WHERE id=$1 AND device_installation_id=$2 AND status='active' RETURNING *", [id, deviceId, now.toISOString()]); if (!result.rowCount) throw new Error("绑定不存在或已解除"); return toBinding(result.rows[0]); }

  async enqueue(envelope: ChannelEnvelope, binding: ChannelBinding, now = new Date()) {
    const client = await this.pool.connect(); try { await client.query("BEGIN");
      const claimed = await client.query("INSERT INTO channel_events(id,channel,provider_event_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [randomUUID(), envelope.channel, envelope.providerEventId]);
      if (!claimed.rowCount) { await client.query("ROLLBACK"); return { created: false }; }
      await client.query("INSERT INTO channel_deliveries(id,binding_id,device_installation_id,envelope,status,created_at,expires_at) VALUES($1,$2,$3,$4,'queued',$5,$6)", [envelope.id, binding.id, binding.deviceInstallationId, envelope, now.toISOString(), new Date(now.getTime() + 24 * 60 * 60_000).toISOString()]);
      await client.query("COMMIT"); return { created: true, envelope };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async pull(deviceId: string, now = new Date()): Promise<ChannelEnvelope[]> {
    const client = await this.pool.connect(); try { await client.query("BEGIN"); await client.query("UPDATE channel_deliveries SET status='expired' WHERE device_installation_id=$1 AND status IN ('queued','delivered') AND expires_at <= $2", [deviceId, now.toISOString()]);
      await client.query("UPDATE channel_deliveries SET status='queued',delivered_at=NULL WHERE device_installation_id=$1 AND status='delivered' AND delivered_at < $2", [deviceId, new Date(now.getTime() - 60_000).toISOString()]);
      const rows = (await client.query("SELECT id,envelope FROM channel_deliveries WHERE device_installation_id=$1 AND status='queued' AND expires_at>$2 ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED", [deviceId, now.toISOString()])).rows;
      if (rows.length) await client.query("UPDATE channel_deliveries SET status='delivered',delivered_at=$2 WHERE id = ANY($1::uuid[])", [rows.map(row => row.id), now.toISOString()]);
      await client.query("COMMIT"); return rows.map(row => channelEnvelopeSchema.parse(row.envelope));
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async acknowledge(deviceId: string, envelopeId: string, input: { taskId: string; state: "accepted" | "running" | "waiting_user" | "completed" | "failed"; summary?: string }, now = new Date()) {
    const client = await this.pool.connect(); try { await client.query("BEGIN"); const row = (await client.query("SELECT d.*,b.chat_id FROM channel_deliveries d JOIN channel_bindings b ON b.id=d.binding_id WHERE d.id=$1 AND d.device_installation_id=$2 FOR UPDATE", [envelopeId, deviceId])).rows[0]; if (!row) throw new Error("投递记录不存在");
      if (input.state === "accepted") await client.query("UPDATE channel_deliveries SET status='acked',task_id=$3,acked_at=$4 WHERE id=$1 AND device_installation_id=$2", [envelopeId, deviceId, input.taskId, now.toISOString()]);
      const statusKey = `${input.state}:${input.taskId}`; const payload = { chatId: row.chat_id, text: outboundText(input.state, input.summary) };
      const inserted = await client.query("INSERT INTO channel_outbound_messages(id,delivery_id,status_key,payload) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id", [randomUUID(), envelopeId, statusKey, payload]);
      await client.query("COMMIT"); return { outboundId: inserted.rows[0]?.id as string | undefined, ...payload };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async pendingOutbound(now = new Date()) {
    const result = await this.pool.query<{ id: string; payload: { chatId: string; text: string } }>(`WITH claimed AS (
      SELECT id FROM channel_outbound_messages WHERE status='queued' AND next_attempt_at <= $1 ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED
    ) UPDATE channel_outbound_messages AS outbound SET status='sending' FROM claimed WHERE outbound.id=claimed.id RETURNING outbound.id,outbound.payload`, [now.toISOString()]);
    return result.rows;
  }
  async markOutbound(id: string, error?: string) {
    if (error) await this.pool.query("UPDATE channel_outbound_messages SET status=CASE WHEN attempt+1>=8 THEN 'failed' ELSE 'queued' END,attempt=attempt+1,error=$2,next_attempt_at=now()+make_interval(secs => LEAST(1800,30*CAST(power(2,LEAST(attempt,6)) AS integer))) WHERE id=$1", [id, error.slice(0, 300)]);
    else await this.pool.query("UPDATE channel_outbound_messages SET status='sent',sent_at=now(),error=NULL WHERE id=$1", [id]);
  }

  async currentPublicConfig() {
    const row = (await this.pool.query("SELECT version,config,etag,created_at FROM public_config_versions ORDER BY version DESC LIMIT 1")).rows[0];
    return row ? { version: Number(row.version), config: row.config, etag: String(row.etag), createdAt: toIso(row.created_at) } : undefined;
  }

  async writePublicConfig(config: unknown, etag: string, actor: string, idempotencyKey: string, now = new Date()) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const repeated = (await client.query("SELECT response FROM admin_idempotency_keys WHERE key=$1 AND operation='public-config.write' FOR UPDATE", [idempotencyKey])).rows[0];
      if (repeated) { await client.query("COMMIT"); return { ...(repeated.response as { version: number; etag: string; createdAt: string }), repeated: true }; }
      const before = (await client.query("SELECT version,config,etag FROM public_config_versions ORDER BY version DESC LIMIT 1 FOR UPDATE")).rows[0];
      const created = (await client.query("INSERT INTO public_config_versions(config,etag,created_at,created_by) VALUES($1,$2,$3,$4) RETURNING version,etag,created_at", [config, etag, now.toISOString(), actor])).rows[0];
      const response = { version: Number(created.version), etag: String(created.etag), createdAt: toIso(created.created_at), repeated: false };
      await client.query("INSERT INTO admin_idempotency_keys(key,operation,response,created_at) VALUES($1,'public-config.write',$2,$3)", [idempotencyKey, response, now.toISOString()]);
      await client.query("INSERT INTO admin_audit_events(id,actor,action,resource,idempotency_key,before_version,after_version,summary,created_at) VALUES($1,$2,'update','public-config',$3,$4,$5,$6,$7)", [randomUUID(), actor, idempotencyKey, before ? Number(before.version) : null, response.version, { beforeEtag: before?.etag ?? null, afterEtag: etag }, now.toISOString()]);
      await client.query("COMMIT"); return response;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async publicConfigHistory(limit = 20) {
    const rows = (await this.pool.query("SELECT version,etag,created_at,created_by FROM public_config_versions ORDER BY version DESC LIMIT $1", [limit])).rows;
    return rows.map(row => ({ version: Number(row.version), etag: String(row.etag), createdAt: toIso(row.created_at), createdBy: String(row.created_by) }));
  }
}

function outboundText(state: "accepted" | "running" | "waiting_user" | "completed" | "failed", summary?: string) { const base = { accepted: "已收到，任务已交给你的 Mac。", running: "任务正在执行。", waiting_user: "任务需要你在 Mac 上确认后继续。", completed: "任务已完成。", failed: "任务未能完成，请在 Mac 上查看原因。" }[state]; return summary?.trim() ? `${base}\n\n${summary.trim().slice(0, 3000)}` : base; }
function toIso(value: unknown) { return value instanceof Date ? value.toISOString() : String(value); }
function toPairing(row: Record<string, unknown>): PairingSession { return pairingSessionSchema.parse({ id: row.id, channel: row.channel, deviceInstallationId: row.device_installation_id, tokenHash: row.token_hash, status: row.status, failureCount: row.failure_count, createdAt: toIso(row.created_at), expiresAt: toIso(row.expires_at), scannedAt: row.scanned_at ? toIso(row.scanned_at) : undefined, confirmedAt: row.confirmed_at ? toIso(row.confirmed_at) : undefined, consumedAt: row.consumed_at ? toIso(row.consumed_at) : undefined, cancelledAt: row.cancelled_at ? toIso(row.cancelled_at) : undefined }); }
function toBinding(row: Record<string, unknown>): ChannelBinding { return channelBindingSchema.parse({ id: row.id, channel: row.channel, channelUserId: row.channel_user_id, chatId: row.chat_id, accountId: row.account_id ?? undefined, deviceInstallationId: row.device_installation_id, scope: row.scope, status: row.status, createdAt: toIso(row.created_at), lastVerifiedAt: toIso(row.last_verified_at), revokedAt: row.revoked_at ? toIso(row.revoked_at) : undefined }); }
async function insertPairing(queryable: Pick<Pool, "query">, session: PairingSession) { await queryable.query("INSERT INTO channel_pairing_sessions(id,channel,device_installation_id,token_hash,status,failure_count,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [session.id, session.channel, session.deviceInstallationId, session.tokenHash, session.status, session.failureCount, session.createdAt, session.expiresAt]); }
async function updatePairing(queryable: Pick<Pool | PoolClient, "query">, session: PairingSession) { await queryable.query("UPDATE channel_pairing_sessions SET status=$2,failure_count=$3,scanned_at=$4,confirmed_at=$5,consumed_at=$6,cancelled_at=$7 WHERE id=$1", [session.id, session.status, session.failureCount, session.scannedAt ?? null, session.confirmedAt ?? null, session.consumedAt ?? null, session.cancelledAt ?? null]); }
function modelRouteValues(input: ReturnType<typeof modelRouteInputSchema.parse>) { return [input.logicalModelId, input.displayName, input.provider, input.providerModelId, input.endpoint.replace(/\/$/, ""), JSON.stringify(input.capabilities), input.inputPriceMicrounitsPerMillion, input.outputPriceMicrounitsPerMillion, input.cachePriceMicrounitsPerMillion, input.contextLimit, input.outputLimit, input.enabled, input.sortOrder, input.health, input.fallbackPriority, input.minimumClientVersion]; }
function toModelRoute(row: Record<string, unknown>): ModelRoute { return { id: String(row.id), logicalModelId: String(row.logical_model_id), displayName: String(row.display_name), provider: "volcengine-ark", providerModelId: String(row.provider_model_id), endpoint: String(row.endpoint), capabilities: modelRouteInputSchema.shape.capabilities.parse(row.capabilities), inputPriceMicrounitsPerMillion: Number(row.input_price_microunits_per_million), outputPriceMicrounitsPerMillion: Number(row.output_price_microunits_per_million), cachePriceMicrounitsPerMillion: Number(row.cache_price_microunits_per_million), contextLimit: Number(row.context_limit), outputLimit: Number(row.output_limit), enabled: Boolean(row.enabled), sortOrder: Number(row.sort_order), health: row.health as ModelRoute["health"], fallbackPriority: Number(row.fallback_priority), minimumClientVersion: String(row.minimum_client_version), version: Number(row.version), createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at) }; }
