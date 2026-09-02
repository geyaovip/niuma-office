import { randomUUID } from "node:crypto";
import * as gatewayRuntime from "@openclaw/gateway-client";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";

export interface GatewayConnection {
  url: string;
  token: string;
}

export interface GatewayToolEvent {
  runId: string;
  phase: "start" | "result";
  toolCallId: string;
  name: string;
  isError: boolean;
}
export interface GatewayApprovalEvent { id: string; kind: "exec" | "plugin"; command: string; cwd?: string; description?: string; severity?: "info" | "warning" | "critical"; expiresAt?: number }
export type GatewayApprovalDecision = "allow_once" | "allow_task" | "deny";
export interface GatewayProgressCard { revision: number; markdown?: string; steps: Array<{ step: string; status: "pending" | "in_progress" | "completed" }> }
export interface GatewayQuestionEvent {
  id: string;
  expiresAt: number;
  questions: Array<{ questionId: string; header: string; question: string; options: Array<{ label: string; description?: string }>; multiSelect?: boolean; isOther?: boolean; isSecret?: boolean; secretStore?: { name: string; kind: "secret" | "env"; allowedHosts?: string[]; reason?: string } }>;
}

export interface GatewayRunOptions {
  taskId: string;
  sessionKey: string;
  message: string;
  workspacePath: string;
  signal: AbortSignal;
  onText?: (text: string) => void;
  onTool?: (event: GatewayToolEvent) => void | Promise<void>;
  onApproval?: (event: GatewayApprovalEvent) => void | Promise<void>;
  onApprovalExpired?: (event: GatewayApprovalEvent) => void | Promise<void>;
  onProgress?: (event: GatewayProgressCard) => void | Promise<void>;
  onQuestion?: (event: GatewayQuestionEvent) => void | Promise<void>;
  onQuestionExpired?: (event: GatewayQuestionEvent) => void | Promise<void>;
}

interface GatewayEvent { event?: string; payload?: unknown }
interface GatewayClientLike {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  stop(): void;
}
interface GatewayModule {
  GatewayClient: new (options: Record<string, unknown>) => GatewayClientLike;
  startGatewayClientWhenEventLoopReady(client: GatewayClientLike, options?: Record<string, unknown>): Promise<{ ready?: boolean; aborted?: boolean }>;
}

export class OpenClawGatewayRunner {
  private active = new Map<string, { client: GatewayClientLike; sessionKey: string; runId: string }>();
  private pendingApprovals = new Map<string, Set<string>>();
  private approvalKinds = new Map<string, Map<string, "exec" | "plugin">>();
  private pendingQuestions = new Map<string, Map<string, GatewayQuestionEvent>>();
  private taskWideGrants = new Set<string>();
  private approvalTimers = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();

