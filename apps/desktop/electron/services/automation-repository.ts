import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { automationScheduleSchema, type Automation, type AutomationRun, type AutomationSchedule } from "@niuma/contracts";

export interface AutomationSnapshot { automations: Automation[]; runs: AutomationRun[] }
export interface CreateAutomationInput { name: string; prompt: string; schedule: AutomationSchedule; assistantId?: string; projectId?: string; permissionMode?: "restricted" | "default" | "full"; maxRetries?: number }

export class AutomationRepository {
  private readonly db: DatabaseSync;

  constructor(rootPath: string) {
    const directory = resolve(rootPath, "automations");
    mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
    const path = resolve(directory, "automations.sqlite");
    this.db = new DatabaseSync(path); chmodSync(path, 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS automations (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL,
        schedule_json TEXT NOT NULL, time_zone TEXT NOT NULL, assistant_id TEXT, project_id TEXT NOT NULL,
        permission_mode TEXT NOT NULL, max_retries INTEGER NOT NULL, next_run_at TEXT, last_run_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS automation_runs (
        id TEXT PRIMARY KEY, automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
        scheduled_for TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1,
        task_id TEXT, error TEXT, next_attempt_at TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT,
        UNIQUE(automation_id, scheduled_for)
      );
      CREATE INDEX IF NOT EXISTS idx_automation_due ON automations(status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_automation_runs_pending ON automation_runs(status, next_attempt_at, created_at);
    `);
    this.db.prepare("UPDATE automation_runs SET status = 'queued', error = ?, started_at = NULL, next_attempt_at = ? WHERE status = 'running'")
      .run("应用上次在执行期间退出，已准备重新运行。", new Date().toISOString());
  }

  close() { this.db.close(); }

  list(): AutomationSnapshot {
    return {
      automations: (this.db.prepare("SELECT * FROM automations ORDER BY created_at DESC").all() as unknown as AutomationRow[]).map(toAutomation),
      runs: (this.db.prepare("SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT 500").all() as unknown as AutomationRunRow[]).map(toRun),
    };
  }

  create(input: CreateAutomationInput, now = new Date()): AutomationSnapshot {
    const name = input.name.trim(); const prompt = input.prompt.trim();
    if (!name) throw new Error("请输入自动化名称"); if (!prompt) throw new Error("请输入要自动完成的工作");
    if (name.length > 80 || prompt.length > 20_000) throw new Error("自动化内容过长，请精简后重试");
    const schedule = automationScheduleSchema.parse(input.schedule);
    const nextRun = computeNextRun(schedule, now, true);
    if (!nextRun) throw new Error("执行时间必须晚于当前时间");
    const createdAt = now.toISOString();
    this.db.prepare(`INSERT INTO automations (id,name,prompt,status,schedule_json,time_zone,assistant_id,project_id,permission_mode,max_retries,next_run_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), name, prompt, "active", JSON.stringify(schedule), Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai", normalizeAssistantId(input.assistantId), input.projectId?.trim() || "default", input.permissionMode ?? "default", clampRetries(input.maxRetries), nextRun.toISOString(), createdAt, createdAt);
    return this.list();
  }

  setEnabled(id: string, enabled: boolean, now = new Date()): AutomationSnapshot {
    const automation = this.requireAutomation(id);
    const nextRun = enabled ? computeNextRun(automation.schedule, now, false) : undefined;
    if (enabled && !nextRun) throw new Error("单次计划的执行时间已过，请新建自动化");
    this.db.prepare("UPDATE automations SET status = ?, next_run_at = ?, updated_at = ? WHERE id = ?")
      .run(enabled ? "active" : "paused", nextRun?.toISOString() ?? null, now.toISOString(), id);
    return this.list();
  }

  remove(id: string): AutomationSnapshot { this.requireAutomation(id); this.db.prepare("DELETE FROM automations WHERE id = ?").run(id); return this.list(); }

  runNow(id: string, now = new Date()): AutomationSnapshot {
    this.requireAutomation(id);
    this.createRun(id, now.toISOString(), now);
    return this.list();
  }

  claimDue(now = new Date()): AutomationSnapshot {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.db.prepare("SELECT * FROM automations WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT 20").all(now.toISOString()) as unknown as AutomationRow[];
      for (const row of rows) {
        const automation = toAutomation(row); const scheduledFor = automation.nextRunAt!;
        this.createRun(automation.id, scheduledFor, now);
        const next = automation.schedule.kind === "once" ? undefined : computeNextRun(automation.schedule, now, false);
        this.db.prepare("UPDATE automations SET status = ?, next_run_at = ?, last_run_at = ?, updated_at = ? WHERE id = ?")
          .run(automation.schedule.kind === "once" ? "paused" : "active", next?.toISOString() ?? null, scheduledFor, now.toISOString(), automation.id);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.list();
  }

  pending(now = new Date()): AutomationRun[] {
    return (this.db.prepare("SELECT * FROM automation_runs WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT 10").all(now.toISOString()) as unknown as AutomationRunRow[]).map(toRun);
  }

  beginRun(runId: string, taskId: string, now = new Date()) {
    const result = this.db.prepare("UPDATE automation_runs SET status = 'running', task_id = ?, error = NULL, next_attempt_at = NULL, started_at = ? WHERE id = ? AND status = 'queued'").run(taskId, now.toISOString(), runId);
    return Number(result.changes) === 1;
  }

  completeRun(runId: string, now = new Date()): AutomationSnapshot {
    this.db.prepare("UPDATE automation_runs SET status = 'completed', error = NULL, completed_at = ? WHERE id = ?").run(now.toISOString(), runId);
    return this.list();
  }

  failRun(runId: string, error: string, now = new Date()): AutomationSnapshot {
    const run = this.requireRun(runId); const automation = this.requireAutomation(run.automationId);
    if (run.attempt <= automation.maxRetries) {
      const retryAt = new Date(now.getTime() + Math.min(30, 5 * 2 ** (run.attempt - 1)) * 60_000);
      this.db.prepare("UPDATE automation_runs SET status = 'waiting_retry', error = ?, next_attempt_at = ?, completed_at = ? WHERE id = ?").run(publicRunError(error), retryAt.toISOString(), now.toISOString(), runId);
    } else this.db.prepare("UPDATE automation_runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?").run(publicRunError(error), now.toISOString(), runId);
    return this.list();
  }

  promoteRetries(now = new Date()): AutomationSnapshot {
    this.db.prepare("UPDATE automation_runs SET status = 'queued', attempt = attempt + 1, task_id = NULL, started_at = NULL, completed_at = NULL WHERE status = 'waiting_retry' AND next_attempt_at <= ?").run(now.toISOString());
    return this.list();
  }

  retryRun(runId: string, now = new Date()): AutomationSnapshot {
    const run = this.requireRun(runId);
    if (!["failed", "waiting_retry"].includes(run.status)) throw new Error("这次运行当前不需要重试");
    if (run.attempt >= 10) throw new Error("该运行重试次数过多，请新建自动化");
    this.db.prepare("UPDATE automation_runs SET status = 'queued', attempt = attempt + 1, task_id = NULL, error = NULL, next_attempt_at = ?, started_at = NULL, completed_at = NULL WHERE id = ?").run(now.toISOString(), runId);
    return this.list();
  }

  getAutomation(id: string) { return this.requireAutomation(id); }

  private createRun(automationId: string, scheduledFor: string, now: Date) {
    this.db.prepare("INSERT OR IGNORE INTO automation_runs (id,automation_id,scheduled_for,status,attempt,created_at,next_attempt_at) VALUES (?,?,?,?,?,?,?)")
      .run(randomUUID(), automationId, scheduledFor, "queued", 1, now.toISOString(), now.toISOString());
  }
  private requireAutomation(id: string) { const row = this.db.prepare("SELECT * FROM automations WHERE id = ?").get(id) as unknown as AutomationRow | undefined; if (!row) throw new Error("自动化不存在或已删除"); return toAutomation(row); }
  private requireRun(id: string) { const row = this.db.prepare("SELECT * FROM automation_runs WHERE id = ?").get(id) as unknown as AutomationRunRow | undefined; if (!row) throw new Error("运行记录不存在"); return toRun(row); }
}

export function computeNextRun(schedule: AutomationSchedule, after: Date, allowCurrentOnce = false): Date | undefined {
  if (schedule.kind === "once") { const value = new Date(schedule.onceAt); return value.getTime() > after.getTime() || (allowCurrentOnce && value.getTime() === after.getTime()) ? value : undefined; }
  const [hour, minute] = schedule.timeOfDay.split(":").map(Number) as [number, number];
  if (schedule.kind === "interval") {
    const [year, month, day] = schedule.startDate.split("-").map(Number) as [number, number, number];
    const candidate = new Date(year, month - 1, day, hour, minute, 0, 0);
    while (candidate.getTime() <= after.getTime()) candidate.setDate(candidate.getDate() + schedule.intervalDays);
    return candidate;
  }
  const candidate = new Date(after); candidate.setHours(hour, minute, 0, 0);
  if (candidate.getTime() <= after.getTime()) candidate.setDate(candidate.getDate() + 1);
  if (schedule.kind === "weekdays") while ([0, 6].includes(candidate.getDay())) candidate.setDate(candidate.getDate() + 1);
  if (schedule.kind === "weekly") while (candidate.getDay() !== schedule.dayOfWeek) candidate.setDate(candidate.getDate() + 1);
  return candidate;
}

function normalizeAssistantId(value?: string) { const id = value?.trim(); if (!id) return null; if (!/^(?:expert:|team:)[a-z0-9-]{2,64}$/.test(id)) throw new Error("所选专家或专家团不可用"); return id; }
function clampRetries(value?: number) { return Number.isInteger(value) ? Math.max(0, Math.min(2, value!)) : 1; }
function publicRunError(error: string) { return error.replace(/\b(?:Electron|OpenClaw|SQLite|Node\.js)\b/gi, "本地服务").slice(0, 300); }

interface AutomationRow { id: string; name: string; prompt: string; status: "active" | "paused"; schedule_json: string; time_zone: string; assistant_id: string | null; project_id: string; permission_mode: "restricted" | "default" | "full"; max_retries: number; next_run_at: string | null; last_run_at: string | null; created_at: string; updated_at: string }
interface AutomationRunRow { id: string; automation_id: string; scheduled_for: string; status: AutomationRun["status"]; attempt: number; task_id: string | null; error: string | null; next_attempt_at: string | null; created_at: string; started_at: string | null; completed_at: string | null }
function toAutomation(row: AutomationRow): Automation { return { id: row.id, name: row.name, prompt: row.prompt, status: row.status, schedule: automationScheduleSchema.parse(JSON.parse(row.schedule_json)), timeZone: row.time_zone, assistantId: row.assistant_id ?? undefined, projectId: row.project_id, permissionMode: row.permission_mode, maxRetries: row.max_retries, nextRunAt: row.next_run_at ?? undefined, lastRunAt: row.last_run_at ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at }; }
function toRun(row: AutomationRunRow): AutomationRun { return { id: row.id, automationId: row.automation_id, scheduledFor: row.scheduled_for, status: row.status, attempt: row.attempt, taskId: row.task_id ?? undefined, error: row.error ?? undefined, nextAttemptAt: row.next_attempt_at ?? undefined, createdAt: row.created_at, startedAt: row.started_at ?? undefined, completedAt: row.completed_at ?? undefined }; }
