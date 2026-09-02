import { safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface PublicModelSettings {
  provider: "volcengine";
  baseUrl: string;
  modelId: string;
  displayName: string;
  hasApiKey: boolean;
}

interface StoredModelSettings extends Omit<PublicModelSettings, "hasApiKey"> {
  encryptedApiKey?: string;
}

const DEFAULT_SETTINGS: PublicModelSettings = {
  provider: "volcengine",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  modelId: "",
  displayName: "自定义模型",
  hasApiKey: false,
};

const ARK_HOST = "ark.cn-beijing.volces.com";

export class ModelSettingsRepository {
  private readonly file: string;

  constructor(appDataPath: string) {
    this.file = join(appDataPath, "牛马办公", "config", "model-settings.json");
  }

  async getPublic(): Promise<PublicModelSettings> {
    const stored = await this.read();
    return { provider: "volcengine", baseUrl: stored.baseUrl, modelId: stored.modelId, displayName: stored.displayName, hasApiKey: Boolean(stored.encryptedApiKey) };
  }

  async save(input: unknown): Promise<PublicModelSettings> {
    if (!input || typeof input !== "object") throw new Error("模型设置格式无效");
    const value = input as { baseUrl?: unknown; modelId?: unknown; displayName?: unknown; apiKey?: unknown; clearApiKey?: unknown };
    const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl.trim() : "";
    const modelId = typeof value.modelId === "string" ? value.modelId.trim() : "";
    const displayName = typeof value.displayName === "string" ? value.displayName.trim().slice(0, 40) : "";
    let parsedUrl: URL;
    try { parsedUrl = new URL(baseUrl); } catch { throw new Error("模型服务地址无效"); }
    if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== ARK_HOST) throw new Error("当前版本仅允许连接火山方舟官方服务");
    const current = await this.read();
    let encryptedApiKey = value.clearApiKey === true ? undefined : current.encryptedApiKey;
    if (typeof value.apiKey === "string" && value.apiKey.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("系统钥匙串当前不可用，无法安全保存 API Key");
      encryptedApiKey = safeStorage.encryptString(value.apiKey.trim()).toString("base64");
    }
    await this.write({ provider: "volcengine", baseUrl, modelId, displayName: displayName || "自定义模型", encryptedApiKey });
    return { provider: "volcengine", baseUrl, modelId, displayName: displayName || "自定义模型", hasApiKey: Boolean(encryptedApiKey) };
  }

  async getApiKey(): Promise<string | undefined> {
    const stored = await this.read();
    if (!stored.encryptedApiKey || !safeStorage.isEncryptionAvailable()) return undefined;
    return safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, "base64"));
  }

  private async read(): Promise<StoredModelSettings> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<StoredModelSettings>;
      return { provider: "volcengine", baseUrl: parsed.baseUrl || DEFAULT_SETTINGS.baseUrl, modelId: parsed.modelId || "", displayName: parsed.displayName || DEFAULT_SETTINGS.displayName, encryptedApiKey: parsed.encryptedApiKey };
    } catch {
      return { provider: "volcengine", baseUrl: DEFAULT_SETTINGS.baseUrl, modelId: "", displayName: DEFAULT_SETTINGS.displayName };
    }
  }

  private async write(settings: StoredModelSettings) {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.file);
  }
}