  constructor(private readonly connection: () => GatewayConnection, private readonly loadModule: () => Promise<GatewayModule> = importGatewayModule) {}

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const connection = this.connection();
    const gateway = await this.loadModule();
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const client = new gateway.GatewayClient({
      url: connection.url,
      token: connection.token,
      clientName: "gateway-client",
      clientDisplayName: "niuma-desktop",
      clientVersion: "0.1.0",
      platform: process.platform,
      mode: "backend",
      deviceIdentity: null,
      caps: ["tool-events"],
      instanceId: randomUUID(),
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      onHelloOk: resolveReady,
      onEvent: () => undefined,
      onClose: (_code: number, reason: string) => rejectReady(new Error(reason || "Gateway connection closed")),
      onGap: () => undefined,
    });
    try {
      const readiness = await gateway.startGatewayClientWhenEventLoopReady(client, { clientOptions: { preauthHandshakeTimeoutMs: 10_000 } });
      if (!readiness.ready) throw new Error("Gateway connection timeout");
      await Promise.race([ready, timeout(12_000).then(() => { throw new Error("Gateway authentication timeout"); })]);
      return await client.request(method, params);
    } finally {
      client.stop();
    }
  }

  async run(options: GatewayRunOptions): Promise<string> {
    const connection = this.connection();
    const gateway = await this.loadModule();
    const proposedRunId = randomUUID();
    let acceptedRunId: string = proposedRunId;
    let output = "";
    let terminal = false;
    let eventWork = Promise.resolve();
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    let resolveRun!: (value: string) => void;
    let rejectRun!: (error: Error) => void;
    const result = new Promise<string>((resolve, reject) => { resolveRun = resolve; rejectRun = reject; });

    const finish = (value: string) => {
      if (terminal) return;
      terminal = true;
      void eventWork.finally(() => resolveRun(value.trim()));
    };
    const fail = (error: Error) => {
      if (terminal) return;
      terminal = true;
      void eventWork.finally(() => rejectRun(error));
    };

    const client = new gateway.GatewayClient({
      url: connection.url,
      token: connection.token,
      clientName: "gateway-client",
      clientDisplayName: "niuma-desktop",
      clientVersion: "0.1.0",
      platform: process.platform,
      mode: "backend",
      deviceIdentity: null,
      caps: ["tool-events"],
      instanceId: randomUUID(),
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      onHelloOk: () => resolveReady(),
      onEvent: (event: GatewayEvent) => {
        if (event.event === "progressCard.changed") {
          const payload = asRecord(event.payload);
          if (asString(payload?.sessionKey) !== options.sessionKey) return;
          eventWork = eventWork.then(async () => {
            const result = asRecord(await client.request("progressCard.get", { sessionKey: options.sessionKey }));
            const card = asRecord(result?.card);
            const progress = parseProgressCard(card);
            if (progress) await options.onProgress?.(progress);
          });
          return;
        }
        if (event.event === "question.requested") {
          const question = parseQuestionEvent(event.payload);
          if (!question || (asString(asRecord(event.payload)?.sessionKey) && asString(asRecord(event.payload)?.sessionKey) !== options.sessionKey)) return;
          const pending = this.pendingQuestions.get(options.taskId) ?? new Map<string, GatewayQuestionEvent>();
          pending.set(question.id, question);
          this.pendingQuestions.set(options.taskId, pending);
          eventWork = eventWork.then(() => options.onQuestion?.(question)).then(() => undefined);
          return;
        }
        if (event.event === "question.resolved") {
          const payload = asRecord(event.payload);
          const id = asString(payload?.id);
          const pending = this.pendingQuestions.get(options.taskId);
          const question = id ? pending?.get(id) : undefined;
          if (!question) return;
          pending?.delete(id);
          if (pending?.size === 0) this.pendingQuestions.delete(options.taskId);
          if (payload?.status === "expired" || payload?.status === "cancelled") eventWork = eventWork.then(() => options.onQuestionExpired?.(question)).then(() => undefined);
          return;
        }
        if (event.event === "exec.approval.requested") {
          const envelope = asRecord(event.payload);
          const request = asRecord(envelope?.request) ?? envelope;
          const id = asString(envelope?.id) || asString(request?.id);
          const requestSessionKey = asString(request?.sessionKey) || asString(asRecord(request?.systemRunPlan)?.sessionKey);
          if (!id || (requestSessionKey && requestSessionKey !== options.sessionKey)) return;
          const pending = this.pendingApprovals.get(options.taskId) ?? new Set<string>();
          pending.add(id);
          this.pendingApprovals.set(options.taskId, pending);
          const kinds = this.approvalKinds.get(options.taskId) ?? new Map<string, "exec" | "plugin">();
          kinds.set(id, "exec");
          this.approvalKinds.set(options.taskId, kinds);
          const command = asString(request?.command) || asString(asRecord(request?.systemRunPlan)?.commandText) || "运行本机操作";
          const cwd = asString(request?.cwd) || asString(asRecord(request?.systemRunPlan)?.cwd) || undefined;
          if (this.taskWideGrants.has(options.taskId) && isTaskGrantSafe(command, cwd, options.workspacePath)) {
            eventWork = eventWork.then(() => client.request("exec.approval.resolve", { id, decision: "allow-once" })).then(() => { pending.delete(id); });
          } else {
            const systemRunPlan = asRecord(request?.systemRunPlan);
            const approval = {
              id,
              kind: "exec" as const,
              command,
              cwd,
              expiresAt: typeof envelope?.expiresAtMs === "number" ? envelope.expiresAtMs : undefined,
            };
            eventWork = eventWork.then(() => options.onApproval?.(approval)).then(() => undefined);
            this.scheduleApprovalExpiry(options, client, approval);
          }
          return;
        }
        if (event.event === "plugin.approval.requested") {
          const envelope = asRecord(event.payload);
          const request = asRecord(envelope?.request) ?? envelope;
          const id = asString(envelope?.id) || asString(request?.id);
          const requestSessionKey = asString(request?.sessionKey);
          if (!id || (requestSessionKey && requestSessionKey !== options.sessionKey)) return;
          const pending = this.pendingApprovals.get(options.taskId) ?? new Set<string>();
          pending.add(id);
          this.pendingApprovals.set(options.taskId, pending);
          const kinds = this.approvalKinds.get(options.taskId) ?? new Map<string, "exec" | "plugin">();
          kinds.set(id, "plugin");
          this.approvalKinds.set(options.taskId, kinds);
          const approval: GatewayApprovalEvent = {
            id,
            kind: "plugin",
            command: asString(request?.title) || "使用扩展能力",
            description: asString(request?.description) || undefined,
            severity: parseSeverity(request?.severity),
            expiresAt: typeof envelope?.expiresAtMs === "number" ? envelope.expiresAtMs : undefined,
          };
          eventWork = eventWork.then(() => options.onApproval?.(approval)).then(() => undefined);
          this.scheduleApprovalExpiry(options, client, approval);
          return;
        }
        if (event.event === "chat") {
          const payload = asRecord(event.payload);
          if (!payload || payload.runId !== acceptedRunId || payload.sessionKey !== options.sessionKey) return;
          const state = asString(payload.state);
          if (state === "delta") {
            const delta = asString(payload.deltaText);
            output = payload.replace === true ? delta : `${output}${delta}`;
            options.onText?.(output);
          } else if (state === "final") {
            const finalText = extractMessageText(payload.message) || output;
            options.onText?.(finalText);
            finish(finalText);
          } else if (state === "aborted") fail(new Error("TASK_CANCELLED"));
          else if (state === "error") fail(new Error(asString(payload.errorMessage) || "Gateway task failed"));
          return;
        }
        if (event.event !== "agent") return;
        const payload = asRecord(event.payload);
        if (!payload || payload.runId !== acceptedRunId || payload.stream !== "tool") return;
        const data = asRecord(payload.data);
        const phase = asString(data?.phase);
        const toolCallId = asString(data?.toolCallId);
        if (!toolCallId || (phase !== "start" && phase !== "result")) return;
        eventWork = eventWork.then(() => options.onTool?.({
          runId: acceptedRunId,
          phase,
          toolCallId,
          name: asString(data?.name) || "办公工具",
          isError: Boolean(data?.isError),
        })).then(() => undefined);
      },
      onClose: (_code: number, reason: string) => {
        const error = new Error(reason || "Gateway connection closed");
        rejectReady(error);
        fail(error);
      },
      onGap: () => undefined,
    });

    this.active.set(options.taskId, { client, sessionKey: options.sessionKey, runId: proposedRunId });
    let abortWork: Promise<void> | undefined;
    const abort = () => { fail(new Error("TASK_CANCELLED")); abortWork = this.abort(options.taskId); };
    options.signal.addEventListener("abort", abort, { once: true });
    try {
      const readiness = await gateway.startGatewayClientWhenEventLoopReady(client, { clientOptions: { preauthHandshakeTimeoutMs: 10_000 } });
      if (!readiness.ready) throw new Error("Gateway connection timeout");
      await Promise.race([ready, timeout(12_000).then(() => { throw new Error("Gateway authentication timeout"); })]);
      if (options.signal.aborted) throw new Error("TASK_CANCELLED");
      const response = asRecord(await client.request("chat.send", {
        sessionKey: options.sessionKey,
        agentId: "main",
        message: options.message,
        deliver: false,
        timeoutMs: 900_000,
        idempotencyKey: proposedRunId,
      }));
      acceptedRunId = asString(response?.runId) || proposedRunId;
      this.active.set(options.taskId, { client, sessionKey: options.sessionKey, runId: acceptedRunId });
      if (response?.status === "ok" && output) finish(output);
      return await Promise.race([result, timeout(910_000).then(() => { throw new Error("Gateway task timeout"); })]);
    } finally {
      options.signal.removeEventListener("abort", abort);
      if (abortWork) await abortWork;
      this.active.delete(options.taskId);
      this.clearTaskPermissions(options.taskId);
      client.stop();
    }
  }

  async abort(taskId: string) {
    const active = this.active.get(taskId);
    if (!active) return;
    this.active.delete(taskId);
    this.clearTaskPermissions(taskId);
    try {
      await active.client.request("chat.abort", { sessionKey: active.sessionKey, agentId: "main", runId: active.runId });
      // A parent chat abort does not guarantee that detached native subagents
      // have stopped. Cancel the background-task ledger entries owned by this
      // session before releasing the Gateway connection.
      try {
        const response = asRecord(await active.client.request("tasks.list", { sessionKey: active.sessionKey, status: ["queued", "running"], limit: 100 }));
        const tasks = Array.isArray(response?.tasks) ? response.tasks : [];
        await Promise.allSettled(tasks.flatMap(task => {
          const id = asString(asRecord(task)?.id);
          return id ? [active.client.request("tasks.cancel", { taskId: id, reason: "用户已停止任务" })] : [];
        }));
      } catch {
        // The parent abort is still valid when the runtime does not advertise
        // the 2.0 task ledger or it has already drained all descendants.
      }
    } finally {
      active.client.stop();
    }
  }

  async resolveApproval(taskId: string, approvalId: string, decision: GatewayApprovalDecision) {
    const active = this.active.get(taskId);
    const pending = this.pendingApprovals.get(taskId);
    if (!active || !pending?.has(approvalId)) throw new Error("权限请求已失效，请重新运行任务");
    const kind = this.approvalKinds.get(taskId)?.get(approvalId) ?? "exec";
    if (decision === "allow_task" && kind === "exec") this.taskWideGrants.add(taskId);
    // Never turn a task-scoped Niuma decision into OpenClaw's persistent
    // allow-always grant. Plugin grants remain one-shot until a versioned
    // product-level plugin permission screen exists.
    const gatewayDecision = decision === "deny" ? "deny" : "allow-once";
    await active.client.request(kind === "plugin" ? "plugin.approval.resolve" : "exec.approval.resolve", { id: approvalId, decision: gatewayDecision });
    pending.delete(approvalId);
    this.approvalKinds.get(taskId)?.delete(approvalId);
    this.clearApprovalTimer(taskId, approvalId);
  }

  async resolveQuestion(taskId: string, questionId: string, answers: Record<string, string[]>) {
    const active = this.active.get(taskId);
    const pending = this.pendingQuestions.get(taskId);
    if (!active || !pending?.has(questionId)) throw new Error("问题已失效，请重新运行任务");
    // Do not delegate persistence to the runtime secret store. Answers are
    // supplied once; durable credentials belong to the Niuma local vault.
    await active.client.request("question.resolve", { id: questionId, answers: { answers }, resolvedBy: "niuma-desktop" });
    pending.delete(questionId);
    if (pending.size === 0) this.pendingQuestions.delete(taskId);
  }

  private scheduleApprovalExpiry(options: GatewayRunOptions, client: GatewayClientLike, approval: GatewayApprovalEvent) {
    if (!approval.expiresAt) return;
    const delay = Math.max(0, approval.expiresAt - Date.now());
    const timers = this.approvalTimers.get(options.taskId) ?? new Map<string, ReturnType<typeof setTimeout>>();
    this.clearApprovalTimer(options.taskId, approval.id);
    timers.set(approval.id, setTimeout(() => {
      const pending = this.pendingApprovals.get(options.taskId);
      if (!pending?.has(approval.id)) return;
      pending.delete(approval.id);
      const taskTimers = this.approvalTimers.get(options.taskId);
      taskTimers?.delete(approval.id);
      if (taskTimers?.size === 0) this.approvalTimers.delete(options.taskId);
      const kind = this.approvalKinds.get(options.taskId)?.get(approval.id) ?? approval.kind;
      void client.request(kind === "plugin" ? "plugin.approval.resolve" : "exec.approval.resolve", { id: approval.id, decision: "deny" })
        .then(() => options.onApprovalExpired?.(approval))
        .catch(() => options.onApprovalExpired?.(approval));
    }, delay));
    this.approvalTimers.set(options.taskId, timers);
  }

  private clearApprovalTimer(taskId: string, approvalId: string) {
    const timers = this.approvalTimers.get(taskId);
    const timer = timers?.get(approvalId);
    if (timer) clearTimeout(timer);
    timers?.delete(approvalId);
    if (timers?.size === 0) this.approvalTimers.delete(taskId);
  }

  private clearTaskPermissions(taskId: string) {
    const timers = this.approvalTimers.get(taskId);
    timers?.forEach(timer => clearTimeout(timer));
    this.approvalTimers.delete(taskId);
    this.pendingApprovals.delete(taskId);
    this.approvalKinds.delete(taskId);
    this.pendingQuestions.delete(taskId);
    this.taskWideGrants.delete(taskId);
  }
}

