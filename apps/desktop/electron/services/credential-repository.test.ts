import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CredentialRepository } from "./credential-repository";

const roots: string[] = [];
afterEach(() => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));
const cipher = { available: () => true, encrypt: (value: string) => Buffer.from(`sealed:${value}`).toString("base64"), decrypt: (value: string) => Buffer.from(value, "base64").toString().slice(7) };

describe("CredentialRepository", () => {
  it("stores only encrypted values and enforces the approved host boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-credentials-")); roots.push(root);
    const repository = new CredentialRepository(root, cipher);
    await repository.store("calendar.token", "secret-value", ["api.example.com"]);
    const serialized = await readFile(join(root, "credentials", "vault.json"), "utf8");
    expect(serialized).not.toContain("secret-value");
    await expect(repository.resolve("calendar.token", ["api.example.com"])).resolves.toBe("secret-value");
    await expect(repository.resolve("calendar.token")).resolves.toBeUndefined();
    await expect(repository.resolve("calendar.token", ["other.example.com"])).resolves.toBeUndefined();
  });

  it("does not persist a reusable credential without an approved host boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-credentials-unscoped-")); roots.push(root);
    const repository = new CredentialRepository(root, cipher);
    await expect(repository.store("calendar.token", "secret-value")).rejects.toThrow("缺少凭证授权域名");
  });
});
