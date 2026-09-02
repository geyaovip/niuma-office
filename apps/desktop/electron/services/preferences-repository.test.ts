import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PreferencesRepository } from "./preferences-repository";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("PreferencesRepository", () => {
  it("默认跟随系统并持久化用户选择", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-preferences-")); roots.push(root);
    const first = new PreferencesRepository(root);
    expect(await first.get()).toEqual({ appearance: "system" });
    await first.save({ appearance: "dark" });
    expect(await new PreferencesRepository(root).get()).toEqual({ appearance: "dark" });
  });

  it("拒绝未知外观值", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-preferences-")); roots.push(root);
    await expect(new PreferencesRepository(root).save({ appearance: "blue" })).rejects.toThrow("外观设置无效");
  });
});