async function importGatewayModule() {
  return gatewayRuntime as unknown as GatewayModule;
}

function timeout(milliseconds: number) { return new Promise<void>(resolve => setTimeout(resolve, milliseconds)); }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" ? value as Record<string, unknown> : undefined; }
function asString(value: unknown) { return typeof value === "string" ? value : ""; }
function extractMessageText(value: unknown) {
  const message = asRecord(value);
  if (!message) return "";
  if (typeof message.content === "string") return message.content.trim();
  if (!Array.isArray(message.content)) return "";
  return message.content.flatMap(block => {
    const record = asRecord(block);
    return record?.type === "text" && typeof record.text === "string" ? [record.text] : [];
  }).join("\n").trim();
}

function parseProgressCard(value: Record<string, unknown> | undefined): GatewayProgressCard | undefined {
  if (!value || typeof value.revision !== "number") return;
  const steps: GatewayProgressCard["steps"] = Array.isArray(value.steps) ? value.steps.flatMap(item => {
    const step = asRecord(item);
    const name = asString(step?.step);
    const status = step?.status;
    return name && (status === "pending" || status === "in_progress" || status === "completed") ? [{ step: name, status } as GatewayProgressCard["steps"][number]] : [];
  }) : [];
  return { revision: value.revision, markdown: asString(value.markdown) || undefined, steps };
}

