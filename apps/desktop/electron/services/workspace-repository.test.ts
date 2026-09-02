import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceRepository, type StoredTask } from "./workspace-repository";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("WorkspaceRepository", () => {
  it("串行保存同一任务，不让执行结果被创建状态覆盖", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-workspace-")); roots.push(root);
    const repository = new WorkspaceRepository(root);
    const running: StoredTask = { id: "task-1", title: "会议纪要", prompt: "整理会议纪要", status: "running", createdAt: "刚刚", teamId: "office", projectId: "default" };
    const failed: StoredTask = { ...running, status: "failed", error: "请先完成模型设置" };
    await Promise.all([repository.saveTask(running), repository.saveTask(failed)]);
    const snapshot = await repository.bootstrap();
    expect(snapshot.tasks[0]).toMatchObject({ id: "task-1", status: "failed", error: "请先完成模型设置" });
    const disk = JSON.parse(await readFile(join(root, "牛马办公", "data", "workspace.json"), "utf8"));
    expect(disk.tasks).toHaveLength(1);
  });

  it("启动时将上次异常退出留下的执行中任务标记为可恢复失败", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-workspace-")); roots.push(root);
    const repository = new WorkspaceRepository(root);
    await repository.saveTask({ id: "task-2", title: "周报", prompt: "整理周报", status: "running", createdAt: "2026-08-28T08:00:00.000Z", projectId: "default", turns: [{ id: "turn-completed", prompt: "先整理数据", status: "completed", createdAt: "2026-08-28T07:00:00.000Z", output: "数据已整理" }, { id: "turn-running", prompt: "再生成周报", status: "running", createdAt: "2026-08-28T08:00:00.000Z" }] });
    const snapshot = await repository.recoverInterruptedTasks();
    expect(snapshot.tasks[0]).toMatchObject({ status: "failed", error: "上次执行因应用退出而中断，可以重新提交任务。" });
    expect(snapshot.tasks[0]?.turns?.[0]).toMatchObject({ status: "completed", output: "数据已整理" });
    expect(snapshot.tasks[0]?.turns?.[1]).toMatchObject({ status: "failed", error: "上次执行因应用退出而中断，可以重新提交任务。" });
    expect(snapshot.executionEvents[0]).toMatchObject({ taskId: "task-2", type: "task.failed", sequence: 0, payload: { recovery: true } });
  });

  it("在同一次原子写入中保存任务状态和有序执行事件", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-workspace-")); roots.push(root);
    const repository = new WorkspaceRepository(root);
    const task: StoredTask = { id: "task-3", title: "汇总材料", prompt: "汇总材料", status: "running", createdAt: "刚刚" };
    await repository.saveTaskWithEvent(task, "task.running");
    await repository.saveTaskWithEvent({ ...task, status: "completed" }, "task.completed");
    const snapshot = await repository.bootstrap();
    expect(snapshot.tasks[0]?.status).toBe("completed");
    expect(snapshot.executionEvents.map(event => [event.type, event.sequence])).toEqual([
      ["task.running", 0],
      ["task.completed", 1],
    ]);
  });

  it("按来源幂等键去重事件，并支持按任务顺序重放", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-workspace-")); roots.push(root);
    const repository = new WorkspaceRepository(root);
    const task: StoredTask = { id: "task-4", title: "处理资料", prompt: "处理资料", status: "running", createdAt: "刚刚" };
    await repository.saveTaskWithEvent(task, "tool.started", { toolName: "files" }, "provider-event-1");
    await repository.saveTaskWithEvent(task, "tool.started", { toolName: "files" }, "provider-event-1");
    const events = await repository.getExecutionEvents(task.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "tool.started", sequence: 0, payload: { toolName: "files", dedupeKey: "provider-event-1" } });
  });

  it("登记真实产物、幂等加入资料库并拒绝工作空间外路径", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-workspace-")); roots.push(root);
    const repository = new WorkspaceRepository(root);
    const snapshot = await repository.bootstrap();
    const workspacePath = snapshot.projects[0]!.path;
    const task: StoredTask = { id: "task-artifact", title: "正式周报", prompt: "生成周报", status: "completed", createdAt: "刚刚", projectId: "default" };
    const artifactDirectory = join(workspacePath, "任务");
    const artifactPath = join(artifactDirectory, "result.md");
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(artifactPath, "# 正式周报\n", "utf8");
    const stored = await repository.saveTaskWithArtifact(task, { id: "artifact-1", taskId: task.id, name: "正式周报.md", path: artifactPath, mimeType: "text/markdown", createdAt: new Date().toISOString() });
    expect(stored.artifacts[0]?.id).toBe("artifact-1");
    expect(stored.artifacts[0]?.size).toBeGreaterThan(0);
    expect(stored.executionEvents[0]).toMatchObject({ type: "artifact.created", payload: { artifactId: "artifact-1" } });
    await repository.addArtifactToKnowledge("artifact-1");
    const knowledge = await repository.addArtifactToKnowledge("artifact-1");
    expect(knowledge.knowledgeItems).toHaveLength(1);
    const migrated = await repository.clearLegacyKnowledgeItems(["artifact-1"]);
    expect(migrated.knowledgeItems).toEqual([]);

    const outside = join(root, "outside.md");
    await writeFile(outside, "secret", "utf8");
    await expect(repository.saveTaskWithArtifact(task, { id: "artifact-outside", taskId: task.id, name: "outside.md", path: outside, mimeType: "text/markdown", createdAt: new Date().toISOString() })).rejects.toThrow("不在当前工作空间");
    const linked = join(artifactDirectory, "linked.md");
    await symlink(outside, linked);
    await expect(repository.saveTaskWithArtifact(task, { id: "artifact-link", taskId: task.id, name: "linked.md", path: linked, mimeType: "text/markdown", createdAt: new Date().toISOString() })).rejects.toThrow("不在当前工作空间");
  });

  it("更改默认根目录只影响新内容，并在目录失效后要求重新授权", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-workspace-")); roots.push(root);
    const documents = join(root, "Documents");
    const repository = new WorkspaceRepository(root, documents);
    const initial = await repository.bootstrap();
    const historicalPath = initial.workspaceSettings.defaultRootPath;
    await repository.saveTask({ id: "task-history", title: "历史任务", prompt: "保留原目录", status: "completed", createdAt: "刚刚", projectId: "default", workspacePath: historicalPath });

    const customRoot = join(root, "Custom Workspace");
    await mkdir(customRoot, { recursive: true });
    const changed = await repository.setDefaultRoot(customRoot);
    expect(changed.workspaceSettings).toEqual({ defaultRootPath: customRoot, status: "ready" });
    expect(changed.tasks.find(task => task.id === "task-history")?.workspacePath).toBe(historicalPath);
    const withProject = await repository.createProject("新项目");
    expect(withProject.projects.find(project => project.name === "新项目")?.path).toMatch(new RegExp(`${join(customRoot, "项目", "project-").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*-新项目$`));

    await rm(customRoot, { recursive: true, force: true });
    const unavailable = await repository.bootstrap();
    expect(unavailable.workspaceSettings.status).toBe("needs_reauthorization");
    await expect(repository.getProjectPath("default")).rejects.toThrow("重新授权");
    await expect(repository.validateWorkspacePath(historicalPath)).resolves.toBe(historicalPath);

    const restored = join(root, "Restored Workspace");
    await mkdir(restored, { recursive: true });
    const recovered = await repository.reauthorizeProject("default", restored);
    expect(recovered.workspaceSettings).toEqual({ defaultRootPath: restored, status: "ready" });
  });

  it("项目可直接绑定系统选择的现有文件夹", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-workspace-")); roots.push(root);
    const repository = new WorkspaceRepository(root);
    await repository.bootstrap();
    const selected = join(root, "Existing Project");
    await mkdir(selected, { recursive: true });
    const snapshot = await repository.createProject("客户交付", selected);
    expect(snapshot.projects.find(project => project.name === "客户交付")).toMatchObject({ path: selected, status: "ready" });
  });

  it("项目资料复制到项目目录并持久化来源信息", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-workspace-")); roots.push(root);
    const repository = new WorkspaceRepository(root);
    await repository.bootstrap();
    const created = await repository.createProject("客户资料");
    const project = created.projects.find(item => item.name === "客户资料")!;
    const source = join(root, "requirements.md");
    await writeFile(source, "# 已确认需求\n", "utf8");
    const snapshot = await repository.addProjectFiles(project.id, [source, source]);
    const stored = snapshot.projects.find(item => item.id === project.id)?.sources?.[0];
    expect(snapshot.projects.find(item => item.id === project.id)?.sources).toHaveLength(1);
    expect(stored).toMatchObject({ name: "requirements.md", mimeType: "text/markdown", size: expect.any(Number) });
    expect(stored?.path).toContain(join(project.path, "资料"));
    expect(await readFile(stored!.path, "utf8")).toContain("已确认需求");
    const sourcePaths = await repository.getProjectSourcePaths(project.id);
    expect(sourcePaths).toHaveLength(1);
    expect(await readFile(sourcePaths[0]!, "utf8")).toContain("已确认需求");
    expect((await repository.bootstrap()).projects.find(item => item.id === project.id)?.sources).toHaveLength(1);
  });
});
