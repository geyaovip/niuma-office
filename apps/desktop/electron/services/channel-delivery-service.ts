import type { ChannelEnvelope } from "@niuma/contracts";
import type { StoredExecutionEvent, StoredTask, WorkspaceRepository } from "./workspace-repository.js";
import type { TaskExecutor } from "./task-executor.js";
import type { ChannelClient } from "./channel-client.js";

type TaskHandler = (task: StoredTask) => void; type EventHandler = (event: StoredExecutionEvent) => void;
export class ChannelDeliveryService {
  private timer?: NodeJS.Timeout; private pulling = false;
  constructor(private readonly client: ChannelClient, private readonly workspace: Pick<WorkspaceRepository, "saveTaskWithEvent" | "getTask">, private readonly executor: TaskExecutor, private readonly onTask?: TaskHandler, private readonly onEvent?: EventHandler) {}
  start() { if (!this.client.configured || this.timer) return; void this.tick(); this.timer = setInterval(() => void this.tick(), 10_000); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  async tick() { if (this.pulling || !this.client.configured) return; this.pulling = true; try { for (const envelope of await this.client.pull()) await this.process(envelope); } catch { /* status is surfaced through channel settings */ } finally { this.pulling = false; } }
  async notifyTask(task: StoredTask) { if (!task.channelOrigin || !this.client.configured) return; await this.client.acknowledge(task.channelOrigin.envelopeId, { taskId: task.id, state: mapTaskState(task.status), summary: task.status === "completed" ? summarize(task.output) : task.status === "failed" ? summarize(task.error) : undefined }).catch(() => undefined); }
  private async process(envelope: ChannelEnvelope) {
    const taskId = `channel-${envelope.id}`; const existing = await this.workspace.getTask(taskId); if (existing) { await this.notifyTask(existing); return; }
    const createdAt = new Date().toISOString(); const task: StoredTask = { id: taskId, title: envelope.text.length > 28 ? `${envelope.text.slice(0, 28)}…` : envelope.text, prompt: envelope.text, status: "queued", createdAt, projectId: "default", modelMode: "auto", permissionMode: "default", channelOrigin: { channel: envelope.channel, envelopeId: envelope.id, bindingId: envelope.bindingId, conversationKey: envelope.conversationKey }, turns: [{ id: `${taskId}-turn`, prompt: envelope.text, status: "queued", createdAt, projectId: "default", modelMode: "auto", permissionMode: "default" }] };
    const saved = await this.workspace.saveTaskWithEvent(task, "task.queued", { channel: envelope.channel, envelopeId: envelope.id }, envelope.id); const event = saved.executionEvents.filter(item => item.taskId === task.id).at(-1); if (event) this.onEvent?.(event); this.onTask?.(task);
    await this.client.acknowledge(envelope.id, { taskId, state: "accepted" }).catch(() => undefined);
    const completed = await this.executor.run(task, updated => { this.onTask?.(updated); void this.notifyTask(updated); }, this.onEvent);
    await this.notifyTask(completed);
  }
}
function mapTaskState(status: StoredTask["status"]): "accepted" | "running" | "waiting_user" | "completed" | "failed" { if (status === "running" || status === "waiting") return "running"; if (status === "waiting_user") return "waiting_user"; if (status === "completed") return "completed"; if (["failed", "cancelled"].includes(status)) return "failed"; return "accepted"; }
function summarize(value?: string) { const text = value?.trim(); return text ? text.slice(0, 3000) : undefined; }
