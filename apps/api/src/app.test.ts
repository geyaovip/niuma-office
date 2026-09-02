import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalDeviceRequest } from "@niuma/channel-adapter";
import { createApp } from "./app.js";
import type { ApiConfig } from "./config.js";

const config: ApiConfig = { NODE_ENV: "test", PORT: 8787, HOST: "127.0.0.1", DATABASE_URL: "postgres://unused", TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_BOT_USERNAME: "NiumaOfficeBot", TELEGRAM_WEBHOOK_SECRET: "webhook-secret", PUBLIC_API_URL: "https://api.example.com", NIUMA_ARK_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3" };

function signedHeaders(method: string, path: string, body: string, deviceInstallationId: string, privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"]) {
  const unsigned = { deviceInstallationId, timestamp: Date.now(), nonce: randomBytes(18).toString("base64url") };
  return { "x-niuma-device-id": deviceInstallationId, "x-niuma-timestamp": String(unsigned.timestamp), "x-niuma-nonce": unsigned.nonce, "x-niuma-signature": sign(null, Buffer.from(canonicalDeviceRequest(method, path, body, unsigned)), privateKey).toString("base64url") };
}

describe("channel API", () => {
  it("requires proof of private-key possession when registering a device", async () => {
    const keys = generateKeyPairSync("ed25519"); const deviceInstallationId = randomUUID(); const body = { deviceInstallationId, publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), createdAt: new Date().toISOString() };
    const repository = { registerDevice: vi.fn(async () => undefined) }; const app = createApp(config, repository as never);
    const unsigned = await app.inject({ method: "POST", url: "/v1/devices/register", payload: body }); expect(unsigned.statusCode).toBe(400);
    const payload = JSON.stringify(body); const response = await app.inject({ method: "POST", url: "/v1/devices/register", headers: { ...signedHeaders("POST", "/v1/devices/register", payload, deviceInstallationId, keys.privateKey), "content-type": "application/json" }, payload });
    expect(response.statusCode).toBe(200); expect(repository.registerDevice).toHaveBeenCalledWith(deviceInstallationId, body.publicKeyPem); await app.close();
  });

  it("rejects a wrong webhook secret and deduplicates provider updates in the repository boundary", async () => {
    const binding = { id: randomUUID(), channel: "telegram", channelUserId: "9", chatId: "7", deviceInstallationId: randomUUID(), scope: "direct", status: "active", createdAt: new Date().toISOString(), lastVerifiedAt: new Date().toISOString() };
    let seen = false; const repository = { bindingForTelegram: vi.fn(async () => binding), enqueue: vi.fn(async () => seen ? { created: false } : (seen = true, { created: true })) };
    const telegram = { deepLink: vi.fn(), sendMessage: vi.fn(async () => undefined) }; const app = createApp(config, repository as never, telegram as never);
    const update = { update_id: 88, message: { message_id: 1, date: 1, text: "整理会议纪要", chat: { id: 7, type: "private" }, from: { id: 9, is_bot: false } } };
    expect((await app.inject({ method: "POST", url: "/v1/webhooks/telegram", payload: update })).statusCode).toBe(401);
    await app.inject({ method: "POST", url: "/v1/webhooks/telegram", headers: { "x-telegram-bot-api-secret-token": config.TELEGRAM_WEBHOOK_SECRET }, payload: update });
    await app.inject({ method: "POST", url: "/v1/webhooks/telegram", headers: { "x-telegram-bot-api-secret-token": config.TELEGRAM_WEBHOOK_SECRET }, payload: update });
    expect(repository.enqueue).toHaveBeenCalledTimes(2); expect(telegram.sendMessage).toHaveBeenCalledTimes(1); await app.close();
  });

  it("issues a short-lived model session and hides the upstream credential from the desktop", async () => {
    const keys = generateKeyPairSync("ed25519"); const deviceInstallationId = randomUUID(); const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    let tokenHash = "";
    const repository = {
      registerDevice: vi.fn(async () => undefined), publicKey: vi.fn(async () => publicKeyPem),
      createModelSession: vi.fn(async (_deviceId: string, hash: string) => { tokenHash = hash; return { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString() }; }),
    };
    const app = createApp(config, repository as never, undefined, { apiKey: "upstream-secret-never-returned", modelId: "doubao-private-endpoint", baseUrl: config.NIUMA_ARK_BASE_URL });
    const path = "/v1/model-gateway/sessions"; const response = await app.inject({ method: "POST", url: path, headers: signedHeaders("POST", path, "", deviceInstallationId, keys.privateKey) });
    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload).toMatchObject({ baseUrl: "https://api.example.com/v1/model-gateway", modelId: "auto" });
    expect(payload.accessToken).toMatch(/^[A-Za-z0-9_-]{40,128}$/);
    expect(JSON.stringify(payload)).not.toContain("upstream-secret");
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    await app.close();
  });

  it("authenticates the short-lived token, forces the server model and proxies the response", async () => {
    const consumeModelSession = vi.fn(async () => randomUUID());
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer upstream-secret-never-returned");
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "doubao-private-endpoint", messages: [{ role: "user", content: "你好" }] });
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "你好" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const app = createApp(config, { consumeModelSession } as never, undefined, { apiKey: "upstream-secret-never-returned", modelId: "doubao-private-endpoint", baseUrl: config.NIUMA_ARK_BASE_URL, fetcher: fetcher as typeof fetch });
    const response = await app.inject({ method: "POST", url: "/v1/model-gateway/chat/completions", headers: { authorization: `Bearer ${"a".repeat(48)}` }, payload: { model: "attempted-client-model", messages: [{ role: "user", content: "你好" }] } });
    expect(response.statusCode).toBe(200);
    expect(response.json().choices[0].message.content).toBe("你好");
    expect(consumeModelSession).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
    await app.close();
  });

  it("starts without Telegram configuration and reports the capability as disabled", async () => {
    const { TELEGRAM_BOT_TOKEN: _token, TELEGRAM_BOT_USERNAME: _username, TELEGRAM_WEBHOOK_SECRET: _secret, ...withoutTelegram } = config;
    const app = createApp(withoutTelegram, {} as never);
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({ status: "ok", capabilities: { modelGateway: false, telegram: false } });
    expect((await app.inject({ method: "POST", url: "/v1/webhooks/telegram", payload: {} })).statusCode).toBe(404);
    await app.close();
  });
});
