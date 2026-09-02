import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

type ConnectorStatus = "active" | "disabled" | "failed";
interface Cipher { available(): boolean; encrypt(value: string): string; decrypt(value: string): string }
interface StoredInstallation { connectorId: string; version: string; status: ConnectorStatus; displayName: string; endpoint?: string; transport?: "streamable-http" | "sse"; encryptedCredential?: string; updatedAt: string; lastTest?: { state: "success" | "failed"; testedAt: string; message: string } }
interface Definition { id: string; name: string; version: string; summary: string; category: string; kind: "builtin" | "remote_mcp"; source: string; license: string; capabilities: string[]; permissions: string[]; configurable: boolean }

const definitions: Definition[] = [
  { id: "local-files", name: "本地文件", version: "1.0.0", summary: "在当前任务或项目工作空间内读取资料并创建交付文件。", category: "本机能力", kind: "builtin", source: "牛马办公内置", license: "牛马办公内置许可", capabilities: ["读取任务附件", "读取项目资料", "创建交付文件"], permissions: ["workspace.read", "workspace.write"], configurable: false },
  { id: "public-web", name: "公开网页", version: "1.0.0", summary: "访问公开网页，提取信息并保留可追溯来源。", category: "信息获取", kind: "builtin", source: "牛马办公内置", license: "牛马办公内置许可", capabilities: ["访问公开网页", "提取页面信息", "记录来源链接"], permissions: ["network.public", "external.read"], configurable: false },
  { id: "remote-mcp", name: "远程 MCP", version: "1.0.0", summary: "连接经过用户确认的 HTTPS MCP 服务，并仅开放只读工具。", category: "自定义连接", kind: "remote_mcp", source: "用户配置", license: "由所连接服务提供方决定", capabilities: ["发现只读工具", "读取外部服务数据", "在任务中按需调用"], permissions: ["network.public", "external.read"], configurable: true },
];

const configurationSchema = z.object({ displayName: z.string().trim().min(1).max(40), endpoint: z.string().url(), transport: z.enum(["streamable-http", "sse"]), credential: z.string().trim().max(4096).optional(), clearCredential: z.boolean().optional() }).strict();

export class ConnectorRepository {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(root: string, private readonly cipher: Cipher, private readonly fetcher: typeof fetch = fetch) { this.file = join(root, "data", "connectors.json"); }

  async list() { const stored = await this.read(); return definitions.map(definition => ({ definition: snapshotDefinition(definition, stored.find(item => item.connectorId === definition.id)), installation: publicInstallation(definition, stored.find(item => item.connectorId === definition.id)) })); }

