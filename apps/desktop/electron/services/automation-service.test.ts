import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskExecutor } from "./task-executor.js";
import type { StoredTask, WorkspaceRepository } from "./workspace-repository.js";
import { AutomationRepository } from "./automation-repository.js";
import { AutomationService } from "./automation-service.js";

const repositories: AutomationRepository[] = [];
afterEach(() => { while (repositories.length) repositories.pop()?.close(); });

describe("AutomationService", () => {
  it("creates a real task and records completion", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-automation-service-"));
    const repository = new AutomationRepository(root); repositories.push(repository);
    const saved: StoredTask[] = []; const updated: StoredTask[] = [];
    const workspace = { saveTaskWithEvent: async (task: StoredTask) => { saved.push(task); return { executionEvents: [] }; } } as unknown as Pick<WorkspaceRepository, "saveTaskWithEvent">;
    const executor = { run: async (task: StoredTask, onTask?: (task: StoredTask) => void) => { const completed = { ...task, status: "completed" as const, output: "已完成" }; onTask?.(completed); return completed; } } as unknown as TaskExecutor;
    const service = new AutomationService(repository, workspace, executor, undefined, task => updated.push(task));
    const now = new Date(2026, 7, 31, 8, 0);
    const automation = service.create({ name: "周报", prompt: "整理本周进展", schedule: { kind: "daily", timeOfDay: "09:00" }, assistantId: "team:office", permissionMode: "restricted" }).automations[0]!;
    repository.runNow(automation.id, now);
    await service.tick(now);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ title: "周报", teamId: "office", projectId: "default", permissionMode: "restricted" });
    expect(repository.list().runs[0]).toMatchObject({ status: "completed", taskId: saved[0]!.id });
    expect(updated.some(task => task.status === "completed")).toBe(true);
  });

  it("records a failed execution without losing the rule", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-automation-service-fail-"));
    const repository = new AutomationRepository(root); repositories.push(repository);
    const workspace = { saveTaskWithEvent: async () => ({ executionEvents: [] }) } as unknown as Pick<WorkspaceRepository, "saveTaskWithEvent">;
    const executor = { run: async () => { throw new Error("provider unavailable"); } } as unknown as TaskExecutor;
    const service = new AutomationService(repository, workspace, executor);
    const now = new Date(2026, 7, 31, 8, 0);
    const automation = service.create({ name: "日报", prompt: "生成日报", schedule: { kind: "daily", timeOfDay: "09:00" }, maxRetries: 0 }).automations[0]!;
    repository.runNow(automation.id, now);
    await service.tick(now);
    expect(repository.list().automations).toHaveLength(1);
    expect(repository.list().runs[0]).toMatchObject({ status: "failed", error: "provider unavailable" });
  });
});
