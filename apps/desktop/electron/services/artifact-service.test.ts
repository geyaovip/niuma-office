import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactService } from "./artifact-service";
import { WorkspaceRepository, type StoredTask } from "./workspace-repository";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("ArtifactService", () => {
  it("只通过已登记产物 ID 返回路径隐藏的文本预览", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-artifact-")); roots.push(root);
    const repository = new WorkspaceRepository(root);
    const workspacePath = (await repository.bootstrap()).projects[0]!.path;
    const directory = join(workspacePath, "任务", "周报");
    await mkdir(directory, { recursive: true });
    const path = join(directory, "result.md");
    await writeFile(path, "# 本周进展\n\n已完成交付。\n", "utf8");
    const task: StoredTask = { id: "task-1", title: "周报", prompt: "生成周报", status: "completed", createdAt: "刚刚", projectId: "default" };
    await repository.saveTaskWithArtifact(task, { id: "artifact-1", taskId: task.id, name: "周报.md", path, mimeType: "text/markdown", createdAt: new Date().toISOString() });
    const preview = await new ArtifactService(repository).preview("artifact-1");
    expect(preview).toMatchObject({ kind: "text", name: "周报.md", content: expect.stringContaining("已完成交付") });
    expect(preview).not.toHaveProperty("path");
    await expect(new ArtifactService(repository).preview("unknown")).rejects.toThrow("未找到交付文件");
  });
});
