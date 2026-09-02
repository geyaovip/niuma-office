import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ReplayWindow, verifyDeviceRequest } from "@niuma/channel-adapter";
import { DeviceIdentityRepository } from "./device-identity-repository.js";

const secureStorage = { available: () => true, encrypt: (value: string) => Buffer.from(value).toString("base64"), decrypt: (value: string) => Buffer.from(value, "base64").toString() };

describe("DeviceIdentityRepository", () => {
  it("persists one installation identity and signs verifiable requests", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-identity-")); const first = new DeviceIdentityRepository(root, secureStorage);
    const identity = first.getPublicIdentity(); const request = first.sign("POST", "/v1/pairing", "{}", 1_800_000);
    expect(verifyDeviceRequest("POST", "/v1/pairing", "{}", request, identity.publicKeyPem, new ReplayWindow(), 1_800_000)).toMatchObject({ deviceInstallationId: identity.deviceInstallationId });
    expect(new DeviceIdentityRepository(root, secureStorage).getPublicIdentity().deviceInstallationId).toBe(identity.deviceInstallationId);
    expect((await stat(join(root, "identity", "device-identity.json"))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(root, "identity", "device-identity.json"), "utf8")).not.toContain("PRIVATE KEY");
  });
  it("does not silently replace a damaged identity", async () => { const root = await mkdtemp(join(tmpdir(), "niuma-identity-bad-")); const repository = new DeviceIdentityRepository(root, secureStorage); repository.getPublicIdentity(); await writeFile(join(root, "identity", "device-identity.json"), "{}", "utf8"); expect(() => new DeviceIdentityRepository(root, secureStorage).getPublicIdentity()).toThrow("设备身份数据损坏"); });
});
