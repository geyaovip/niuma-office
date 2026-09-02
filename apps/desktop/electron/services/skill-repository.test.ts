import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillRepository, validateSkillManifest } from "./skill-repository";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("SkillRepository", () => {
  it("按固定版本安装并持久化技能", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-skills-")); roots.push(root);
    const repository = new SkillRepository(root);
    const installed = await repository.install("meeting-notes");
    expect(installed.find(item => item.definition.id === "meeting-notes")?.installation).toMatchObject({ version: "1.0.0", status: "active" });
    expect(await readFile(join(root, "skills", "meeting-notes", "1.0.0", "instructions.md"), "utf8")).toContain("行动项必须包含负责人和截止时间");
    await repository.setEnabled("meeting-notes", false);
    await expect(repository.resolveSnapshots([{ id: "meeting-notes", version: "1.0.0", instructionDigest: installed[0]!.definition.instructionDigest }])).rejects.toThrow("当前不可用");
  });

  it("拒绝未知技能、路径穿越、未固定版本与未知字段", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-skills-")); roots.push(root);
    const repository = new SkillRepository(root);
    await expect(repository.install("unknown")).rejects.toThrow("已审核目录");
    const base = { id: "safe-skill", name: "测试", version: "1.0.0", summary: "测试技能", category: "测试", source: "测试", license: "MIT", capabilities: ["测试"], permissions: [], dependencies: [], entrypoint: "instructions.md", instructions: "这是用于校验清单边界的完整测试技能说明。" };
    expect(() => validateSkillManifest({ ...base, entrypoint: "../../outside.md" }, join(root, "skills"))).toThrow("路径越界");
    expect(() => validateSkillManifest({ ...base, version: "latest" }, join(root, "skills"))).toThrow();
    expect(() => validateSkillManifest({ ...base, unknown: true }, join(root, "skills"))).toThrow();
  });

  it("任务权限不足时拒绝加载技能", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-skills-")); roots.push(root);
    const repository = new SkillRepository(root);
    const items = await repository.install("web-research");
    const definition = items.find(item => item.definition.id === "web-research")!.definition;
    await expect(repository.resolveSnapshots([definition], "restricted")).rejects.toThrow("权限不足");
    await expect(repository.resolveSnapshots([definition], "default")).resolves.toEqual([expect.objectContaining({ id: "web-research", version: "1.0.0" })]);
  });

  it("保存安装失败状态并允许重试恢复", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-skills-")); roots.push(root);
    await writeFile(join(root, "skills"), "阻止创建安装目录", "utf8");
    const repository = new SkillRepository(root);
    const failed = await repository.install("document-delivery");
    expect(failed.find(item => item.definition.id === "document-delivery")?.installation).toMatchObject({ status: "failed", version: "1.0.0" });
    await rm(join(root, "skills"));
    const retried = await repository.install("document-delivery");
    expect(retried.find(item => item.definition.id === "document-delivery")?.installation).toMatchObject({ status: "active", version: "1.0.0" });
  });
});
