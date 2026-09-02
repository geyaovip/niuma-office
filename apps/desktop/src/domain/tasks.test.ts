import { describe, expect, it } from "vitest";
import { continueLocalTask, createLocalTask, retryCurrentTurn } from "./tasks";

describe("createLocalTask", () => {
  it("uses the default workspace and no expert team when neither is selected", () => {
    const task = createLocalTask("整理会议纪要");
    expect(task.projectId).toBe("default");
    expect(task.teamId).toBeUndefined();
    expect(task.expertId).toBeUndefined();
    expect(task.modelMode).toBe("auto");
    expect(Number.isNaN(Date.parse(task.createdAt))).toBe(false);
    expect(task.turns).toHaveLength(1);
    expect(task.turns?.[0]).toMatchObject({ prompt: "整理会议纪要", status: "queued" });
  });

  it("creates a concise title without losing the prompt", () => {
    const prompt = "整理本周销售数据，找出增长最快的三个区域，说明变化原因并生成管理层摘要";
    const task = createLocalTask(prompt, "finance", "launch");
    expect(task.title.endsWith("…")).toBe(true);
    expect(task.prompt).toBe(prompt);
    expect(task.status).toBe("queued");
  });

  it("rejects an empty task", () => {
    expect(() => createLocalTask("   ", "office")).toThrow("任务内容不能为空");
  });

  it("选择单个专家时保存固定版本快照且不设置专家团", () => {
    const task = createLocalTask("整理会议结论", "expert:meeting-editor");
    expect(task.teamId).toBeUndefined();
    expect(task.expertId).toBe("meeting-editor");
    expect(task.expertSnapshot).toMatchObject({ id: "meeting-editor", name: "会议纪要专家", version: "1.0.0" });
    expect(task.turns?.[0]?.expertSnapshot?.capabilities).toContain("提取负责人和截止时间");
  });

  it("选择专家团时不会混入单个专家", () => {
    const task = createLocalTask("联合整理经营分析", "team:finance");
    expect(task.teamId).toBe("finance");
    expect(task.teamSnapshot).toMatchObject({ id: "finance", name: "经营分析专家团", version: "1.0.0" });
    expect(task.teamSnapshot?.members.map(member => member.id)).toEqual(["qiao-heng", "zhao-ning", "meng-chuan"]);
    expect(task.expertId).toBeUndefined();
    expect(task.expertSnapshot).toBeUndefined();
  });

  it("保存本轮所选技能的固定版本快照", () => {
    const skill = { id: "meeting-notes", name: "会议纪要", version: "1.0.0", summary: "整理会议内容", source: "牛马办公内置", license: "牛马办公内置许可", capabilities: ["提取行动项"], permissions: ["workspace.read" as const], instructionDigest: "a".repeat(64) };
    const task = createLocalTask("整理会议", undefined, undefined, "auto", [], "default", [], [skill]);
    expect(task.skillSnapshots).toEqual([skill]);
    expect(task.turns?.[0]?.skillSnapshots).toEqual([skill]);
  });

  it("保存本轮明确选择的资料来源快照", () => {
    const reference = { id: "knowledge-1", name: "制度.txt", kind: "file" as const, contentDigest: "d".repeat(64), selectedAt: "2026-08-28T08:00:00.000Z" };
    const task = createLocalTask("核对制度", undefined, undefined, "auto", [], "default", [], [], [], [reference]);
    expect(task.knowledgeReferences).toEqual([reference]);
    expect(task.turns?.[0]?.knowledgeReferences).toEqual([reference]);
  });
});

describe("continueLocalTask", () => {
  it("沿用任务 ID 并保留历史轮次", () => {
    const original = createLocalTask("先整理会议纪要");
    const completed = { ...original, status: "completed" as const, output: "第一版纪要", turns: original.turns?.map(turn => ({ ...turn, status: "completed" as const, output: "第一版纪要" })) };
    const continued = continueLocalTask(completed, "再补充待办负责人");
    expect(continued.id).toBe(original.id);
    expect(continued.turns).toHaveLength(2);
    expect(continued.turns?.[0]?.output).toBe("第一版纪要");
    expect(continued.turns?.[1]).toMatchObject({ prompt: "再补充待办负责人", status: "queued" });
    expect(continued.output).toBeUndefined();
  });

  it("重试只重置当前轮", () => {
    const original = createLocalTask("第一轮");
    const second = continueLocalTask({ ...original, status: "completed", output: "第一轮结果", turns: original.turns?.map(turn => ({ ...turn, status: "completed" as const, output: "第一轮结果" })) }, "第二轮");
    const failed = { ...second, status: "failed" as const, error: "失败", turns: second.turns?.map((turn, index) => index === 1 ? { ...turn, status: "failed" as const, error: "失败" } : turn) };
    const retried = retryCurrentTurn(failed);
    expect(retried.turns?.[0]).toMatchObject({ status: "completed", output: "第一轮结果" });
    expect(retried.turns?.[1]).toMatchObject({ status: "queued", output: undefined, error: undefined });
  });

  it("不同轮次可以分别选择专家并保留历史专家快照", () => {
    const first = createLocalTask("整理会议", "expert:meeting-editor");
    const completed = { ...first, status: "completed" as const, output: "会议纪要", turns: first.turns?.map(turn => ({ ...turn, status: "completed" as const, output: "会议纪要" })) };
    const second = continueLocalTask(completed, "整理成汇报大纲", "expert:presentation-planner");
    expect(second.turns?.[0]?.expertId).toBe("meeting-editor");
    expect(second.turns?.[1]?.expertId).toBe("presentation-planner");
    expect(second.expertSnapshot?.name).toBe("汇报策划专家");
  });

  it("继续任务时保留历史专家团成员快照", () => {
    const first = createLocalTask("形成产品方案", "team:product");
    const completed = { ...first, status: "completed" as const, output: "产品方案", turns: first.turns?.map(turn => ({ ...turn, status: "completed" as const, output: "产品方案" })) };
    const second = continueLocalTask(completed, "改为单助手复核");
    expect(second.turns?.[0]?.teamSnapshot?.members.map(member => member.name)).toEqual(["顾屿", "贺清", "白榆"]);
    expect(second.turns?.[1]?.teamSnapshot).toBeUndefined();
    expect(second.teamId).toBeUndefined();
  });
});
