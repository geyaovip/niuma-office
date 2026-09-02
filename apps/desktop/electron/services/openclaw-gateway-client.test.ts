import { describe, expect, it } from "vitest";
import { OpenClawGatewayRunner, isTaskGrantSafe } from "./openclaw-gateway-client";

type ClientOptions = Record<string, unknown> & { onHelloOk: () => void; onEvent: (event: unknown) => void; onClose: (code: number, reason: string) => void };

function fakeGateway(mode: "complete" | "pending" | "approval" | "approval-timeout" | "plugin" | "question" = "complete") {
  const requests: Array<{ method: string; params?: Record<string, unknown> }> = [];
  let options!: ClientOptions;
  class GatewayClient {
    constructor(value: Record<string, unknown>) { options = value as ClientOptions; }
    async request(method: string, params?: Record<string, unknown>) {
      requests.push({ method, params });
      if (method === "sessions.search") return { results: [{ sessionKey: "task-1", snippet: "季度复盘" }] };
      if (method === "tasks.list") return { tasks: [{ id: "child-1", status: "running", sessionKey: params?.sessionKey }] };
      if (method === "progressCard.get") return { card: { sessionKey: params?.sessionKey, revision: 2, updatedAt: Date.now(), steps: [{ step: "整理资料", status: "completed" }, { step: "生成交付", status: "in_progress" }] } };
      if (method === "chat.send") {
        if (mode === "approval" || mode === "approval-timeout") queueMicrotask(() => options.onEvent({ event: "exec.approval.requested", payload: { id: "approval-1", request: { command: "mkdir 报告", cwd: "/workspace", sessionKey: params?.sessionKey }, expiresAtMs: Date.now() + (mode === "approval-timeout" ? 10 : 60_000) } }));
        if (mode === "plugin") queueMicrotask(() => options.onEvent({ event: "plugin.approval.requested", payload: { id: "plugin-1", request: { title: "读取日历", description: "读取已授权的日程", sessionKey: params?.sessionKey }, expiresAtMs: Date.now() + 60_000 } }));
        if (mode === "complete") queueMicrotask(() => {
          const runId = params?.idempotencyKey;
          const sessionKey = params?.sessionKey;
          options.onEvent({ event: "agent", payload: { runId, stream: "tool", data: { phase: "start", toolCallId: "tool-1", name: "文件读取" } } });
          options.onEvent({ event: "progressCard.changed", payload: { sessionKey, revision: 2 } });
          options.onEvent({ event: "chat", payload: { runId, sessionKey, state: "delta", deltaText: "正式" } });
          options.onEvent({ event: "chat", payload: { runId, sessionKey, state: "delta", deltaText: "结果" } });
          options.onEvent({ event: "agent", payload: { runId, stream: "tool", data: { phase: "result", toolCallId: "tool-1", name: "文件读取", isError: false } } });
          options.onEvent({ event: "chat", payload: { runId, sessionKey, state: "final", message: { role: "assistant", content: [{ type: "text", text: "正式结果" }] } } });
        });
        if (mode === "question") queueMicrotask(() => options.onEvent({ event: "question.requested", payload: { id: "question-1", sessionKey: params?.sessionKey, expiresAtMs: Date.now() + 60_000, questions: [{ questionId: "format", header: "交付格式", question: "请选择交付格式", options: [{ label: "Markdown" }, { label: "Word" }] }] } }));
        return { runId: params?.idempotencyKey, status: "started" };
      }
      if (method === "exec.approval.resolve" && (mode === "approval" || mode === "approval-timeout")) queueMicrotask(() => {
        const send = requests.find(item => item.method === "chat.send");
        options.onEvent({ event: "chat", payload: { runId: send?.params?.idempotencyKey, sessionKey: send?.params?.sessionKey, state: "final", message: { role: "assistant", content: [{ type: "text", text: "已创建报告" }] } } });
      });
      if (method === "question.resolve" && mode === "question") queueMicrotask(() => {
        const send = requests.find(item => item.method === "chat.send");
        options.onEvent({ event: "question.resolved", payload: { id: "question-1", status: "answered", answers: params?.answers } });
        options.onEvent({ event: "chat", payload: { runId: send?.params?.idempotencyKey, sessionKey: send?.params?.sessionKey, state: "final", message: { role: "assistant", content: [{ type: "text", text: "已按 Markdown 交付" }] } } });
      });
      if (method === "plugin.approval.resolve" && mode === "plugin") queueMicrotask(() => {
        const send = requests.find(item => item.method === "chat.send");
        options.onEvent({ event: "chat", payload: { runId: send?.params?.idempotencyKey, sessionKey: send?.params?.sessionKey, state: "final", message: { role: "assistant", content: [{ type: "text", text: "已读取日历" }] } } });
      });
      return {};
    }
    stop() { /* expected cleanup */ }
  }
  return {
    requests,
    module: {
      GatewayClient,
      startGatewayClientWhenEventLoopReady: async () => { options.onHelloOk(); return { ready: true }; },
    },
  };
}