  async configureRemote(input: unknown) {
    const value = configurationSchema.parse(input); const url = new URL(value.endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("MCP 地址必须是无账号、查询参数和片段的 HTTPS 地址");
    if (!this.cipher.available() && value.credential) throw new Error("系统钥匙串当前不可用，无法安全保存凭证");
    return this.mutate(async items => { const current = items.find(item => item.connectorId === "remote-mcp"); let encryptedCredential = value.clearCredential ? undefined : current?.encryptedCredential; if (value.credential) encryptedCredential = this.cipher.encrypt(value.credential); const updated: StoredInstallation = { connectorId: "remote-mcp", version: "1.0.0", status: "disabled", displayName: value.displayName, endpoint: url.toString(), transport: value.transport, encryptedCredential, updatedAt: new Date().toISOString() }; return [...items.filter(item => item.connectorId !== "remote-mcp"), updated]; });
  }

  async testRemote() {
    const current = (await this.read()).find(item => item.connectorId === "remote-mcp"); if (!current?.endpoint || !current.transport) throw new Error("请先保存远程 MCP 配置");
    const testedAt = new Date().toISOString();
    try {
      const credential = current.encryptedCredential ? this.cipher.decrypt(current.encryptedCredential) : undefined;
      const response = await this.fetcher(current.endpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: "niuma-connection-test", method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "牛马办公", version: "0.1.0" } } }), signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "凭证无效或权限不足" : `服务返回 HTTP ${response.status}`);
      const payload = await parseMcpResponse(response); if (!payload || payload.error || !payload.result) throw new Error("服务未返回有效的 MCP 初始化结果");
      return this.updateTest(current, { state: "success", testedAt, message: "连接正常，已启用只读工具。" }, "active");
    } catch (error) { const message = normalizeConnectionError(error); return this.updateTest(current, { state: "failed", testedAt, message }, "failed"); }
  }

  async setEnabled(connectorId: string, enabled: boolean) { if (connectorId !== "remote-mcp") throw new Error("内置连接器由任务权限统一管理"); return this.mutate(async items => { const current = items.find(item => item.connectorId === connectorId); if (!current) throw new Error("请先配置此连接器"); if (enabled && current.lastTest?.state !== "success") throw new Error("重新启用前需要通过连接测试"); return [...items.filter(item => item.connectorId !== connectorId), { ...current, status: enabled ? "active" as const : "disabled" as const, updatedAt: new Date().toISOString() }]; }); }

  async resolveSnapshots(snapshots: Array<{ id: string; version: string; configurationDigest: string }>, permissionMode: "restricted" | "default" | "full" = "default") {
    const items = await this.read(); const allowed = permissionMode === "restricted" ? new Set(["workspace.read"]) : permissionMode === "default" ? new Set(["workspace.read", "workspace.write", "network.public", "external.read"]) : new Set(["workspace.read", "workspace.write", "network.public", "external.read", "external.send", "external.delete", "purchase"]);
    return snapshots.map(snapshot => { const definition = definitions.find(item => item.id === snapshot.id && item.version === snapshot.version); const stored = items.find(item => item.connectorId === snapshot.id); if (!definition) throw new Error(`连接器“${snapshot.id}”当前不可用，请重新选择`); const publicItem = publicInstallation(definition, stored); if (publicItem.status !== "active" || snapshotDefinition(definition, stored).configurationDigest !== snapshot.configurationDigest) throw new Error(`连接器“${snapshot.id}”当前不可用，请重新选择`); const denied = definition.permissions.find(permission => !allowed.has(permission)); if (denied) throw new Error(`当前任务权限不足以使用连接器“${definition.name}”`); if (definition.kind === "remote_mcp") return { id: definition.id, name: stored!.displayName, kind: definition.kind, endpoint: stored!.endpoint!, transport: stored!.transport!, credential: stored!.encryptedCredential ? this.cipher.decrypt(stored!.encryptedCredential) : undefined }; return { id: definition.id, name: definition.name, kind: definition.kind }; });
  }

  private async updateTest(current: StoredInstallation, lastTest: StoredInstallation["lastTest"], status: ConnectorStatus) { return this.mutate(async items => [...items.filter(item => item.connectorId !== current.connectorId), { ...current, status, lastTest, updatedAt: new Date().toISOString() }]); }
  private async read(): Promise<StoredInstallation[]> { try { const parsed = JSON.parse(await readFile(this.file, "utf8")); return Array.isArray(parsed) ? parsed.filter(isStored) : []; } catch { return []; } }
  private async mutate(change: (items: StoredInstallation[]) => Promise<StoredInstallation[]>) { const operation = this.queue.then(async () => { const items = await change(await this.read()); await mkdir(dirname(this.file), { recursive: true }); const temporary = `${this.file}.tmp`; await writeFile(temporary, `${JSON.stringify(items, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }); await rename(temporary, this.file); return this.list(); }); this.queue = operation.catch(() => undefined); return operation; }
}

function snapshotDefinition(definition: Definition, stored?: StoredInstallation) { return { id: definition.id, name: stored?.displayName || definition.name, version: definition.version, summary: definition.summary, category: definition.category, kind: definition.kind, source: definition.source, license: definition.license, capabilities: [...definition.capabilities], permissions: [...definition.permissions], configurable: definition.configurable, configurationDigest: digest(JSON.stringify({ id: definition.id, version: definition.version, endpoint: stored?.endpoint, transport: stored?.transport })) }; }
function publicInstallation(definition: Definition, stored?: StoredInstallation) { const now = stored?.updatedAt || "2026-08-30T00:00:00.000Z"; if (definition.kind === "builtin") return { connectorId: definition.id, version: definition.version, status: "active" as const, displayName: definition.name, hasCredential: false, updatedAt: now, lastTest: { state: "success" as const, testedAt: now, message: "内置能力已就绪。" } }; return { connectorId: definition.id, version: definition.version, status: stored?.status ?? "disabled" as const, displayName: stored?.displayName || definition.name, endpoint: stored?.endpoint, transport: stored?.transport, hasCredential: Boolean(stored?.encryptedCredential), updatedAt: now, lastTest: stored?.lastTest }; }
function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
function isStored(value: unknown): value is StoredInstallation { if (!value || typeof value !== "object") return false; const item = value as Partial<StoredInstallation>; return item.connectorId === "remote-mcp" && item.version === "1.0.0" && ["active", "disabled", "failed"].includes(item.status ?? "") && typeof item.displayName === "string" && typeof item.updatedAt === "string" && (item.encryptedCredential === undefined || typeof item.encryptedCredential === "string"); }
async function parseMcpResponse(response: Response) { const text = await response.text(); if ((response.headers.get("content-type") || "").includes("text/event-stream")) { const data = text.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).filter(Boolean).at(-1); return data ? JSON.parse(data) : undefined; } return JSON.parse(text); }
function normalizeConnectionError(error: unknown) { const message = error instanceof Error ? error.message : "连接失败"; if (/abort|timeout/i.test(message)) return "连接超时，请检查服务地址和网络后重试。"; if (/凭证|401|403/.test(message)) return "凭证无效或权限不足。"; if (/fetch|network|ECONN|ENOTFOUND/i.test(message)) return "无法连接服务，请检查地址和网络。"; if (/HTTP \d+/.test(message)) return `${message}，请稍后重试。`; return "服务未完成 MCP 握手，请检查服务兼容性。"; }
