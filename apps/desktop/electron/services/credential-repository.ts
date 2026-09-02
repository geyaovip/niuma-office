import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

interface CredentialCipher { available(): boolean; encrypt(value: string): string; decrypt(value: string): string }
interface StoredCredential { name: string; encryptedValue: string; allowedHosts: string[]; updatedAt: string }

export class CredentialRepository {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(root: string, private readonly cipher: CredentialCipher) {
    this.file = join(root, "credentials", "vault.json");
  }

  async store(name: string, value: string, allowedHosts: string[] = []) {
    const normalizedName = normalizeName(name);
    const secret = value.trim();
    if (!secret || secret.length > 16_384) throw new Error("凭证内容无效");
    if (!this.cipher.available()) throw new Error("系统钥匙串当前不可用，无法安全保存凭证");
    const hosts = normalizeHosts(allowedHosts);
    if (hosts.length === 0) throw new Error("缺少凭证授权域名，请仅用于本次任务");
    return this.mutate(items => [...items.filter(item => item.name !== normalizedName), { name: normalizedName, encryptedValue: this.cipher.encrypt(secret), allowedHosts: hosts, updatedAt: new Date().toISOString() }]);
  }

  async resolve(name: string, requestedHosts: string[] = []): Promise<string | undefined> {
    if (!this.cipher.available()) return undefined;
    const item = (await this.read()).find(entry => entry.name === normalizeName(name));
    if (!item) return undefined;
    const requested = normalizeHosts(requestedHosts);
    if (item.allowedHosts.length === 0 || requested.length === 0) return undefined;
    if (requested.some(host => !item.allowedHosts.includes(host))) return undefined;
    try { return this.cipher.decrypt(item.encryptedValue); } catch { return undefined; }
  }

  private async read(): Promise<StoredCredential[]> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8"));
      return Array.isArray(parsed) ? parsed.filter(isStoredCredential) : [];
    } catch { return []; }
  }

  private mutate(change: (items: StoredCredential[]) => StoredCredential[]) {
    const operation = this.queue.then(async () => {
      const items = change(await this.read());
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, `${JSON.stringify(items, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.file);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}

function normalizeName(value: string) {
  const name = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(name)) throw new Error("凭证名称无效");
  return name;
}

function normalizeHosts(values: string[]) {
  return [...new Set(values.flatMap(value => {
    const host = value.trim().toLowerCase();
    if (!host) return [];
    if (!/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(host) || host.includes("..")) throw new Error("凭证授权域名无效");
    return [host];
  }))].sort();
}

function isStoredCredential(value: unknown): value is StoredCredential {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StoredCredential>;
  return typeof item.name === "string" && typeof item.encryptedValue === "string" && Array.isArray(item.allowedHosts) && item.allowedHosts.every(host => typeof host === "string") && typeof item.updatedAt === "string";
}
