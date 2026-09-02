import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalDeviceRequest } from "@niuma/channel-adapter";
import { signedDeviceRequestSchema, type SignedDeviceRequest } from "@niuma/contracts";

interface SecureStorage { available(): boolean; encrypt(value: string): string; decrypt(value: string): string }
interface StoredIdentity { version: 1; deviceInstallationId: string; publicKeyPem: string; encryptedPrivateKey: string; createdAt: string }

export class DeviceIdentityRepository {
  private readonly path: string;
  private identity?: StoredIdentity;
  constructor(rootPath: string, private readonly secureStorage: SecureStorage) {
    const directory = resolve(rootPath, "identity"); mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
    this.path = resolve(directory, "device-identity.json");
  }

  getPublicIdentity() { const identity = this.load(); return { deviceInstallationId: identity.deviceInstallationId, publicKeyPem: identity.publicKeyPem, createdAt: identity.createdAt }; }

  sign(method: string, path: string, body: Uint8Array | string, now = Date.now()): SignedDeviceRequest {
    const identity = this.load();
    const unsigned = { deviceInstallationId: identity.deviceInstallationId, timestamp: now, nonce: randomBytes(18).toString("base64url") };
    const canonical = canonicalDeviceRequest(method, path, body, unsigned);
    const signature = sign(null, Buffer.from(canonical), this.secureStorage.decrypt(identity.encryptedPrivateKey)).toString("base64url");
    return signedDeviceRequestSchema.parse({ ...unsigned, signature });
  }

  private load(): StoredIdentity {
    if (this.identity) return this.identity;
    if (!this.secureStorage.available()) throw new Error("无法使用 macOS 安全存储，请解锁系统后重试");
    if (existsSync(this.path)) {
      try {
        const parsed = JSON.parse(readFileSync(this.path, "utf8")) as StoredIdentity;
        if (parsed.version !== 1 || !/^[0-9a-f-]{36}$/i.test(parsed.deviceInstallationId) || !parsed.publicKeyPem.includes("PUBLIC KEY") || !parsed.encryptedPrivateKey) throw new Error("invalid");
        this.secureStorage.decrypt(parsed.encryptedPrivateKey);
        this.identity = parsed; return parsed;
      } catch { throw new Error("设备身份数据损坏，请联系支持处理"); }
    }
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const identity: StoredIdentity = { version: 1, deviceInstallationId: randomUUID(), publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(), encryptedPrivateKey: this.secureStorage.encrypt(privateKey.export({ type: "pkcs8", format: "pem" }).toString()), createdAt: new Date().toISOString() };
    writeFileSync(this.path, JSON.stringify(identity, null, 2), { encoding: "utf8", mode: 0o600 }); chmodSync(this.path, 0o600);
    this.identity = identity; return identity;
  }
}
