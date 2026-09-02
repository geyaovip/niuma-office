import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { access, copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { openClawToolPolicy } from "./openclaw-capability-policy.js";

export type RuntimeState = "stopped" | "starting" | "ready" | "unavailable" | "failed";
export interface RuntimeStatus { state: RuntimeState; message: string }
export interface RuntimeInstallation { nodeVersion: string; openClawVersion: string }

interface RuntimeConfiguration {
  baseUrl: string;
  modelId: string;
  apiKey: string;
  workspacePath: string;
  permissionMode: "restricted" | "default" | "full";
  remoteConnectors?: Array<{ id: string; endpoint: string; transport: "streamable-http" | "sse"; credential?: string }>;
}

export class OpenClawSupervisor {
  private child?: ChildProcess;
  private port?: number;
  private token = "";
  private status: RuntimeStatus = { state: "stopped", message: "办公引擎尚未启动" };
  private configuration?: RuntimeConfiguration;
  private startPromise?: Promise<RuntimeStatus>;
  private stopping = false;
  private readonly stateDir: string;
  private readonly configPath: string;
  private readonly previousConfigPath: string;

  constructor(private readonly appRoot: string, private readonly runtimeRoot: string) {
    this.stateDir = join(appRoot, "runtime", "state");
    this.configPath = join(appRoot, "runtime", "openclaw.json");
    this.previousConfigPath = join(appRoot, "runtime", "openclaw.previous.json");
  }

  getStatus() { return this.status; }

  async configure(configuration: RuntimeConfiguration) {
    const needsRestart = this.configuration && JSON.stringify(this.configuration) !== JSON.stringify(configuration) && this.status.state === "ready";
    if (needsRestart) await this.stop();
    this.configuration = configuration;
    if (!this.token) this.token = randomBytes(32).toString("hex");
    await mkdir(this.stateDir, { recursive: true });
    const toolPolicy = openClawToolPolicy(configuration.permissionMode);
    const config = {
      gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token: "${OPENCLAW_GATEWAY_TOKEN}" } },
      agents: { defaults: { workspace: configuration.workspacePath, model: { primary: `niuma-platform/${configuration.modelId}` } } },
      models: { mode: "merge", providers: { "niuma-platform": {
        baseUrl: configuration.baseUrl,
        apiKey: "${NIUMA_MODEL_ACCESS_TOKEN}",
        api: "openai-completions",
        models: [{ id: configuration.modelId, name: "火山方舟模型", reasoning: true, input: ["text", "image"], contextWindow: 128000, maxTokens: 16000 }],
      } } },
      ...(configuration.remoteConnectors?.length ? { mcp: { servers: Object.fromEntries(configuration.remoteConnectors.map(connector => [connector.id, { url: connector.endpoint, transport: connector.transport, connectionTimeoutMs: 8_000, requestTimeoutMs: 60_000, ...(connector.credential ? { headers: { Authorization: "Bearer ${NIUMA_REMOTE_MCP_TOKEN}" } } : {}), toolFilter: { include: ["list_*", "get_*", "read_*", "search_*", "fetch_*", "query_*", "lookup_*", "resources_*", "prompts_*"], exclude: ["*delete*", "*remove*", "*send*", "*create*", "*update*", "*write*", "*purchase*", "*pay*"] } }])) } } : {}),
      tools: {
        profile: "coding",
        allow: toolPolicy.allow,
        fs: { workspaceOnly: true },
        exec: {
          mode: configuration.permissionMode === "restricted" ? "deny" : "ask",
          host: "gateway",
          strictInlineEval: true,
          applyPatch: { workspaceOnly: true },
        },
        deny: toolPolicy.deny,
      },
    };
    const candidatePath = `${this.configPath}.${randomBytes(6).toString("hex")}.tmp`;
    let hadPrevious = false;
    try {
      await access(this.configPath);
      await copyFile(this.configPath, this.previousConfigPath);
      hadPrevious = true;
    } catch { /* first configuration */ }
    await writeFile(candidatePath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(candidatePath, this.configPath);
    try {
      await this.validateConfiguration();
    } catch (error) {
      if (hadPrevious) await copyFile(this.previousConfigPath, this.configPath);
      else await rm(this.configPath, { force: true });
      throw error;
    } finally {
      await rm(candidatePath, { force: true });
    }
  }

  private async validateConfiguration() {
    const executable = this.runtimePaths();
    try {
      const { stdout, stderr } = await runCaptured(executable.node, [executable.entry, "config", "validate", "--json"], this.runtimeEnvironment(), 15_000);
      const serialized = stdout.trim() || stderr.trim();
      const result = JSON.parse(serialized) as { valid?: boolean; warnings?: unknown[] };
      if (!result.valid || (result.warnings?.length ?? 0) > 0) throw new Error("invalid config");
    } catch (error) {
      const diagnostics = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout ?? (error as { stderr?: unknown }).stderr ?? error) : String(error);
      await writeFile(join(this.stateDir, "last-error.log"), diagnostics.slice(-4_000), { mode: 0o600 });
      throw new Error("办公引擎配置需要修复", { cause: error });
    }
  }

  async verifyInstallation(): Promise<RuntimeInstallation> {
    const executable = this.runtimePaths();
    await access(executable.node);
    await access(executable.entry);
    const runFile = promisify(execFile);
    const [{ stdout: nodeOutput }, { stdout: openClawOutput }] = await Promise.all([
      runFile(executable.node, ["--version"], { timeout: 5_000 }),
      runFile(executable.node, [executable.entry, "--version"], { timeout: 10_000 }),
    ]);
    const nodeVersion = nodeOutput.trim();
    const openClawVersion = openClawOutput.trim();
    if (nodeVersion !== "v24.15.0") throw new Error("内置执行环境版本不匹配");
    if (!openClawVersion.includes("2026.8.2")) throw new Error("内置办公引擎版本不匹配");
    return { nodeVersion, openClawVersion };
  }

  start(): Promise<RuntimeStatus> {
    if (this.status.state === "ready") return Promise.resolve(this.status);
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().finally(() => { this.startPromise = undefined; });
    return this.startPromise;
  }

  private async startInternal(): Promise<RuntimeStatus> {
    if (!this.configuration) return this.setStatus("unavailable", "请先完成模型设置");
    const executable = this.runtimePaths();
    try { await this.verifyInstallation(); }
    catch { return this.setStatus("unavailable", "办公引擎尚未完成安装"); }

    this.status = { state: "starting", message: "正在启动办公引擎" };
    this.stopping = false;
    if (!this.token) this.token = randomBytes(32).toString("hex");
    this.port = await findOpenPort();
    this.child = spawn(executable.node, [executable.entry, "gateway", "run", "--port", String(this.port)], {
      env: this.runtimeEnvironment(), stdio: ["ignore", "ignore", "pipe"],
    });
    let diagnostics = "";
    this.child.stderr?.on("data", chunk => { diagnostics = `${diagnostics}${String(chunk)}`.slice(-4000); });
    this.child.once("exit", code => {
      if (!this.stopping && this.status.state !== "stopped") this.setStatus("failed", code === 78 ? "办公引擎配置需要修复" : "办公引擎意外停止，可以重新运行任务");
      this.child = undefined;
      if (diagnostics) void writeFile(join(this.stateDir, "last-error.log"), diagnostics, { mode: 0o600 });
    });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (!this.child) break;
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/readyz`, { signal: AbortSignal.timeout(600) });
        if (response.ok) return this.setStatus("ready", "办公引擎已就绪");
      } catch { /* startup retry */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    await this.stop();
    return this.setStatus("failed", "办公引擎启动超时");
  }

  async stop() {
    this.stopping = true;
    this.status = { state: "stopped", message: "办公引擎已停止" };
    const child = this.child;
    this.child = undefined;
    this.port = undefined;
    if (!child || child.killed || child.exitCode !== null) return;
    child.kill("SIGTERM");
    const exited = await waitForExit(child, 3_000);
    if (!exited && child.exitCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, 1_000);
    }
  }

  getCommand() {
    if (!this.port || !this.configuration) throw new Error("办公引擎尚未就绪");
    return { ...this.runtimePaths(), env: this.runtimeEnvironment() };
  }

  getGatewayConnection() {
    if (!this.port || !this.configuration || this.status.state !== "ready") throw new Error("办公引擎尚未就绪");
    return {
      url: `ws://127.0.0.1:${this.port}`,
      token: this.token,
    };
  }

  private runtimePaths() {
    return { node: join(this.runtimeRoot, "node", "bin", "node"), entry: join(this.runtimeRoot, "openclaw", "node_modules", "openclaw", "openclaw.mjs") };
  }

  private runtimeEnvironment(): NodeJS.ProcessEnv {
    const inherited = pickEnvironment(process.env, ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "SHELL", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR"]);
    return {
      ...inherited,
      PATH: `${join(this.runtimePaths().node, "..")}:${process.env.PATH ?? ""}`,
      NODE_ENV: "production",
      OPENCLAW_STATE_DIR: this.stateDir,
      OPENCLAW_CONFIG_PATH: this.configPath,
      OPENCLAW_WORKSPACE_DIR: this.configuration?.workspacePath,
      OPENCLAW_GATEWAY_PORT: this.port ? String(this.port) : undefined,
      OPENCLAW_GATEWAY_TOKEN: this.token,
      NIUMA_MODEL_ACCESS_TOKEN: this.configuration?.apiKey,
      NIUMA_REMOTE_MCP_TOKEN: this.configuration?.remoteConnectors?.find(item => item.credential)?.credential,
      OPENCLAW_DISABLE_BONJOUR: "1",
      OPENCLAW_EXEC_SHELL_SNAPSHOT: "0",
      OPENCLAW_NO_RESPAWN: "1",
      OPENCLAW_SKIP_CHANNELS: "1",
      NO_COLOR: "1",
    };
  }

  private setStatus(state: RuntimeState, message: string) { this.status = { state, message }; return this.status; }
}

function pickEnvironment(source: NodeJS.ProcessEnv, keys: string[]): NodeJS.ProcessEnv {
  return Object.fromEntries(keys.flatMap(key => source[key] === undefined ? [] : [[key, source[key]]])) as NodeJS.ProcessEnv;
}

function runCaptured(executable: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("runtime command timeout")); }, timeoutMs);
    child.stdout?.on("data", chunk => { stdout += String(chunk); });
    child.stderr?.on("data", chunk => { stderr += String(chunk); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`runtime command failed (${code ?? "unknown"})`), { stdout, stderr }));
    });
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => { child.removeListener("exit", onExit); resolve(false); }, timeoutMs);
    const onExit = () => { clearTimeout(timer); resolve(true); };
    child.once("exit", onExit);
  });
}

function findOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
