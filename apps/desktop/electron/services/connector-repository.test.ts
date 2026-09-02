import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectorRepository } from "./connector-repository";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const cipher = { available: () => true, encrypt: (value: string) => Buffer.from(`sealed:${value}`).toString("base64"), decrypt: (value: string) => Buffer.from(value, "base64").toString("utf8").replace(/^sealed:/, "") };

describe("ConnectorRepository", () => {
  it("内置连接器默认就绪且远程 MCP 默认未配置", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-connectors-")); roots.push(root);
    const items = await new ConnectorRepository(root, cipher).list();
    expect(items.find(item => item.definition.id === "local-files")?.installation.status).toBe("active");
    expect(items.find(item => item.definition.id === "public-web")?.installation.status).toBe("active");
    expect(items.find(item => item.definition.id === "remote-mcp")?.installation).toMatchObject({ status: "disabled", hasCredential: false });
  });

  it("只保存加密凭证且公开结果不返回原文", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-connectors-")); roots.push(root);
    const repository = new ConnectorRepository(root, cipher);
    const items = await repository.configureRemote({ displayName: "公司知识库", endpoint: "https://mcp.example.com/api", transport: "streamable-http", credential: "very-secret-token" });
    expect(items.find(item => item.definition.id === "remote-mcp")?.installation).toMatchObject({ hasCredential: true, status: "disabled" });
    const stored = await readFile(join(root, "data", "connectors.json"), "utf8");
    expect(stored).not.toContain("very-secret-token");
    expect(stored).not.toContain("credential\"");
  });

  it("拒绝非 HTTPS、URL 凭证、查询参数和未知字段", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-connectors-")); roots.push(root);
    const repository = new ConnectorRepository(root, cipher);
    await expect(repository.configureRemote({ displayName: "测试", endpoint: "http://example.com/mcp", transport: "sse" })).rejects.toThrow("HTTPS");
    await expect(repository.configureRemote({ displayName: "测试", endpoint: "https://user:pass@example.com/mcp", transport: "sse" })).rejects.toThrow("HTTPS");
    await expect(repository.configureRemote({ displayName: "测试", endpoint: "https://example.com/mcp?token=secret", transport: "sse" })).rejects.toThrow("HTTPS");
    await expect(repository.configureRemote({ displayName: "测试", endpoint: "https://example.com/mcp", transport: "sse", unknown: true })).rejects.toThrow();
  });

  it("完成真实 MCP initialize 握手后启用连接器", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-connectors-")); roots.push(root);
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { expect(String(init?.headers && (init.headers as Record<string, string>).Authorization)).toBe("Bearer test-token"); expect(String(init?.body)).toContain('"method":"initialize"'); return new Response(JSON.stringify({ jsonrpc: "2.0", id: "niuma-connection-test", result: { protocolVersion: "2025-06-18", serverInfo: { name: "test", version: "1" }, capabilities: {} } }), { status: 200, headers: { "content-type": "application/json" } }); });
    const repository = new ConnectorRepository(root, cipher, fetcher as typeof fetch);
    await repository.configureRemote({ displayName: "公司知识库", endpoint: "https://mcp.example.com/api", transport: "streamable-http", credential: "test-token" });
    const items = await repository.testRemote();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(items.find(item => item.definition.id === "remote-mcp")?.installation).toMatchObject({ status: "active", lastTest: { state: "success" } });
  });

  it("鉴权失败时保存可恢复状态且不暴露服务响应", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-connectors-")); roots.push(root);
    const repository = new ConnectorRepository(root, cipher, vi.fn(async () => new Response("provider secret details", { status: 401 })) as typeof fetch);
    await repository.configureRemote({ displayName: "公司知识库", endpoint: "https://mcp.example.com/api", transport: "streamable-http" });
    const items = await repository.testRemote();
    const remote = items.find(item => item.definition.id === "remote-mcp")!;
    expect(remote.installation).toMatchObject({ status: "failed", lastTest: { state: "failed", message: "凭证无效或权限不足。" } });
    expect(JSON.stringify(remote)).not.toContain("provider secret details");
  });

  it("重启后恢复连接状态，停用时拒绝任务调用并可重新启用", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-connectors-")); roots.push(root);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: "niuma-connection-test", result: { protocolVersion: "2025-06-18", capabilities: {} } }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const first = new ConnectorRepository(root, cipher, fetcher);
    await first.configureRemote({ displayName: "公司知识库", endpoint: "https://mcp.example.com/api", transport: "streamable-http", credential: "restart-token" });
    const activeItems = await first.testRemote();
    const active = activeItems.find(item => item.definition.id === "remote-mcp")!;
    const snapshot = { id: active.definition.id, version: active.definition.version, configurationDigest: active.definition.configurationDigest };

    const restarted = new ConnectorRepository(root, cipher, fetcher);
    expect((await restarted.list()).find(item => item.definition.id === "remote-mcp")?.installation).toMatchObject({ status: "active", hasCredential: true, displayName: "公司知识库" });
    expect(await restarted.resolveSnapshots([snapshot])).toEqual([{ id: "remote-mcp", name: "公司知识库", kind: "remote_mcp", endpoint: "https://mcp.example.com/api", transport: "streamable-http", credential: "restart-token" }]);

    await restarted.setEnabled("remote-mcp", false);
    await expect(restarted.resolveSnapshots([snapshot])).rejects.toThrow("当前不可用");
    await restarted.setEnabled("remote-mcp", true);
    expect(await restarted.resolveSnapshots([snapshot])).toHaveLength(1);
  });

  it("更新配置可以删除既有凭证并让旧任务快照失效", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-connectors-")); roots.push(root);
    const repository = new ConnectorRepository(root, cipher);
    const initialItems = await repository.configureRemote({ displayName: "旧知识库", endpoint: "https://mcp.example.com/old", transport: "sse", credential: "remove-me" });
    const initial = initialItems.find(item => item.definition.id === "remote-mcp")!;
    await repository.configureRemote({ displayName: "新知识库", endpoint: "https://mcp.example.com/new", transport: "streamable-http", clearCredential: true });

    const restarted = new ConnectorRepository(root, cipher);
    const updated = (await restarted.list()).find(item => item.definition.id === "remote-mcp")!;
    expect(updated.installation).toMatchObject({ status: "disabled", hasCredential: false, displayName: "新知识库", endpoint: "https://mcp.example.com/new" });
    const stored = await readFile(join(root, "data", "connectors.json"), "utf8");
    expect(stored).not.toContain("encryptedCredential");
    await expect(restarted.resolveSnapshots([{ id: initial.definition.id, version: initial.definition.version, configurationDigest: initial.definition.configurationDigest }])).rejects.toThrow("当前不可用");
  });
});
