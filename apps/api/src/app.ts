import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import Fastify from "fastify";
import { z } from "zod";
import { signedDeviceRequestSchema, type PairingSession } from "@niuma/contracts";
import { ReplayWindow, verifyDeviceRequest } from "@niuma/channel-adapter";
import type { ApiConfig } from "./config.js";
import type { ChannelRepository } from "./channel-repository.js";
import { createTelegramEnvelope, parseTelegramUpdate, TelegramClient, type TelegramUpdate } from "./telegram.js";

type ChannelStore = Pick<ChannelRepository, "registerDevice" | "publicKey" | "createPairing" | "pairing" | "cancelPairing" | "consumeTelegram" | "bindingForTelegram" | "listBindings" | "revokeBinding" | "enqueue" | "pull" | "acknowledge" | "markOutbound" | "createModelSession" | "consumeModelSession"> & Partial<Pick<ChannelRepository, "pendingOutbound">>;
type TelegramTransport = Pick<TelegramClient, "deepLink" | "sendMessage">;
export interface ModelGatewayOptions { apiKey: string; modelId: string; baseUrl: string; fetcher?: typeof fetch }

const deviceSchema = z.object({ deviceInstallationId: z.string().uuid(), publicKeyPem: z.string().min(80).max(10_000), createdAt: z.string().datetime() });
const ackSchema = z.object({ taskId: z.string().min(1).max(200), state: z.enum(["accepted", "running", "waiting_user", "completed", "failed"]), summary: z.string().max(3000).optional() });
const modelRequestSchema = z.object({ model: z.string().optional(), messages: z.array(z.unknown()).min(1).max(500) }).loose();

export function createApp(config: ApiConfig, repository: ChannelStore, telegram?: TelegramTransport, modelGateway?: ModelGatewayOptions) {
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

  app.get("/health", () => ({ status: "ok", capabilities: { modelGateway: Boolean(modelGateway), telegram: Boolean(telegramClient) } }));
  app.post("/v1/devices/register", safe(async (request: any) => {
    const input = deviceSchema.parse(request.body);
    authenticateRegistration(request, input);
    await repository.registerDevice(input.deviceInstallationId, input.publicKeyPem);
    return { deviceInstallationId: input.deviceInstallationId, registered: true };
  }) as never);

  app.post("/v1/model-gateway/sessions", safe(async (request: any) => {
    if (!modelGateway) throw httpError(503, "平台模型服务尚未启用");
    const deviceId = await authenticate(request);
    const accessToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 2 * 60 * 60_000);
    await repository.createModelSession(deviceId, hashToken(accessToken), expiresAt);
    return { accessToken, expiresAt: expiresAt.toISOString(), baseUrl: `${config.PUBLIC_API_URL.replace(/\/$/, "")}/v1/model-gateway`, modelId: "auto" };
  }) as never);

  app.post("/v1/model-gateway/chat/completions", async (request: any, reply) => {
    if (!modelGateway) return reply.code(503).send({ error: { message: "平台模型服务尚未启用" } });
    const token = bearerToken(request.headers.authorization);
    if (!token || !await repository.consumeModelSession(hashToken(token))) return reply.code(401).send({ error: { message: "模型会话已失效，请重新运行任务" } });
    const input = modelRequestSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: { message: "模型请求格式无效" } });
    const fetcher = modelGateway.fetcher ?? fetch;
    let upstream: Response;
    try {
      upstream = await fetcher(`${modelGateway.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { accept: "application/json, text/event-stream", authorization: `Bearer ${modelGateway.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ ...input.data, model: modelGateway.modelId }),
        signal: AbortSignal.timeout(15 * 60_000),
      });
    } catch { return reply.code(502).send({ error: { message: "模型服务暂时无法连接，请稍后重试" } }); }
    if (!upstream.ok || !upstream.body) return reply.code(502).send({ error: { message: "模型服务暂时不可用，请稍后重试" } });
    reply.code(upstream.status);
    reply.header("content-type", upstream.headers.get("content-type") || "application/json");
    const requestId = upstream.headers.get("x-request-id");
    if (requestId) reply.header("x-request-id", requestId);
    return reply.send(Readable.fromWeb(upstream.body as never));
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
function bearerToken(value: unknown) { const match = /^Bearer ([A-Za-z0-9_-]{40,128})$/.exec(String(value ?? "")); return match?.[1]; }
function httpError(statusCode: number, message: string) { return Object.assign(new Error(message), { statusCode }); }
function secretEquals(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
