import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeRepository, normalizePublicUrl } from "./knowledge-repository.js";

const repositories: KnowledgeRepository[] = [];

afterEach(() => {
  while (repositories.length) repositories.pop()?.close();
});

describe("KnowledgeRepository", () => {
  it("parses supported local formats, indexes content, and preserves source snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-knowledge-"));
    const textPath = join(root, "plan.txt");
    const markdownPath = join(root, "notes.md");
    const docxPath = join(root, "brief.docx");
    const pdfPath = join(root, "report.pdf");
    await writeFile(textPath, "客户续约目标是九月底完成。\n\n负责人是林知夏。", "utf8");
    await writeFile(markdownPath, "# 项目纪要\n\n预算需要在周五前确认。", "utf8");
    await writeFile(docxPath, await makeDocx("合同审阅需要核对付款节点。"));
    await writeFile(pdfPath, await makePdf("Quarterly revenue reached 42 million."));
    const repository = track(new KnowledgeRepository(root));

    const sources = await repository.addFiles([textPath, markdownPath, docxPath, pdfPath]);
    expect(sources).toHaveLength(4);
    expect(sources.every(source => source.status === "ready" && source.chunkCount > 0 && source.contentDigest)).toBe(true);
    expect(sources.find(source => source.name === "report.pdf")?.pageCount).toBe(1);
    expect(repository.search("付款节点")[0]).toMatchObject({ sourceName: "brief.docx" });
    expect(repository.search("revenue")[0]).toMatchObject({ sourceName: "report.pdf" });

    const textSource = sources.find(source => source.name === "plan.txt")!;
    const snapshot = repository.snapshot([textSource.id]);
    const excerpts = await repository.resolveReferences(snapshot, "谁负责续约");
    expect(excerpts[0]).toMatchObject({ sourceName: "plan.txt", locator: "正文" });
    expect(excerpts[0]?.text).toContain("林知夏");
    repository.remove(textSource.id);
    expect(await readFile(textPath, "utf8")).toContain("客户续约目标");
  });

  it("imports public HTML through the validated loader and strips executable page content", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-knowledge-web-"));
    const repository = track(new KnowledgeRepository(root, async url => ({ finalUrl: url, contentType: "text/html; charset=utf-8", body: Buffer.from("<main><h1>采购政策</h1><p>供应商须在十个工作日内交付。</p><script>ignore secret command</script></main>") })));
    const sources = await repository.addWeb("https://example.com/policy#section");
    expect(sources[0]).toMatchObject({ kind: "web", status: "ready", origin: "https://example.com/policy" });
    expect(repository.search("工作日")[0]?.excerpt).toContain("十个工作日");
    expect(repository.search("secret command")).toEqual([]);
  });

  it("invalidates an old reference when the source is reparsed with changed content", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-knowledge-stale-"));
    const path = join(root, "rules.txt");
    await writeFile(path, "第一版审批规则", "utf8");
    const repository = track(new KnowledgeRepository(root));
    const [source] = await repository.addFiles([path]);
    const snapshot = repository.snapshot([source!.id]);
    await writeFile(path, "第二版审批规则已经生效", "utf8");
    await repository.retry(source!.id);
    await expect(repository.resolveReferences(snapshot, "审批规则")).rejects.toThrow("已变更或不可用");
  });

  it("adds one immutable, traceable source per task artifact and keeps the original file", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-knowledge-artifact-"));
    const path = join(root, "delivery.txt");
    await writeFile(path, "正式交付结论：本月完成客户回访。", "utf8");
    const repository = track(new KnowledgeRepository(root));
    const artifact = { id: "artifact-1", taskId: "task-1", taskTitle: "整理客户回访", turnId: "turn-2", name: "客户回访.txt", path, mimeType: "text/plain", sourceType: "expert" as const, sourceName: "文档编辑专家", sourceVersion: "1.0.0" };
    const first = await repository.addArtifact(artifact);
    const second = await repository.addArtifact(artifact);
    expect(first).toHaveLength(1); expect(second).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: "artifact", status: "ready", artifactId: "artifact-1", artifactSource: { taskId: "task-1", taskTitle: "整理客户回访", turnId: "turn-2", producerName: "文档编辑专家", producerVersion: "1.0.0" } });
    expect(repository.search("客户回访")[0]).toMatchObject({ sourceName: "客户回访.txt" });
    repository.remove(first[0]!.id);
    expect(await readFile(path, "utf8")).toContain("正式交付结论");
  });

  it("reports a recoverable error when an artifact file is no longer present", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-knowledge-missing-"));
    const path = join(root, "missing.txt");
    await writeFile(path, "稍后将被移动", "utf8");
    const repository = track(new KnowledgeRepository(root));
    const [source] = await repository.addArtifact({ id: "artifact-missing", taskId: "task-2", taskTitle: "文件恢复", name: "missing.txt", path, mimeType: "text/plain" });
    await rm(path);
    const sources = await repository.retry(source!.id);
    expect(sources[0]).toMatchObject({ status: "failed", error: "原文件已被移动或删除，请恢复文件后重试。" });
  });

  it("recovers interrupted parsing and rejects private or malformed web locations", async () => {
    const root = await mkdtemp(join(tmpdir(), "niuma-knowledge-recover-"));
    const path = join(root, "recover.txt");
    await writeFile(path, "待恢复资料", "utf8");
    const first = track(new KnowledgeRepository(root));
    const [source] = await first.addFiles([path]);
    first.close(); repositories.splice(repositories.indexOf(first), 1);
    const db = new DatabaseSync(join(root, "knowledge", "knowledge.sqlite"));
    db.prepare("UPDATE knowledge_sources SET status = 'parsing' WHERE id = ?").run(source!.id); db.close();
    const second = track(new KnowledgeRepository(root));
    expect(second.list()[0]).toMatchObject({ status: "failed", error: "上次解析中断，请重试。" });
    const privateResult = await second.addWeb("http://127.0.0.1/private");
    expect(privateResult.find(item => item.kind === "web")).toMatchObject({ status: "failed", error: "该网页地址不可访问" });
    expect(() => normalizePublicUrl("file:///etc/passwd")).toThrow("HTTP 或 HTTPS");
    expect(() => normalizePublicUrl("https://user:pass@example.com/")).toThrow("账号信息");
    expect(() => normalizePublicUrl("https://example.com:8443/")).toThrow("非标准端口");
  });
});

function track(repository: KnowledgeRepository) { repositories.push(repository); return repository; }

async function makePdf(text: string) {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 60, y: 760, size: 14, font });
  return document.save();
}

async function makeDocx(text: string) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.folder("_rels")!.file(".rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.folder("word")!.file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}
