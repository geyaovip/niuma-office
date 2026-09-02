import type { Automation, AutomationRun } from "@niuma/contracts";
import type { StoredExecutionEvent, StoredTask, WorkspaceRepository } from "./workspace-repository.js";
import type { TaskExecutor } from "./task-executor.js";
import { AutomationRepository, type AutomationSnapshot, type CreateAutomationInput } from "./automation-repository.js";

type SnapshotHandler = (snapshot: AutomationSnapshot) => void;
type TaskHandler = (task: StoredTask) => void;
type EventHandler = (event: StoredExecutionEvent) => void;

export class AutomationService {
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(private readonly repository: AutomationRepository, private readonly workspace: Pick<WorkspaceRepository, "saveTaskWithEvent">, private readonly executor: TaskExecutor, private readonly onSnapshot?: SnapshotHandler, private readonly onTask?: TaskHandler, private readonly onEvent?: EventHandler) {}

  list() { return this.repository.list(); }
  create(input: CreateAutomationInput) { const snapshot = this.repository.create(input); this.onSnapshot?.(snapshot); return snapshot; }
  setEnabled(id: string, enabled: boolean) { const snapshot = this.repository.setEnabled(id, enabled); this.onSnapshot?.(snapshot); return snapshot; }
  remove(id: string) { const snapshot = this.repository.remove(id); this.onSnapshot?.(snapshot); return snapshot; }
  async runNow(id: string) { this.onSnapshot?.(this.repository.runNow(id)); await this.tick(); return this.repository.list(); }
  async retryRun(runId: string) { this.onSnapshot?.(this.repository.retryRun(runId)); await this.tick(); return this.repository.list(); }

  start() { if (this.timer) return; void this.tick(); this.timer = setInterval(() => void this.tick(), 15_000); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  async tick(now = new Date()) {
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.repository.claimDue(now);
      this.repository.promoteRetries(now);
      this.onSnapshot?.(this.repository.list());
      for (const run of this.repository.pending(now)) await this.executeRun(run);
    } finally { this.ticking = false; }
  }

  private async executeRun(run: AutomationRun) {
    let automation: Automation;
    try { automation = this.repository.getAutomation(run.automationId); }
    catch { return; }
    const task = createAutomationTask(automation, run);
    if (!this.repository.beginRun(run.id, task.id)) return;
    this.onSnapshot?.(this.repository.list());
    try {
      const saved = await this.workspace.saveTaskWithEvent(task, "task.queued", { automationId: automation.id, automationRunId: run.id, attempt: run.attempt }, `${run.id}:${run.attempt}`);
      const queuedEvent = saved.executionEvents.filter(event => event.taskId === task.id).at(-1); if (queuedEvent) this.onEvent?.(queuedEvent);
      this.onTask?.(task);
      const completed = await this.executor.run(task, this.onTask, this.onEvent);
      const snapshot = completed.status === "completed" ? this.repository.completeRun(run.id) : this.repository.failRun(run.id, completed.error || "自动化任务未完成");
      this.onSnapshot?.(snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "自动化任务未完成";
      const snapshot = this.repository.failRun(run.id, message);
      this.onSnapshot?.(snapshot);
    }
  }
}

function createAutomationTask(automation: Automation, run: AutomationRun): StoredTask {
  const createdAt = new Date().toISOString();
  const assistant = automation.assistantId;
  const expertId = assistant?.startsWith("expert:") ? assistant.slice(7) : undefined;
  const teamId = assistant?.startsWith("team:") ? assistant.slice(5) : undefined;
  const taskId = `automation-${run.id}-a${run.attempt}`;
  const turn = { id: `${taskId}-turn`, prompt: automation.prompt, status: "queued" as const, createdAt, expertId, teamId, projectId: automation.projectId, modelMode: "auto" as const, permissionMode: automation.permissionMode };
  return { id: taskId, title: automation.name, prompt: automation.prompt, status: "queued", createdAt, expertId, teamId, projectId: automation.projectId, modelMode: "auto", permissionMode: automation.permissionMode, turns: [turn] };
}
