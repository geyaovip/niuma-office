import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Readable, Transform } from "node:stream";
import Fastify from "fastify";
import { z } from "zod";
import { signedDeviceRequestSchema, type PairingSession } from "@niuma/contracts";
import { ReplayWindow, verifyDeviceRequest } from "@niuma/channel-adapter";
import type { ApiConfig } from "./config.js";
import type { ChannelRepository } from "./channel-repository.js";
import { createTelegramEnvelope, parseTelegramUpdate, TelegramClient, type TelegramUpdate } from "./telegram.js";
import { estimateCostMicrounits, modelRouteInputSchema, semverSchema, type ModelRoute, type ModelUsage } from "./model-catalog.js";

type ChannelStore = Pick<ChannelRepository, "registerDevice" | "publicKey" | "createPairing" | "pairing" | "cancelPairing" | "consumeTelegram" | "bindingForTelegram" | "listBindings" | "revokeBinding" | "enqueue" | "pull" | "acknowledge" | "markOutbound" | "createModelSession" | "consumeModelSession"> & Partial<Pick<ChannelRepository, "pendingOutbound" | "currentPublicConfig" | "writePublicConfig" | "publicConfigHistory" | "listModelRoutes" | "createModelRoute" | "updateModelRoute" | "resolveModelRoute" | "resolveModelRoutes" | "recordModelRouteFailure" | "recordModelRouteSuccess" | "startModelUsage" | "completeModelUsage" | "publicModelCatalog">>;
type TelegramTransport = Pick<TelegramClient, "deepLink" | "sendMessage">;
export interface ModelGatewayOptions { apiKey: string; staticModelId?: string; staticBaseUrl: string; routeMode?: "database" | "static"; fetcher?: typeof fetch }
export interface AdminOptions { token: string }
type GatewayRoute = Pick<ModelRoute, "providerModelId" | "endpoint"> & Partial<ModelRoute>;

const deviceSchema = z.object({ deviceInstallationId: z.string().uuid(), publicKeyPem: z.string().min(80).max(10_000), createdAt: z.string().datetime() });
const ackSchema = z.object({ taskId: z.string().min(1).max(200), state: z.enum(["accepted", "running", "waiting_user", "completed", "failed"]), summary: z.string().max(3000).optional() });
const modelRequestSchema = z.object({ model: z.string().optional(), messages: z.array(z.unknown()).min(1).max(500) }).loose();
const modelSessionSchema = z.object({ clientVersion: semverSchema }).strict();
const publicConfigSchema = z.object({
  minimumClientVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  latestClientVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  capabilities: z.object({ telegram: z.boolean(), feishu: z.boolean() }),
  models: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{2,40}$/), displayName: z.string().min(1).max(40), capabilities: z.array(z.enum(["reasoning", "vision", "tools", "coding", "long-context"])).max(8) })).max(20),
  release: z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/), downloadUrl: z.string().url(), sha256: z.string().regex(/^[a-f0-9]{64}$/), unsigned: z.boolean() }),
}).strict();
const conservativePublicConfig = publicConfigSchema.parse({ minimumClientVersion: "0.1.0", latestClientVersion: "0.1.0", capabilities: { telegram: false, feishu: false }, models: [{ id: "auto", displayName: "Auto", capabilities: ["reasoning", "tools", "long-context"] }], release: { version: "0.1.0", downloadUrl: "https://download.alipayclaw.cn/releases/0.1.0/niuma-office-0.1.0-mac-arm64-internal.zip", sha256: "2d19dd7e539fe386758ab33bd0c45523890a2860f4ca977732369eddb93427ea", unsigned: true } });

