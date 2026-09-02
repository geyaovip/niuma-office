import type { ChannelBinding, ChannelEnvelope, PairingSession } from "@niuma/contracts";
import type { DeviceIdentityRepository } from "./device-identity-repository.js";

export interface PublicPairingSession extends Omit<PairingSession, "tokenHash"> {}
export interface TelegramPairingResponse { session: PublicPairingSession; deepLink: string }
export interface PlatformModelSession { accessToken: string; expiresAt: string; baseUrl: string; modelId: string }

export class ChannelClient {
  readonly configured: boolean; private registered = false; private readonly baseUrl?: string;
  constructor(baseUrl: string | undefined, private readonly identity: DeviceIdentityRepository, private readonly fetcher: typeof fetch = fetch) { this.configured = Boolean(baseUrl); if (baseUrl) { validateBaseUrl(baseUrl); this.baseUrl = baseUrl.replace(/\/$/, ""); } }
  async register() { this.requireBaseUrl(); if (this.registered) return; const identity = this.identity.getPublicIdentity(); await this.request("/v1/devices/register", { method: "POST", body: identity, signed: true }); this.registered = true; }
  async createModelSession(): Promise<PlatformModelSession> { await this.register(); return this.request("/v1/model-gateway/sessions", { method: "POST", signed: true }) as Promise<PlatformModelSession>; }
  async listBindings(): Promise<ChannelBinding[]> { await this.register(); return (await this.request("/v1/channels", { method: "GET", signed: true }) as { bindings: ChannelBinding[] }).bindings; }
  async createTelegramPairing(): Promise<TelegramPairingResponse> { await this.register(); return this.request("/v1/channels/telegram/pairing-sessions", { method: "POST", signed: true }) as Promise<TelegramPairingResponse>; }
  async getTelegramPairing(id: string): Promise<PublicPairingSession> { await this.register(); return (await this.request(`/v1/channels/telegram/pairing-sessions/${encodeURIComponent(id)}`, { method: "GET", signed: true }) as { session: PublicPairingSession }).session; }
  async cancelTelegramPairing(id: string): Promise<PublicPairingSession> { await this.register(); return (await this.request(`/v1/channels/telegram/pairing-sessions/${encodeURIComponent(id)}`, { method: "DELETE", signed: true }) as { session: PublicPairingSession }).session; }
  async revokeBinding(id: string): Promise<ChannelBinding> { await this.register(); return (await this.request(`/v1/channels/${encodeURIComponent(id)}`, { method: "DELETE", signed: true }) as { binding: ChannelBinding }).binding; }
  async pull(): Promise<ChannelEnvelope[]> { await this.register(); return (await this.request("/v1/deliveries/pull", { method: "POST", signed: true }) as { deliveries: ChannelEnvelope[] }).deliveries; }
  async acknowledge(envelopeId: string, input: { taskId: string; state: "accepted" | "running" | "waiting_user" | "completed" | "failed"; summary?: string }) { await this.register(); await this.request(`/v1/deliveries/${encodeURIComponent(envelopeId)}/ack`, { method: "POST", body: input, signed: true }); }

  private async request(path: string, options: { method: "GET" | "POST" | "DELETE"; body?: unknown; signed: boolean }): Promise<unknown> {
    const baseUrl = this.requireBaseUrl(); const body = options.body === undefined ? undefined : JSON.stringify(options.body); const headers: Record<string, string> = { accept: "application/json" }; if (body) headers["content-type"] = "application/json";
    if (options.signed) { const signed = this.identity.sign(options.method, path, body ?? ""); headers["x-niuma-device-id"] = signed.deviceInstallationId; headers["x-niuma-timestamp"] = String(signed.timestamp); headers["x-niuma-nonce"] = signed.nonce; headers["x-niuma-signature"] = signed.signature; }
    let response: Response; try { response = await this.fetcher(`${baseUrl}${path}`, { method: options.method, headers, body, signal: AbortSignal.timeout(10_000) }); } catch { throw new Error("暂时无法连接牛马云服务"); }
    const payload = await response.json().catch(() => ({})) as { message?: string }; if (!response.ok) throw new Error(payload.message || `牛马云服务请求失败 (${response.status})`); return payload;
  }
  private requireBaseUrl() { if (!this.baseUrl) throw new Error("当前内部版未配置消息渠道服务"); return this.baseUrl; }
}
function validateBaseUrl(value: string) { const url = new URL(value); if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("消息渠道服务地址格式无效"); if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error("消息渠道服务必须使用 HTTPS"); }