function parseQuestionEvent(value: unknown): GatewayQuestionEvent | undefined {
  const record = asRecord(value);
  const id = asString(record?.id);
  if (!record || !id || !Array.isArray(record.questions) || typeof record.expiresAtMs !== "number") return;
  const questions: GatewayQuestionEvent["questions"] = record.questions.flatMap(item => {
    const question = asRecord(item);
    const questionId = asString(question?.questionId);
    const text = asString(question?.question);
    if (!questionId || !text || !Array.isArray(question?.options)) return [];
    const options = question.options.flatMap(option => { const entry = asRecord(option); const label = asString(entry?.label); return label ? [{ label, description: asString(entry?.description) || undefined }] : []; });
    const secretStore = asRecord(question.secretStore);
    const secretKind = secretStore?.kind === "secret" || secretStore?.kind === "env" ? secretStore.kind : undefined;
    const parsed: GatewayQuestionEvent["questions"][number] = { questionId, header: asString(question.header), question: text, options, multiSelect: question.multiSelect === true || undefined, isOther: question.isOther === true || undefined, isSecret: question.isSecret === true || undefined, secretStore: secretStore && asString(secretStore.name) && secretKind ? { name: asString(secretStore.name), kind: secretKind, allowedHosts: Array.isArray(secretStore.allowedHosts) ? secretStore.allowedHosts.filter((host): host is string => typeof host === "string") : undefined, reason: asString(secretStore.reason) || undefined } : undefined };
    return [parsed];
  });
  return questions.length ? { id, expiresAt: record.expiresAtMs, questions } : undefined;
}

function parseSeverity(value: unknown): "info" | "warning" | "critical" | undefined { return value === "info" || value === "warning" || value === "critical" ? value : undefined; }

export function isTaskGrantSafe(command: string, cwd: string | undefined, workspacePath: string) {
  const normalizedRoot = workspacePath.replace(/\/+$/, "");
  if (!cwd || !(cwd === normalizedRoot || cwd.startsWith(`${normalizedRoot}/`))) return false;
  if (/(^|\s)(?:rm|rmdir|sudo|su|dd|kill|pkill|chmod|chown|mv|osascript)\b|\bgit\s+push\b|\bnpm\s+publish\b|\b(?:curl|wget)\b[^\n]*(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--data)|\b(?:mail|sendmail)\b/i.test(command)) return false;
  if (/(?:^|[\s'"=])(?:~\/|\/(?:Applications|Library|System|Users|Volumes|bin|etc|opt|private|sbin|tmp|usr|var)(?:\/|\b))/i.test(command)) return false;
  return true;
}
