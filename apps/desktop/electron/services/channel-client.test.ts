import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { verifyDeviceRequest, ReplayWindow } from "@niuma/channel-adapter";
import { ChannelClient } from "./channel-client.js";
import { DeviceIdentityRepository } from "./device-identity-repository.js";

const secureStorage = { available: () => true, encrypt: (value: string) => Buffer.from(value).toString("base64"), decrypt: (value: string) => Buffer.from(value, "base64").toString() };

describe("ChannelClient", () => {
  it("uses a self-signed registration request and registers only once", async () => {
    const identity = new DeviceIdentityRepository(await mkdtemp(join(tmpdir(), "niuma-channel-client-")), secureStorage);
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const body = String(init?.body ?? "");
      const publicIdentity = identity.getPublicIdentity();
      verifyDeviceRequest("POST", "/v1/devices/register", body, { deviceInstallationId: headers["x-niuma-device-id"]!, timestamp: Number(headers["x-niuma-timestamp"]), nonce: headers["x-niuma-nonce"]!, signature: headers["x-niuma-signature"]! }, publicIdentity.publicKeyPem, new ReplayWindow());
      return new Response(JSON.stringify({ deviceInstallationId: publicIdentity.deviceInstallationId, registered: true }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = new ChannelClient("https://channels.example.com", identity, fetcher as typeof fetch);
    await client.register(); await client.register();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]![0])).toBe("https://channels.example.com/v1/devices/register");
  });

  it("rejects unconfigured or insecure remote service addresses", async () => {
    const identity = new DeviceIdentityRepository(await mkdtemp(join(tmpdir(), "niuma-channel-url-")), secureStorage);
    await expect(new ChannelClient(undefined, identity).listBindings()).rejects.toThrow("未配置消息渠道服务");
    expect(() => new ChannelClient("http://channels.example.com", identity)).toThrow("必须使用 HTTPS");
  });

  it("requests a platform model session with the device signature and never receives the upstream key", async () => {
    const identity = new DeviceIdentityRepository(await mkdtemp(join(tmpdir(), "niuma-model-session-")), secureStorage);
    const replay = new ReplayWindow();
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const body = String(init?.body ?? "");
      const publicIdentity = identity.getPublicIdentity();
      verifyDeviceRequest("POST", path, body, { deviceInstallationId: headers["x-niuma-device-id"]!, timestamp: Number(headers["x-niuma-timestamp"]), nonce: headers["x-niuma-nonce"]!, signature: headers["x-niuma-signature"]! }, publicIdentity.publicKeyPem, replay);
      if (path === "/v1/devices/register") return new Response(JSON.stringify({ registered: true }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ accessToken: "t".repeat(48), expiresAt: new Date(Date.now() + 60_000).toISOString(), baseUrl: "https://api.example.com/v1/model-gateway", modelId: "auto" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const session = await new ChannelClient("https://api.example.com", identity, fetcher as typeof fetch).createModelSession();
    expect(session).toMatchObject({ accessToken: "t".repeat(48), baseUrl: "https://api.example.com/v1/model-gateway", modelId: "auto" });
    expect(JSON.stringify(session)).not.toContain("doubao");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
