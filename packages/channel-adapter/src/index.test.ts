import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EventDeduplicator, ReplayWindow, canonicalDeviceRequest, consumePairingSession, createPairingSession, normalizeExpiry, transitionPairingSession, verifyDeviceRequest } from "./index.js";

describe("pairing sessions", () => {
  it("requires scan and confirmation before one-time consumption", () => {
    const now = new Date("2026-09-01T08:00:00.000Z"); const deviceId = randomUUID();
    const created = createPairingSession("telegram", deviceId, now);
    const scanned = transitionPairingSession(created.session, "scan", new Date(now.getTime() + 1_000));
    const confirmed = transitionPairingSession(scanned, "confirm", new Date(now.getTime() + 2_000));
    const result = consumePairingSession(confirmed, created.token, { channelUserId: "user-1", chatId: "chat-1", scope: "direct" }, new Date(now.getTime() + 3_000));
    expect(result.session.status).toBe("consumed"); expect(result.binding).toMatchObject({ channel: "telegram", deviceInstallationId: deviceId, status: "active" });
    expect(() => consumePairingSession(result.session, created.token, { channelUserId: "user-1", chatId: "chat-1", scope: "direct" }, now)).toThrow();
  });
  it("expires, rejects a wrong token, and stops after repeated failures", () => {
    const now = new Date("2026-09-01T08:00:00.000Z"); const created = createPairingSession("feishu", randomUUID(), now);
    expect(normalizeExpiry(created.session, new Date(now.getTime() + 300_001)).status).toBe("expired");
    const confirmed = transitionPairingSession(transitionPairingSession(created.session, "scan", now), "confirm", now);
    expect(() => consumePairingSession(confirmed, "wrong", { channelUserId: "u", chatId: "c", scope: "direct" }, now)).toThrow("扫码凭证无效");
    let failed = created.session; for (let index = 0; index < 5; index += 1) failed = transitionPairingSession(failed, "fail", now);
    expect(failed.status).toBe("failed");
  });
});

describe("device signatures and idempotency", () => {
  it("accepts a valid signature, then rejects replay and stale requests", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519"); const now = Date.now();
    const base = { deviceInstallationId: randomUUID(), timestamp: now, nonce: randomBytes(18).toString("base64url") };
    const canonical = canonicalDeviceRequest("POST", "/v1/channel/pull", "{}", base);
    const request = { ...base, signature: sign(null, Buffer.from(canonical), privateKey).toString("base64url") };
    const replay = new ReplayWindow();
    expect(verifyDeviceRequest("POST", "/v1/channel/pull", "{}", request, publicKey.export({ type: "spki", format: "pem" }).toString(), replay, now)).toMatchObject(base);
    expect(() => verifyDeviceRequest("POST", "/v1/channel/pull", "{}", request, publicKey.export({ type: "spki", format: "pem" }).toString(), replay, now)).toThrow("已被处理");
    expect(() => new ReplayWindow().claim(base.deviceInstallationId, "another_nonce_12345", now - 301_000, now)).toThrow("已过期");
  });
  it("does not consume a nonce when signature verification fails", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519"); const now = Date.now(); const replay = new ReplayWindow();
    const base = { deviceInstallationId: randomUUID(), timestamp: now, nonce: randomBytes(18).toString("base64url") };
    const canonical = canonicalDeviceRequest("POST", "/v1/channel/pull", "{}", base);
    const valid = { ...base, signature: sign(null, Buffer.from(canonical), privateKey).toString("base64url") };
    expect(() => verifyDeviceRequest("POST", "/v1/channel/pull", "changed", valid, publicKey.export({ type: "spki", format: "pem" }).toString(), replay, now)).toThrow("签名验证失败");
    expect(verifyDeviceRequest("POST", "/v1/channel/pull", "{}", valid, publicKey.export({ type: "spki", format: "pem" }).toString(), replay, now)).toBeTruthy();
  });
  it("claims each provider event only once", () => { const dedupe = new EventDeduplicator(); expect(dedupe.claim("telegram", "evt-1")).toBe(true); expect(dedupe.claim("telegram", "evt-1")).toBe(false); expect(dedupe.claim("feishu", "evt-1")).toBe(true); });
});
