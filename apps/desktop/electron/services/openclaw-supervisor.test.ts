import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GatewayClient, startGatewayClientWhenEventLoopReady } from "@openclaw/gateway-client";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import { afterEach, describe, expect, it } from "vitest";
import { OpenClawSupervisor } from "./openclaw-supervisor";

const roots: string[] = [];
const supervisors: OpenClawSupervisor[] = [];

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map(supervisor => supervisor.stop()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function createSupervisor() {
  const root = await mkdtemp(join(tmpdir(), "niuma-runtime-"));
  roots.push(root);
  const supervisor = new OpenClawSupervisor(root, join(process.cwd(), "runtime"));
  supervisors.push(supervisor);
  return supervisor;
}

describe("OpenClawSupervisor", () => {
  it("校验安装包内固定的 Node 与 OpenClaw 版本", async () => {
    const supervisor = await createSupervisor();
    const installation = await supervisor.verifyInstallation();
    expect(installation.nodeVersion).toBe("v24.15.0");
    expect(installation.openClawVersion).toContain("2026.8.2");
  });

  it("并发启动只创建一个就绪网关，并能正常停止", async () => {
    const supervisor = await createSupervisor();
    await supervisor.configure({
      apiKey: "test-only-key",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      modelId: "test-endpoint",
      workspacePath: join(roots[0]!, "workspace"),
      permissionMode: "default",
    });
    const [first, second] = await Promise.all([supervisor.start(), supervisor.start()]);
    expect(first).toEqual({ state: "ready", message: "办公引擎已就绪" });
    expect(second).toEqual(first);
    expect(supervisor.getCommand().env.OPENCLAW_GATEWAY_PORT).toMatch(/^\d+$/);
    const connection = supervisor.getGatewayConnection();
    let connected!: () => void;
    const hello = new Promise<void>(resolve => { connected = resolve; });
    const client = new GatewayClient({
      url: connection.url,
      token: connection.token,
      clientName: "gateway-client",
      clientDisplayName: "niuma-runtime-test",
      clientVersion: "0.1.0",
      platform: process.platform,
      mode: "backend",
      deviceIdentity: null,
      caps: ["tool-events"],
      instanceId: randomUUID(),
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      onHelloOk: connected,
      onEvent: () => undefined,
      onClose: () => undefined,
      onGap: () => undefined,
    });
    const readiness = await startGatewayClientWhenEventLoopReady(client, { clientOptions: { preauthHandshakeTimeoutMs: 10_000 } });
    expect(readiness.ready).toBe(true);
    await Promise.race([hello, new Promise((_, reject) => setTimeout(() => reject(new Error("gateway hello timeout")), 10_000))]);
    expect(await client.request("status", {})).toBeTruthy();
    client.stop();
    await supervisor.stop();
    expect(supervisor.getStatus()).toEqual({ state: "stopped", message: "办公引擎已停止" });
  }, 20_000);

  it("远程连接器配置只写入凭证占位符并限制为只读工具", async () => {
    const supervisor = await createSupervisor();
    await supervisor.configure({
      apiKey: "test-only-key",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      modelId: "test-endpoint",
      workspacePath: join(roots[0]!, "workspace"),
      permissionMode: "default",
      remoteConnectors: [{ id: "remote-mcp", endpoint: "https://mcp.example.com/api", transport: "streamable-http", credential: "runtime-only-secret" }],
    });
    const serialized = await readFile(join(roots[0]!, "runtime", "openclaw.json"), "utf8");
    expect(serialized).toContain("${NIUMA_MODEL_ACCESS_TOKEN}");
    expect(serialized).not.toContain("NIUMA_ARK_API_KEY");
    expect(serialized).toContain("${NIUMA_REMOTE_MCP_TOKEN}");
    expect(serialized).not.toContain("runtime-only-secret");
    expect(serialized).toContain("*delete*");
    expect(serialized).toContain("read_*");
  });

  it("更新运行时配置前保留上一份可回滚配置", async () => {
    const supervisor = await createSupervisor();
    const base = { apiKey: "test-only-key", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", modelId: "first-endpoint", workspacePath: join(roots[0]!, "workspace"), permissionMode: "default" as const };
    await supervisor.configure(base);
    const first = await readFile(join(roots[0]!, "runtime", "openclaw.json"), "utf8");
    await supervisor.configure({ ...base, modelId: "second-endpoint" });
    expect(await readFile(join(roots[0]!, "runtime", "openclaw.previous.json"), "utf8")).toBe(first);
    expect(await readFile(join(roots[0]!, "runtime", "openclaw.json"), "utf8")).toContain("second-endpoint");
  });
});
