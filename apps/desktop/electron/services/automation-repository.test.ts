import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AutomationRepository, computeNextRun } from "./automation-repository.js";

const repositories: AutomationRepository[] = [];
afterEach(() => { while (repositories.length) repositories.pop()?.close(); });
const track = (repository: AutomationRepository) => { repositories.push(repository); return repository; };

describe("automation scheduling", () => {
  it("calculates each supported local schedule", () => {
    const monday = new Date(2026, 7, 31, 10, 15);
    expect(computeNextRun({ kind: "daily", timeOfDay: "09:00" }, monday)?.getDate()).toBe(1);
    expect(computeNextRun({ kind: "weekdays", timeOfDay: "09:00" }, new Date(2026, 8, 4, 10))?.getDay()).toBe(1);
    expect(computeNextRun({ kind: "weekly", dayOfWeek: 3, timeOfDay: "11:00" }, monday)?.getDay()).toBe(3);
    expect(computeNextRun({ kind: "interval", startDate: "2026-08-30", intervalDays: 3, timeOfDay: "08:30" }, monday)?.getDate()).toBe(2);
    const once = new Date(monday.getTime() + 60_000).toISOString();
    expect(computeNextRun({ kind: "once", onceAt: once }, monday)?.toISOString()).toBe(once);
  });

  it("persists rules, claims a missed occurrence once, and never duplicates it", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-automation-"));
    const repository = track(new AutomationRepository(root));
    const createdAt = new Date(2026, 7, 31, 8, 0);
    const created = repository.create({ name: "早报", prompt: "整理今日要点", schedule: { kind: "daily", timeOfDay: "09:00" } }, createdAt);
    expect(created.automations[0]).toMatchObject({ name: "早报", status: "active", projectId: "default", maxRetries: 1 });
    const resumedAt = new Date(2026, 8, 2, 12, 0);
    const claimed = repository.claimDue(resumedAt);
    expect(claimed.runs).toHaveLength(1);
    expect(new Date(claimed.automations[0]!.nextRunAt!).getTime()).toBeGreaterThan(resumedAt.getTime());
    expect(repository.claimDue(resumedAt).runs).toHaveLength(1);
  });

  it("recovers an interrupted run and supports automatic and manual retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-automation-recovery-"));
    const first = track(new AutomationRepository(root));
    const start = new Date(2026, 7, 31, 8, 0);
    const automation = first.create({ name: "跟进", prompt: "更新进展", schedule: { kind: "daily", timeOfDay: "09:00" }, maxRetries: 1 }, start).automations[0]!;
    first.runNow(automation.id, start);
    const run = first.pending(start)[0]!;
    expect(first.beginRun(run.id, "task-1", start)).toBe(true);
    first.close(); repositories.splice(repositories.indexOf(first), 1);
    const second = track(new AutomationRepository(root));
    expect(second.pending(new Date(Date.now() + 1_000))[0]).toMatchObject({ id: run.id, status: "queued" });
    second.beginRun(run.id, "task-2", start);
    expect(second.failRun(run.id, "OpenClaw failed", start).runs[0]).toMatchObject({ status: "waiting_retry" });
    second.promoteRetries(new Date(start.getTime() + 6 * 60_000));
    expect(second.list().runs[0]).toMatchObject({ status: "queued", attempt: 2 });
    second.beginRun(run.id, "task-3", start);
    expect(second.failRun(run.id, "still failed", start).runs[0]).toMatchObject({ status: "failed" });
    expect(second.retryRun(run.id, start).runs[0]).toMatchObject({ status: "queued", attempt: 3 });
  });
});