describe("OpenClawGatewayRunner", () => {
  it("通过独立 SDK 连接调用原生会话搜索并及时关闭连接", async () => {
    const gateway = fakeGateway();
    const runner = new OpenClawGatewayRunner(() => ({ url: "ws://127.0.0.1:1234", token: "secret" }), async () => gateway.module);
    await expect(runner.request("sessions.search", { query: "复盘", sessionKeys: ["task-1"] })).resolves.toEqual({ results: [{ sessionKey: "task-1", snippet: "季度复盘" }] });
    expect(gateway.requests[0]).toEqual({ method: "sessions.search", params: { query: "复盘", sessionKeys: ["task-1"] } });
  });

  it("通过幂等 chat.send 接收正文增量和工具事件", async () => {
    const gateway = fakeGateway();
    const text: string[] = [];
    const tools: string[] = [];
    const progress: number[] = [];
    const runner = new OpenClawGatewayRunner(() => ({ url: "ws://127.0.0.1:1234", token: "secret" }), async () => gateway.module);
    const result = await runner.run({ taskId: "task-1", sessionKey: "task-1", message: "整理材料", workspacePath: "/workspace", signal: new AbortController().signal, onText: value => text.push(value), onTool: event => { tools.push(`${event.phase}:${event.name}`); }, onProgress: event => { progress.push(event.revision); } });
    expect(result).toBe("正式结果");
    expect(text).toEqual(["正式", "正式结果", "正式结果"]);
    expect(tools).toEqual(["start:文件读取", "result:文件读取"]);
    expect(progress).toEqual([2]);
    const send = gateway.requests.find(item => item.method === "chat.send");
    expect(send?.params?.idempotencyKey).toBeTruthy();
    expect(send?.params).not.toHaveProperty("token");
  });

  it("接收结构化问题并将答案返回当前任务", async () => {
    const gateway = fakeGateway("question");
    let runner!: OpenClawGatewayRunner;
    runner = new OpenClawGatewayRunner(() => ({ url: "ws://127.0.0.1:1234", token: "secret" }), async () => gateway.module);
    const result = await runner.run({ taskId: "task-question", sessionKey: "task-question", message: "生成报告", workspacePath: "/workspace", signal: new AbortController().signal, onQuestion: async question => { expect(question.questions[0]?.header).toBe("交付格式"); await runner.resolveQuestion("task-question", question.id, { format: ["Markdown"] }); } });
    expect(result).toBe("已按 Markdown 交付");
    expect(gateway.requests.find(item => item.method === "question.resolve")?.params).toMatchObject({ id: "question-1", answers: { answers: { format: ["Markdown"] } } });
  });

  it("取消时调用 chat.abort 并结束本地等待", async () => {
    const gateway = fakeGateway("pending");
    const controller = new AbortController();
    const runner = new OpenClawGatewayRunner(() => ({ url: "ws://127.0.0.1:1234", token: "secret" }), async () => gateway.module);
    const running = runner.run({ taskId: "task-2", sessionKey: "task-2", message: "长任务", workspacePath: "/workspace", signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    await expect(running).rejects.toThrow("TASK_CANCELLED");
    expect(gateway.requests.some(item => item.method === "chat.abort")).toBe(true);
    expect(gateway.requests.find(item => item.method === "tasks.cancel")?.params).toEqual({ taskId: "child-1", reason: "用户已停止任务" });
  });

  it("只接受当前任务的主进程权限决议", async () => {
    const gateway = fakeGateway("approval");
    let runner!: OpenClawGatewayRunner;
    const approvals: string[] = [];
    runner = new OpenClawGatewayRunner(() => ({ url: "ws://127.0.0.1:1234", token: "secret" }), async () => gateway.module);
    const result = await runner.run({ taskId: "task-3", sessionKey: "task-3", message: "创建报告目录", workspacePath: "/workspace", signal: new AbortController().signal, onApproval: async approval => { approvals.push(approval.command); await runner.resolveApproval("task-3", approval.id, "allow_once"); } });
    expect(result).toBe("已创建报告");
    expect(approvals).toEqual(["mkdir 报告"]);
    expect(gateway.requests.find(item => item.method === "exec.approval.resolve")?.params).toEqual({ id: "approval-1", decision: "allow-once" });
    await expect(runner.resolveApproval("task-other", "approval-1", "allow_once")).rejects.toThrow("权限请求已失效");
  });

  it("任务级授权不自动放行越界或高风险命令", () => {
    expect(isTaskGrantSafe("mkdir 报告", "/workspace/任务", "/workspace")).toBe(true);
    expect(isTaskGrantSafe("rm -rf 报告", "/workspace/任务", "/workspace")).toBe(false);
    expect(isTaskGrantSafe("cat /etc/passwd", "/workspace/任务", "/workspace")).toBe(false);
    expect(isTaskGrantSafe("pwd", "/Users/demo", "/workspace")).toBe(false);
  });

  it("不会把牛马的任务级决定升级为插件永久授权", async () => {
    const gateway = fakeGateway("plugin");
    let runner!: OpenClawGatewayRunner;
    runner = new OpenClawGatewayRunner(() => ({ url: "ws://127.0.0.1:1234", token: "secret" }), async () => gateway.module);
    const result = await runner.run({ taskId: "task-plugin", sessionKey: "task-plugin", message: "读取日历", workspacePath: "/workspace", signal: new AbortController().signal, onApproval: approval => runner.resolveApproval("task-plugin", approval.id, "allow_task") });
    expect(result).toBe("已读取日历");
    expect(gateway.requests.find(item => item.method === "plugin.approval.resolve")?.params).toEqual({ id: "plugin-1", decision: "allow-once" });
  });

  it("权限确认超时后自动拒绝并通知任务恢复", async () => {
    const gateway = fakeGateway("approval-timeout");
    const expired: string[] = [];
    const runner = new OpenClawGatewayRunner(() => ({ url: "ws://127.0.0.1:1234", token: "secret" }), async () => gateway.module);
    const result = await runner.run({ taskId: "task-4", sessionKey: "task-4", message: "创建报告目录", workspacePath: "/workspace", signal: new AbortController().signal, onApprovalExpired: approval => { expired.push(approval.id); } });
    expect(result).toBe("已创建报告");
    expect(expired).toEqual(["approval-1"]);
    expect(gateway.requests.find(item => item.method === "exec.approval.resolve")?.params).toEqual({ id: "approval-1", decision: "deny" });
  });
});
