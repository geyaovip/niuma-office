import { createHash, randomBytes, randomUUID, timingSafeEqual, verify } from "node:crypto";
import { channelBindingSchema, pairingSessionSchema, signedDeviceRequestSchema, type Channel, type ChannelBinding, type PairingSession, type SignedDeviceRequest } from "@niuma/contracts";

export const PAIRING_TTL_MS = 5 * 60_000;
export const DEVICE_SIGNATURE_WINDOW_MS = 5 * 60_000;

export function createPairingSession(channel: Channel, deviceInstallationId: string, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const session = pairingSessionSchema.parse({ id: randomUUID(), channel, deviceInstallationId, tokenHash: digest(token), status: "pending", failureCount: 0, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + PAIRING_TTL_MS).toISOString() });
  return { session, token };
}

export function transitionPairingSession(session: PairingSession, action: "scan" | "confirm" | "cancel" | "fail", now = new Date()): PairingSession {
  const current = normalizeExpiry(session, now);
  if (["consumed", "expired", "cancelled", "failed"].includes(current.status)) throw new Error("该扫码会话已结束");
  const at = now.toISOString();
  if (action === "cancel") return pairingSessionSchema.parse({ ...current, status: "cancelled", cancelledAt: at });
  if (action === "fail") { const failureCount = current.failureCount + 1; return pairingSessionSchema.parse({ ...current, failureCount, status: failureCount >= 5 ? "failed" : current.status }); }
  if (action === "scan" && current.status === "pending") return pairingSessionSchema.parse({ ...current, status: "scanned", scannedAt: at });
  if (action === "confirm" && current.status === "scanned") return pairingSessionSchema.parse({ ...current, status: "confirmed", confirmedAt: at });
  throw new Error("扫码会话状态不允许该操作");
}

export function consumePairingSession(session: PairingSession, token: string, identity: { channelUserId: string; chatId: string; scope: "direct" | "group" }, now = new Date()): { session: PairingSession; binding: ChannelBinding } {
  const current = normalizeExpiry(session, now);
  if (current.status !== "confirmed") throw new Error(current.status === "expired" ? "二维码已过期" : "扫码授权尚未确认");
  const supplied = Buffer.from(digest(token)); const expected = Buffer.from(current.tokenHash);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("扫码凭证无效");
  const consumedAt = now.toISOString();
  const consumed = pairingSessionSchema.parse({ ...current, status: "consumed", consumedAt });
  const binding = channelBindingSchema.parse({ id: randomUUID(), channel: current.channel, channelUserId: identity.channelUserId, chatId: identity.chatId, deviceInstallationId: current.deviceInstallationId, scope: identity.scope, status: "active", createdAt: consumedAt, lastVerifiedAt: consumedAt });
  return { session: consumed, binding };
}

export function normalizeExpiry(session: PairingSession, now = new Date()): PairingSession { return new Date(session.expiresAt).getTime() <= now.getTime() && !["consumed", "cancelled", "failed"].includes(session.status) ? pairingSessionSchema.parse({ ...session, status: "expired" }) : session; }

export function canonicalDeviceRequest(method: string, path: string, body: Uint8Array | string, request: Omit<SignedDeviceRequest, "signature">) { return [method.toUpperCase(), path, digest(body), String(request.timestamp), request.nonce, request.deviceInstallationId].join("\n"); }

export class ReplayWindow {
  private readonly seen = new Map<string, number>();
  claim(deviceId: string, nonce: string, timestamp: number, now = Date.now()) {
    if (Math.abs(now - timestamp) > DEVICE_SIGNATURE_WINDOW_MS) throw new Error("设备请求已过期");
    for (const [key, expiresAt] of this.seen) if (expiresAt <= now) this.seen.delete(key);
    const key = `${deviceId}:${nonce}`; if (this.seen.has(key)) throw new Error("设备请求已被处理");
    this.seen.set(key, now + DEVICE_SIGNATURE_WINDOW_MS);
  }
}

export function verifyDeviceRequest(method: string, path: string, body: Uint8Array | string, rawRequest: SignedDeviceRequest, publicKeyPem: string, replay: ReplayWindow, now = Date.now()) {
  const request = signedDeviceRequestSchema.parse(rawRequest);
  if (Math.abs(now - request.timestamp) > DEVICE_SIGNATURE_WINDOW_MS) throw new Error("设备请求已过期");
  const canonical = canonicalDeviceRequest(method, path, body, request);
  if (!verify(null, Buffer.from(canonical), publicKeyPem, Buffer.from(request.signature, "base64url"))) throw new Error("设备签名验证失败");
  replay.claim(request.deviceInstallationId, request.nonce, request.timestamp, now);
  return request;
}

export class EventDeduplicator {
  private readonly keys = new Set<string>();
  claim(channel: Channel, providerEventId: string) { const key = `${channel}:${providerEventId}`; if (this.keys.has(key)) return false; this.keys.add(key); return true; }
}

export function digest(value: Uint8Array | string) { return createHash("sha256").update(value).digest("hex"); }