export function createApp(config: ApiConfig, repository: ChannelStore, telegram?: TelegramTransport, modelGateway?: ModelGatewayOptions, admin?: AdminOptions) {
  const telegramClient = telegram ?? (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_BOT_USERNAME ? new TelegramClient(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_BOT_USERNAME) : undefined);
  const app = Fastify({ logger: config.NODE_ENV !== "test", bodyLimit: 512 * 1024, trustProxy: true });
  const replay = new ReplayWindow();
  let outboundTimer: NodeJS.Timeout | undefined;
  let flushingOutbound = false;

  const flushOutbound = async () => {
    if (!telegramClient || !repository.pendingOutbound || flushingOutbound) return;
    flushingOutbound = true;
    try {
      for (const item of await repository.pendingOutbound()) {
        try { await telegramClient.sendMessage(item.payload.chatId, item.payload.text); await repository.markOutbound(item.id); }
        catch (error) { await repository.markOutbound(item.id, error instanceof Error ? error.message : "send failed"); }
      }
    } finally { flushingOutbound = false; }
  };

  app.addHook("onReady", async () => {
    if (!telegramClient || !repository.pendingOutbound) return;
    await flushOutbound();
    outboundTimer = setInterval(() => void flushOutbound(), 15_000);
  });
  app.addHook("onClose", async () => { if (outboundTimer) clearInterval(outboundTimer); });

  const authenticate = async (request: { headers: Record<string, unknown>; method: string; url: string; body?: unknown }) => {
    const signed = signedDeviceRequestSchema.parse({ deviceInstallationId: request.headers["x-niuma-device-id"], timestamp: Number(request.headers["x-niuma-timestamp"]), nonce: request.headers["x-niuma-nonce"], signature: request.headers["x-niuma-signature"] });
    const publicKey = await repository.publicKey(signed.deviceInstallationId);
    if (!publicKey) throw new Error("设备尚未登记");
    const path = request.url.split("?")[0]!;
    verifyDeviceRequest(request.method, path, request.body === undefined ? "" : JSON.stringify(request.body), signed, publicKey, replay);
    return signed.deviceInstallationId;
  };
  const authenticateRegistration = (request: { headers: Record<string, unknown>; method: string; url: string; body?: unknown }, input: z.infer<typeof deviceSchema>) => {
    const signed = signedDeviceRequestSchema.parse({ deviceInstallationId: request.headers["x-niuma-device-id"], timestamp: Number(request.headers["x-niuma-timestamp"]), nonce: request.headers["x-niuma-nonce"], signature: request.headers["x-niuma-signature"] });
    if (signed.deviceInstallationId !== input.deviceInstallationId) throw new Error("设备身份不一致");
    verifyDeviceRequest(request.method, request.url.split("?")[0]!, JSON.stringify(input), signed, input.publicKeyPem, replay);
  };
  const safe = (handler: (...args: never[]) => unknown) => async (...args: never[]) => {
    try { return await handler(...args); }
    catch (error) {
      const message = error instanceof Error ? error.message : "请求处理失败";
      const explicit = error && typeof error === "object" && "statusCode" in error ? Number((error as { statusCode: unknown }).statusCode) : undefined;
      throw Object.assign(new Error(message), { statusCode: explicit || (/(不存在|尚未登记)/.test(message) ? 404 : /(已过期|已结束|冲突|已绑定)/.test(message) ? 409 : 400) });
    }
  };

  app.get("/health", () => ({
    status: "ok",
    capabilities: {
      modelGateway: Boolean(modelGateway),
      telegram: Boolean(telegramClient),
      feishu: false,
    },
  }));
  app.get("/v1/config", async (request, reply) => {
    const stored = repository.currentPublicConfig ? await repository.currentPublicConfig() : undefined;
    const value = stored ?? { version: 0, config: conservativePublicConfig, etag: hashConfig(conservativePublicConfig), createdAt: null };
    const parsed = publicConfigSchema.parse(value.config);
    const models = modelGateway?.routeMode === "database" && repository.publicModelCatalog ? await repository.publicModelCatalog(parsed.latestClientVersion) : parsed.models;
    const response = { version: value.version, updatedAt: value.createdAt, ...parsed, models };
    const etag = `"${hashConfig(response)}"`;
    reply.header("cache-control", "public, max-age=60, stale-if-error=300").header("etag", etag);
    if (etagMatches(request.headers["if-none-match"], etag)) return reply.code(304).send();
    return response;
  });
  app.put("/v1/admin/config", safe(async (request: any, reply: any) => {
    requireAdmin(request.headers.authorization, admin?.token);
    if (!repository.writePublicConfig) throw httpError(503, "配置存储暂时不可用");
    const idempotencyKey = z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/).parse(request.headers["idempotency-key"]);
    const actor = z.string().min(1).max(120).parse(request.headers["x-niuma-admin-actor"]);
    const value = publicConfigSchema.parse(request.body); const etag = hashConfig(value);
    const result = await repository.writePublicConfig(value, etag, actor, idempotencyKey);
    reply.code(result.repeated ? 200 : 201); return result;
  }) as never);
  app.get("/v1/admin/config/history", safe(async (request: any) => {
    requireAdmin(request.headers.authorization, admin?.token);
    if (!repository.publicConfigHistory) throw httpError(503, "配置存储暂时不可用");
    return { versions: await repository.publicConfigHistory(50) };
  }) as never);
  app.get("/v1/admin/models", safe(async (request: any) => {
    requireAdmin(request.headers.authorization, admin?.token); if (!repository.listModelRoutes) throw httpError(503, "模型目录存储暂时不可用");
    return { models: await repository.listModelRoutes() };
  }) as never);
  app.post("/v1/admin/models", safe(async (request: any, reply: any) => {
    requireAdmin(request.headers.authorization, admin?.token); if (!repository.createModelRoute) throw httpError(503, "模型目录存储暂时不可用");
    const meta = adminWriteMeta(request.headers); const result = await repository.createModelRoute(modelRouteInputSchema.parse(request.body), meta.actor, meta.idempotencyKey);
    reply.code(result.repeated ? 200 : 201); return result;
  }) as never);
  app.put("/v1/admin/models/:id", safe(async (request: any, reply: any) => {
    requireAdmin(request.headers.authorization, admin?.token); if (!repository.updateModelRoute) throw httpError(503, "模型目录存储暂时不可用");
    const meta = adminWriteMeta(request.headers); const result = await repository.updateModelRoute(z.string().uuid().parse(request.params.id), modelRouteInputSchema.parse(request.body), meta.actor, meta.idempotencyKey);
    reply.code(result.repeated ? 200 : 201); return result;
  }) as never);
  app.post("/v1/devices/register", safe(async (request: any) => {
    const input = deviceSchema.parse(request.body);
    authenticateRegistration(request, input);
    await repository.registerDevice(input.deviceInstallationId, input.publicKeyPem);
    return { deviceInstallationId: input.deviceInstallationId, registered: true };
  }) as never);

  app.post("/v1/model-gateway/sessions", safe(async (request: any) => {
    if (!modelGateway) throw httpError(503, "平台模型服务尚未启用");
    const input = modelSessionSchema.parse(request.body); const deviceId = await authenticate(request);
    const accessToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 2 * 60 * 60_000);
    await repository.createModelSession(deviceId, hashToken(accessToken), expiresAt, input.clientVersion);
    return { accessToken, expiresAt: expiresAt.toISOString(), baseUrl: `${config.PUBLIC_API_URL.replace(/\/$/, "")}/v1/model-gateway`, modelId: "auto" };
  }) as never);

  app.post("/v1/model-gateway/chat/completions", async (request: any, reply) => {
    if (!modelGateway) return reply.code(503).send({ error: { message: "平台模型服务尚未启用" } });
    const token = bearerToken(request.headers.authorization);
    const session = token ? await repository.consumeModelSession(hashToken(token)) : undefined;
    if (!session) return reply.code(401).send({ error: { message: "模型会话已失效，请重新运行任务" } });
    const input = modelRequestSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: { message: "模型请求格式无效" } });
    const requestIdResult = z.string().uuid().safeParse(request.headers["x-niuma-request-id"] ?? randomUUID());
    if (!requestIdResult.success) return reply.code(400).send({ error: { message: "模型请求标识格式无效" } });
    const requestId = requestIdResult.data; const startedAt = Date.now(); reply.header("x-niuma-request-id", requestId);
    if (repository.startModelUsage) {
      try {
        if (!await repository.startModelUsage(requestId, session.deviceInstallationId, "auto")) return reply.code(409).send({ error: { message: "该模型请求已受理", requestId } });
      } catch { return reply.code(503).send({ error: { message: "模型请求记录暂时不可用，请稍后重试", requestId } }); }
    }
    const finishUsage = async (details: Parameters<NonNullable<ChannelStore["completeModelUsage"]>>[0]) => {
      if (!repository.completeModelUsage) return;
      try { await repository.completeModelUsage(details); }
      catch { app.log.error({ requestId }, "模型用量账本写入失败"); }
    };
    const fetcher = modelGateway.fetcher ?? fetch;
    let routes: GatewayRoute[] = [];
    try {
      if (modelGateway.routeMode === "database") {
        routes = repository.resolveModelRoutes ? await repository.resolveModelRoutes("auto", session.clientVersion) : [await repository.resolveModelRoute?.("auto", session.clientVersion)].filter(Boolean) as GatewayRoute[];
      } else if (modelGateway.staticModelId) routes = [{ providerModelId: modelGateway.staticModelId, endpoint: modelGateway.staticBaseUrl }];
    } catch {
      await finishUsage({ requestId, status: "failed", attemptCount: 0, durationMs: Date.now() - startedAt, normalizedErrorCode: "route_resolution_failed" });
      return reply.code(503).send({ error: { message: "模型路由暂时不可用，请稍后重试", requestId } });
    }
    if (!routes.length) {
      await finishUsage({ requestId, status: "failed", attemptCount: 0, durationMs: Date.now() - startedAt, normalizedErrorCode: "no_eligible_route" });
      return reply.code(503).send({ error: { message: "当前没有可用的平台模型，请稍后重试", requestId } });
    }
    let lastErrorCode = "upstream_unavailable";
    for (let index = 0; index < routes.length; index += 1) {
      const route = routes[index]!; const attemptCount = index + 1; let upstream: Response;
      try {
        upstream = await fetcher(`${route.endpoint.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { accept: "application/json, text/event-stream", authorization: `Bearer ${modelGateway.apiKey}`, "content-type": "application/json", "x-niuma-request-id": requestId },
          body: JSON.stringify(providerRequestBody(input.data, route.providerModelId)),
          signal: AbortSignal.timeout(15 * 60_000),
        });
      } catch (error) {
        lastErrorCode = error instanceof Error && error.name === "TimeoutError" ? "upstream_timeout" : "upstream_connection_failed";
        if (route.id) await safeRouteFailure(repository, route.id);
        if (index + 1 < routes.length) continue;
        await finishUsage({ requestId, status: "failed", route, attemptCount, durationMs: Date.now() - startedAt, normalizedErrorCode: lastErrorCode });
        return reply.code(424).send({ error: { message: "模型服务暂时无法连接，请稍后重试", code: lastErrorCode, requestId } });
      }
      const upstreamRequestId = upstream.headers.get("x-request-id") ?? upstream.headers.get("x-tt-logid") ?? undefined;
      if (!upstream.ok || !upstream.body) {
        const retryable = upstream.status === 429 || upstream.status >= 500;
        lastErrorCode = upstream.status === 429 ? "upstream_rate_limited" : upstream.status >= 500 ? "upstream_server_error" : "upstream_rejected";
        if (route.id && (retryable || upstream.status === 401 || upstream.status === 403)) await safeRouteFailure(repository, route.id);
        try { await upstream.body?.cancel(); } catch { /* response is already being discarded */ }
        if (retryable && index + 1 < routes.length) continue;
        await finishUsage({ requestId, status: "failed", route, attemptCount, durationMs: Date.now() - startedAt, upstreamRequestId, normalizedErrorCode: lastErrorCode });
        return reply.code(retryable ? 424 : 422).send({ error: { message: retryable ? "模型服务暂时不可用，请稍后重试" : "模型请求未被接受，请检查内容后重试", code: lastErrorCode, requestId } });
      }
      const contentType = upstream.headers.get("content-type") || "application/json";
      reply.code(upstream.status).header("content-type", contentType);
      if (upstreamRequestId) reply.header("x-upstream-request-id", upstreamRequestId.slice(0, 200));
      const observed = observeModelStream(upstream.body, contentType, async (status, usage, errorCode) => {
        if (route.id) {
          if (status === "succeeded" && repository.recordModelRouteSuccess) {
            try { await repository.recordModelRouteSuccess(route.id); } catch { app.log.warn({ requestId, routeId: route.id }, "模型路由成功状态写入失败"); }
          } else if (status === "failed") await safeRouteFailure(repository, route.id);
        }
        const estimatedCostMicrounits = usage && hasPricing(route) ? estimateCostMicrounits(route, usage) : undefined;
        await finishUsage({ requestId, status, route, usage, estimatedCostMicrounits, attemptCount, durationMs: Date.now() - startedAt, upstreamRequestId, normalizedErrorCode: errorCode });
      });
      return reply.send(observed);
    }
    await finishUsage({ requestId, status: "failed", attemptCount: routes.length, durationMs: Date.now() - startedAt, normalizedErrorCode: lastErrorCode });
    return reply.code(424).send({ error: { message: "模型服务暂时不可用，请稍后重试", code: lastErrorCode, requestId } });
  });

  app.get("/v1/channels", safe(async (request: any) => { const deviceId = await authenticate(request); return { bindings: await repository.listBindings(deviceId) }; }) as never);
  app.delete("/v1/channels/:id", safe(async (request: any) => { const deviceId = await authenticate(request); return { binding: await repository.revokeBinding(z.string().uuid().parse(request.params.id), deviceId) }; }) as never);
  app.post("/v1/deliveries/pull", safe(async (request: any) => { const deviceId = await authenticate(request); return { deliveries: await repository.pull(deviceId) }; }) as never);
  app.post("/v1/deliveries/:id/ack", safe(async (request: any) => {
    const deviceId = await authenticate(request);
    const input = ackSchema.parse(request.body);
    const result = await repository.acknowledge(deviceId, z.string().uuid().parse(request.params.id), input);
    if (result.outboundId && telegramClient) {
      try { await telegramClient.sendMessage(result.chatId, result.text); await repository.markOutbound(result.outboundId); }
      catch (error) { await repository.markOutbound(result.outboundId, error instanceof Error ? error.message : "send failed"); }
    }
    return { acknowledged: true };
  }) as never);

  if (telegramClient && config.TELEGRAM_WEBHOOK_SECRET) {
    app.post("/v1/channels/telegram/pairing-sessions", safe(async (request: any) => { const deviceId = await authenticate(request); const created = await repository.createPairing(deviceId); return { session: publicPairing(created.session), deepLink: telegramClient.deepLink(created.token) }; }) as never);
    app.get("/v1/channels/telegram/pairing-sessions/:id", safe(async (request: any) => { const deviceId = await authenticate(request); return { session: publicPairing(await repository.pairing(z.string().uuid().parse(request.params.id), deviceId)) }; }) as never);
    app.delete("/v1/channels/telegram/pairing-sessions/:id", safe(async (request: any) => { const deviceId = await authenticate(request); return { session: publicPairing(await repository.cancelPairing(z.string().uuid().parse(request.params.id), deviceId)) }; }) as never);
    app.post("/v1/webhooks/telegram", safe(async (request: any, reply: any) => {
      if (!secretEquals(String(request.headers["x-telegram-bot-api-secret-token"] ?? ""), config.TELEGRAM_WEBHOOK_SECRET!)) { reply.code(401); return { ok: false }; }
      const action = parseTelegramUpdate(request.body as TelegramUpdate);
      if (action.kind === "ignore") return { ok: true };
      if (action.kind === "pair") {
        try { await repository.consumeTelegram(action.token, { channelUserId: action.userId, chatId: action.chatId }); await telegramClient.sendMessage(action.chatId, "已成功连接牛马办公。现在可以直接发送工作要求。"); }
        catch { await telegramClient.sendMessage(action.chatId, "连接未完成：二维码可能已过期或已使用，请在 Mac 上刷新后重试。"); }
        return { ok: true };
      }
      const binding = await repository.bindingForTelegram(action.userId, action.chatId);
      if (!binding) { await telegramClient.sendMessage(action.chatId, "请先在牛马办公 Mac 客户端扫码连接 Telegram。"); return { ok: true }; }
      const queued = await repository.enqueue(createTelegramEnvelope(action, binding), binding);
      if (queued.created) await telegramClient.sendMessage(action.chatId, "已收到。Mac 在线时会自动开始处理。");
      return { ok: true };
    }) as never);
  }
  return app;
}

function publicPairing(session: PairingSession) { const { tokenHash: _tokenHash, ...safe } = session; return safe; }
function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
function bearerToken(value: unknown) { const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(String(value ?? "")); return match?.[1]; }
function httpError(statusCode: number, message: string) { return Object.assign(new Error(message), { statusCode }); }
function secretEquals(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function requireAdmin(value: unknown, token: string | undefined) { if (!token) throw httpError(503, "管理接口尚未启用"); const supplied = bearerToken(value); if (!supplied || !secretEquals(supplied, token)) throw httpError(401, "管理凭证无效"); }
function hashConfig(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function etagMatches(value: unknown, expected: string) { return String(value ?? "").split(",").some(tag => tag.trim().replace(/^W\//, "") === expected); }
function adminWriteMeta(headers: Record<string, unknown>) { return { idempotencyKey: z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/).parse(headers["idempotency-key"]), actor: z.string().min(1).max(120).parse(headers["x-niuma-admin-actor"]) }; }
async function safeRouteFailure(repository: ChannelStore, routeId: string) { try { await repository.recordModelRouteFailure?.(routeId); } catch { /* request failure remains authoritative even if circuit telemetry is unavailable */ } }
function hasPricing(route: GatewayRoute): route is GatewayRoute & Pick<ModelRoute, "inputPriceMicrounitsPerMillion" | "outputPriceMicrounitsPerMillion" | "cachePriceMicrounitsPerMillion"> { return [route.inputPriceMicrounitsPerMillion, route.outputPriceMicrounitsPerMillion, route.cachePriceMicrounitsPerMillion].every(value => Number.isSafeInteger(value) && Number(value) >= 0); }
function observeModelStream(body: ReadableStream<Uint8Array>, contentType: string, onComplete: (status: "succeeded" | "failed" | "cancelled", usage?: ModelUsage, errorCode?: string) => Promise<void>) {
  const source = Readable.fromWeb(body as never); const chunks: Buffer[] = []; let capturedBytes = 0; let settled = false; const captureLimit = 2 * 1024 * 1024;
  const settle = async (status: "succeeded" | "failed" | "cancelled", usage?: ModelUsage, errorCode?: string) => { if (settled) return; settled = true; await onComplete(status, usage, errorCode); };
  const observer = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (capturedBytes < captureLimit) { const remaining = captureLimit - capturedBytes; chunks.push(value.subarray(0, remaining)); capturedBytes += Math.min(value.length, remaining); }
      callback(null, chunk);
    },
    flush(callback) { void settle("succeeded", parseModelUsage(Buffer.concat(chunks).toString("utf8"), contentType)).then(() => callback(), () => callback()); },
    destroy(error, callback) { void settle(error ? "failed" : "cancelled", undefined, error ? "upstream_stream_failed" : "client_cancelled").then(() => callback(error), () => callback(error)); },
  });
  source.on("error", error => observer.destroy(error));
  return source.pipe(observer);
}
function parseModelUsage(payload: string, contentType: string): ModelUsage | undefined {
  const candidates: unknown[] = [];
  if (contentType.includes("text/event-stream")) {
    for (const line of payload.split(/\r?\n/)) { const value = line.startsWith("data:") ? line.slice(5).trim() : ""; if (!value || value === "[DONE]") continue; try { candidates.push(JSON.parse(value)); } catch { /* incomplete or non-JSON event */ } }
  } else { try { candidates.push(JSON.parse(payload)); } catch { return undefined; } }
  for (let index = candidates.length - 1; index >= 0; index -= 1) { const usage = usageFromPayload(candidates[index]); if (usage) return usage; }
  return undefined;
}
function usageFromPayload(value: unknown): ModelUsage | undefined {
  if (!value || typeof value !== "object") return undefined; const usage = (value as { usage?: unknown }).usage; if (!usage || typeof usage !== "object") return undefined;
  const record = usage as Record<string, unknown>; const details = record.prompt_tokens_details && typeof record.prompt_tokens_details === "object" ? record.prompt_tokens_details as Record<string, unknown> : {};
  const inputTokens = tokenCount(record.input_tokens ?? record.prompt_tokens); const outputTokens = tokenCount(record.output_tokens ?? record.completion_tokens); const cachedInputTokens = tokenCount(record.cached_tokens ?? record.cache_read_input_tokens ?? details.cached_tokens) ?? 0;
  if (inputTokens === undefined || outputTokens === undefined || cachedInputTokens > inputTokens) return undefined;
  return { inputTokens, outputTokens, cachedInputTokens };
}
function tokenCount(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined; }
function providerRequestBody(input: z.infer<typeof modelRequestSchema>, providerModelId: string) { return input.stream === true ? { ...input, model: providerModelId, stream_options: { include_usage: true } } : { ...input, model: providerModelId }; }
