import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { chmodSync, mkdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { extname, basename, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { htmlToText } from "html-to-text";
import mammoth from "mammoth";

export type KnowledgeSourceKind = "file" | "web" | "artifact";
export type KnowledgeSourceStatus = "parsing" | "ready" | "failed";

export interface KnowledgeSource {
  id: string;
  name: string;
  kind: KnowledgeSourceKind;
  origin: string;
  mimeType: string;
  size: number;
  status: KnowledgeSourceStatus;
  createdAt: string;
  updatedAt: string;
  contentDigest?: string;
  chunkCount: number;
  pageCount?: number;
  error?: string;
  artifactId?: string;
  artifactSource?: { artifactId: string; taskId: string; taskTitle: string; turnId?: string; producerType?: "assistant" | "expert" | "expert_team"; producerName?: string; producerVersion?: string };
}

export interface KnowledgeReferenceSnapshot { id: string; name: string; kind: KnowledgeSourceKind; contentDigest: string; selectedAt: string }
export interface KnowledgeSearchResult { sourceId: string; sourceName: string; kind: KnowledgeSourceKind; origin: string; locator: string; excerpt: string; score: number }
export interface ResolvedKnowledgeExcerpt { sourceId: string; sourceName: string; locator: string; text: string }

interface ParsedDocument { chunks: Array<{ locator: string; text: string }>; pageCount?: number; mimeType: string; size: number }
interface WebDocument { finalUrl: string; contentType: string; body: Buffer }
type WebLoader = (url: string) => Promise<WebDocument>;
export interface ArtifactKnowledgeInput { id: string; taskId: string; taskTitle: string; turnId?: string; name: string; path: string; mimeType: string; sourceType?: "assistant" | "expert" | "expert_team"; sourceName?: string; sourceVersion?: string; size?: number }

const FILE_LIMITS = new Map([
  [".pdf", 50 * 1024 * 1024],
  [".docx", 25 * 1024 * 1024],
  [".md", 10 * 1024 * 1024],
  [".markdown", 10 * 1024 * 1024],
  [".txt", 10 * 1024 * 1024],
]);
const MAX_PDF_PAGES = 300;
const MAX_WEB_BYTES = 5 * 1024 * 1024;

export class KnowledgeRepository {
  private readonly db: DatabaseSync;
  private readonly loadWeb: WebLoader;

  constructor(rootPath: string, webLoader: WebLoader = loadPublicWebPage) {
    const directory = resolve(rootPath, "knowledge");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const databasePath = resolve(directory, "knowledge.sqlite");
    this.db = new DatabaseSync(databasePath);
    chmodSync(databasePath, 0o600);
    this.loadWeb = webLoader;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS knowledge_sources (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, origin TEXT NOT NULL,
        mime_type TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, content_digest TEXT,
        chunk_count INTEGER NOT NULL DEFAULT 0, page_count INTEGER, error TEXT, artifact_id TEXT
      );
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL, locator TEXT NOT NULL, text TEXT NOT NULL, digest TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source ON knowledge_chunks(source_id, ordinal);
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(source_id UNINDEXED, locator UNINDEXED, text, tokenize='unicode61');
    `);
    this.ensureColumn("artifact_task_id", "TEXT");
    this.ensureColumn("artifact_task_title", "TEXT");
    this.ensureColumn("artifact_turn_id", "TEXT");
    this.ensureColumn("artifact_source_type", "TEXT");
    this.ensureColumn("artifact_source_name", "TEXT");
    this.ensureColumn("artifact_source_version", "TEXT");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_sources_artifact ON knowledge_sources(artifact_id) WHERE artifact_id IS NOT NULL");
    this.db.prepare("UPDATE knowledge_sources SET status = 'failed', error = ?, updated_at = ? WHERE status = 'parsing'")
      .run("上次解析中断，请重试。", new Date().toISOString());
  }

  close() { this.db.close(); }

  list(): KnowledgeSource[] {
    return (this.db.prepare("SELECT * FROM knowledge_sources ORDER BY created_at DESC").all() as unknown as SourceRow[]).map(toSource);
  }

  async addFiles(paths: string[]): Promise<KnowledgeSource[]> {
    const unique = [...new Set(paths.map(path => resolve(path)))].slice(0, 20);
    for (const path of unique) {
      const source = this.createSource({ name: basename(path), kind: "file", origin: path, mimeType: mimeType(path), size: safeSize(path) });
      await this.parseAndStore(source.id);
    }
    return this.list();
  }

  async addArtifact(artifact: ArtifactKnowledgeInput): Promise<KnowledgeSource[]> {
    const existing = this.db.prepare("SELECT id FROM knowledge_sources WHERE artifact_id = ?").get(artifact.id) as { id: string } | undefined;
    if (existing) return this.list();
    const source = this.createSource({
      name: artifact.name, kind: "artifact", origin: resolve(artifact.path), mimeType: artifact.mimeType, size: artifact.size ?? safeSize(artifact.path), artifactId: artifact.id,
      artifactTaskId: artifact.taskId, artifactTaskTitle: artifact.taskTitle, artifactTurnId: artifact.turnId, artifactSourceType: artifact.sourceType, artifactSourceName: artifact.sourceName, artifactSourceVersion: artifact.sourceVersion,
    });
    await this.parseAndStore(source.id);
    return this.list();
  }

  async addWeb(rawUrl: string): Promise<KnowledgeSource[]> {
    const url = normalizePublicUrl(rawUrl);
    const source = this.createSource({ name: new URL(url).hostname, kind: "web", origin: url, mimeType: "text/html", size: 0 });
    await this.parseAndStore(source.id);
    return this.list();
  }

  async retry(sourceId: string): Promise<KnowledgeSource[]> {
    const source = this.requireSource(sourceId);
    this.db.prepare("UPDATE knowledge_sources SET status = 'parsing', error = NULL, updated_at = ? WHERE id = ?").run(new Date().toISOString(), sourceId);
    await this.parseAndStore(sourceId);
    return this.list();
  }

  remove(sourceId: string): KnowledgeSource[] {
    this.requireSource(sourceId);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM knowledge_chunks_fts WHERE source_id = ?").run(sourceId);
      this.db.prepare("DELETE FROM knowledge_sources WHERE id = ?").run(sourceId);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.list();
  }

  search(query: string, limit = 20): KnowledgeSearchResult[] {
    const terms = tokenizeQuery(query);
    if (!terms.length) return [];
    const rows = this.db.prepare(`SELECT c.source_id, s.name, s.kind, s.origin, c.locator, c.text FROM knowledge_chunks c JOIN knowledge_sources s ON s.id = c.source_id WHERE s.status = 'ready'`).all() as unknown as SearchTextRow[];
    return rows.map(row => {
      const normalized = row.text.toLocaleLowerCase();
      const score = terms.reduce((total, term) => total + occurrences(normalized, term), 0);
      return { row, score, excerpt: excerptAround(row.text, terms) };
    }).filter(result => result.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(limit, 50)))
      .map(({ row, score, excerpt }) => ({ sourceId: row.source_id, sourceName: row.name, kind: row.kind, origin: row.origin, locator: row.locator, excerpt, score }));
  }

  snapshot(sourceIds: string[]): KnowledgeReferenceSnapshot[] {
    return [...new Set(sourceIds)].slice(0, 5).map(id => {
      const source = this.requireSource(id);
      if (source.status !== "ready" || !source.contentDigest) throw new Error(`“${source.name}”尚未解析完成`);
      return { id: source.id, name: source.name, kind: source.kind, contentDigest: source.contentDigest, selectedAt: new Date().toISOString() };
    });
  }

  async resolveReferences(references: KnowledgeReferenceSnapshot[], query: string): Promise<ResolvedKnowledgeExcerpt[]> {
    const terms = tokenizeQuery(query);
    const output: ResolvedKnowledgeExcerpt[] = [];
    for (const reference of references.slice(0, 5)) {
      const source = this.requireSource(reference.id);
      if (source.status !== "ready" || source.contentDigest !== reference.contentDigest) throw new Error(`资料“${reference.name}”已变更或不可用，请重新选择`);
      const chunks = this.db.prepare("SELECT locator, text FROM knowledge_chunks WHERE source_id = ? ORDER BY ordinal").all(source.id) as unknown as ChunkRow[];
      const ranked = chunks.map((chunk, ordinal) => ({ ...chunk, ordinal, score: terms.reduce((score, term) => score + occurrences(chunk.text.toLocaleLowerCase(), term), 0) }))
        .sort((a, b) => b.score - a.score || a.ordinal - b.ordinal)
        .slice(0, 4);
      for (const chunk of ranked) output.push({ sourceId: source.id, sourceName: source.name, locator: chunk.locator, text: chunk.text });
    }
    return output;
  }

  private createSource(input: { name: string; kind: KnowledgeSourceKind; origin: string; mimeType: string; size: number; artifactId?: string; artifactTaskId?: string; artifactTaskTitle?: string; artifactTurnId?: string; artifactSourceType?: string; artifactSourceName?: string; artifactSourceVersion?: string }) {
    const now = new Date().toISOString();
    const source: KnowledgeSource = { id: randomUUID(), ...input, status: "parsing", createdAt: now, updatedAt: now, chunkCount: 0 };
    this.db.prepare(`INSERT INTO knowledge_sources
      (id, name, kind, origin, mime_type, size, status, created_at, updated_at, chunk_count, artifact_id, artifact_task_id, artifact_task_title, artifact_turn_id, artifact_source_type, artifact_source_name, artifact_source_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`)
      .run(source.id, source.name, source.kind, source.origin, source.mimeType, source.size, source.status, source.createdAt, source.updatedAt, source.artifactId ?? null, input.artifactTaskId ?? null, input.artifactTaskTitle ?? null, input.artifactTurnId ?? null, input.artifactSourceType ?? null, input.artifactSourceName ?? null, input.artifactSourceVersion ?? null);
    return source;
  }

  private ensureColumn(name: string, definition: string) {
    const columns = this.db.prepare("PRAGMA table_info(knowledge_sources)").all() as unknown as Array<{ name: string }>;
    if (!columns.some(column => column.name === name)) this.db.exec(`ALTER TABLE knowledge_sources ADD COLUMN ${name} ${definition}`);
  }

  private async parseAndStore(sourceId: string) {
    const source = this.requireSource(sourceId);
    try {
      const parsed = source.kind === "web" ? await parseWeb(source.origin, this.loadWeb) : await parseFile(source.origin);
      if (!parsed.chunks.length) throw new Error("未能从资料中提取到可用文字");
      const digest = createHash("sha256").update(parsed.chunks.map(chunk => `${chunk.locator}\n${chunk.text}`).join("\n\n")).digest("hex");
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.prepare("DELETE FROM knowledge_chunks_fts WHERE source_id = ?").run(sourceId);
        this.db.prepare("DELETE FROM knowledge_chunks WHERE source_id = ?").run(sourceId);
        const insertChunk = this.db.prepare("INSERT INTO knowledge_chunks (id, source_id, ordinal, locator, text, digest) VALUES (?, ?, ?, ?, ?, ?)");
        const insertFts = this.db.prepare("INSERT INTO knowledge_chunks_fts (source_id, locator, text) VALUES (?, ?, ?)");
        parsed.chunks.forEach((chunk, ordinal) => {
          const chunkDigest = createHash("sha256").update(chunk.text).digest("hex");
          insertChunk.run(`${sourceId}:${ordinal}`, sourceId, ordinal, chunk.locator, chunk.text, chunkDigest);
          insertFts.run(sourceId, chunk.locator, chunk.text);
        });
        this.db.prepare(`UPDATE knowledge_sources SET status = 'ready', error = NULL, mime_type = ?, size = ?, content_digest = ?, chunk_count = ?, page_count = ?, updated_at = ? WHERE id = ?`)
          .run(parsed.mimeType, parsed.size, digest, parsed.chunks.length, parsed.pageCount ?? null, new Date().toISOString(), sourceId);
        this.db.exec("COMMIT");
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    } catch (error) {
      this.db.prepare("UPDATE knowledge_sources SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
        .run(publicError(error), new Date().toISOString(), sourceId);
    }
  }

  private requireSource(sourceId: string) {
    const row = this.db.prepare("SELECT * FROM knowledge_sources WHERE id = ?").get(sourceId) as unknown as SourceRow | undefined;
    if (!row) throw new Error("资料不存在或已被移除");
    return toSource(row);
  }
}

async function parseFile(path: string): Promise<ParsedDocument> {
  const extension = extname(path).toLocaleLowerCase();
  const limit = FILE_LIMITS.get(extension);
  if (!limit) throw new Error("当前仅支持 PDF、DOCX、Markdown 和 TXT 文件");
  const size = statSync(path).size;
  if (size > limit) throw new Error(`文件超过 ${Math.round(limit / 1024 / 1024)} MB 上限`);
  const buffer = await readFile(path);
  if (extension === ".pdf") return parsePdf(buffer, size);
  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    const text = normalizeText(result.value);
    return { chunks: chunkText(text, "正文"), mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size };
  }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { throw new Error("文件不是有效的 UTF-8 文本"); }
  return { chunks: chunkText(normalizeText(text), extension === ".txt" ? "正文" : "Markdown"), mimeType: mimeType(path), size };
}

async function parsePdf(buffer: Buffer, size: number): Promise<ParsedDocument> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  const document = await loadingTask.promise;
  if (document.numPages > MAX_PDF_PAGES) throw new Error(`PDF 超过 ${MAX_PDF_PAGES} 页上限`);
  const chunks: Array<{ locator: string; text: string }> = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = normalizeText(content.items.map(item => "str" in item ? item.str : "").join(" "));
    chunks.push(...chunkText(text, `第 ${pageNumber} 页`));
    page.cleanup();
  }
  const pageCount = document.numPages;
  await loadingTask.destroy();
  return { chunks, pageCount, mimeType: "application/pdf", size };
}

async function parseWeb(url: string, loader: WebLoader): Promise<ParsedDocument> {
  const page = await loader(url);
  const contentType = page.contentType.split(";")[0]?.trim().toLocaleLowerCase() || "text/html";
  if (!contentType.includes("html") && !contentType.startsWith("text/")) throw new Error("网页不是可解析的文字内容");
  const body = new TextDecoder("utf-8", { fatal: false }).decode(page.body);
  const text = contentType.includes("html") ? htmlToText(body, { wordwrap: false, selectors: [{ selector: "script", format: "skip" }, { selector: "style", format: "skip" }, { selector: "noscript", format: "skip" }] }) : body;
  return { chunks: chunkText(normalizeText(text), "网页正文"), mimeType: contentType, size: page.body.length };
}

function chunkText(text: string, locatorPrefix: string) {
  if (!text) return [];
  const chunks: Array<{ locator: string; text: string }> = [];
  const paragraphs = text.split(/\n{2,}/).map(value => value.trim()).filter(Boolean);
  let current = "";
  const flush = () => { if (current) { chunks.push({ locator: chunks.length ? `${locatorPrefix} · 第 ${chunks.length + 1} 段` : locatorPrefix, text: current }); current = ""; } };
  for (const paragraph of paragraphs) {
    if (paragraph.length > 1600) {
      flush();
      for (let offset = 0; offset < paragraph.length; offset += 1200) chunks.push({ locator: `${locatorPrefix} · 第 ${chunks.length + 1} 段`, text: paragraph.slice(offset, offset + 1350) });
    } else if (!current || current.length + paragraph.length + 2 <= 1400) current += `${current ? "\n\n" : ""}${paragraph}`;
    else { flush(); current = paragraph; }
  }
  flush();
  return chunks;
}

export function normalizePublicUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error("请输入完整的公开网页地址"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("网页地址必须使用 HTTP 或 HTTPS");
  if (url.username || url.password) throw new Error("网页地址不能包含账号信息");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("网页地址不能使用非标准端口");
  url.hash = "";
  return url.toString();
}

async function loadPublicWebPage(rawUrl: string, redirects = 0): Promise<WebDocument> {
  if (redirects > 5) throw new Error("网页重定向次数过多");
  const normalized = normalizePublicUrl(rawUrl);
  const url = new URL(normalized);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  const publicAddresses = addresses.filter(item => !isPrivateAddress(item.address));
  if (!publicAddresses.length) throw new Error("该网页地址不可访问");
  const pinned = publicAddresses[0]!;
  const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolvePromise, reject) => {
    const request = transport(url, {
      method: "GET", headers: { "User-Agent": "NiumaOffice/0.1 KnowledgeImporter", Accept: "text/html,text/plain;q=0.9", "Accept-Encoding": "identity" },
      lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) {
          (callback as unknown as (error: Error | null, addresses: Array<{ address: string; family: number }>) => void)(null, [pinned]);
        } else callback(null, pinned.address, pinned.family);
      },
    }, response => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        void loadPublicWebPage(new URL(response.headers.location, url).toString(), redirects + 1).then(resolvePromise, reject);
        return;
      }
      if (status < 200 || status >= 300) { response.resume(); reject(new Error(`网页返回 ${status} 状态`)); return; }
      const declared = Number(response.headers["content-length"] ?? 0);
      if (declared > MAX_WEB_BYTES) { response.resume(); reject(new Error("网页内容超过 5 MB 上限")); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_WEB_BYTES) request.destroy(new Error("网页内容超过 5 MB 上限")); else chunks.push(chunk); });
      response.on("end", () => resolvePromise({ finalUrl: normalized, contentType: String(response.headers["content-type"] ?? "text/html"), body: Buffer.concat(chunks) }));
    });
    request.setTimeout(15_000, () => request.destroy(new Error("网页读取超时")));
    request.on("error", reject);
    request.end();
  });
}

function isPrivateAddress(address: string) {
  const value = address.toLocaleLowerCase();
  if (value === "::1" || value === "::" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return true;
  const mapped = value.startsWith("::ffff:") ? value.slice(7) : value;
  const parts = mapped.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a = -1, b = -1] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function tokenizeQuery(query: string) { return [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 12); }
function occurrences(text: string, term: string) { let count = 0; let offset = 0; while ((offset = text.indexOf(term, offset)) >= 0) { count += 1; offset += term.length; } return count; }
function excerptAround(text: string, terms: string[]) { const normalized = text.toLocaleLowerCase(); const matches = terms.map(term => normalized.indexOf(term)).filter(index => index >= 0); const center = matches.length ? Math.min(...matches) : 0; const start = Math.max(0, center - 70); const end = Math.min(text.length, start + 220); return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`; }
function normalizeText(value: string) { return value.replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(); }
function mimeType(path: string) { const extension = extname(path).toLocaleLowerCase(); return extension === ".pdf" ? "application/pdf" : extension === ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : extension === ".md" || extension === ".markdown" ? "text/markdown" : "text/plain"; }
function safeSize(path: string) { try { return statSync(path).size; } catch { return 0; } }
function publicError(error: unknown) { const message = error instanceof Error ? error.message : "资料解析失败"; if (/ENOENT|no such file/i.test(message)) return "原文件已被移动或删除，请恢复文件后重试。"; if (/EACCES|EPERM|permission denied/i.test(message)) return "没有读取原文件的权限，请重新授权后重试。"; return message.replace(/\b(?:Electron|OpenClaw|SQLite|Node\.js)\b/gi, "本地服务").slice(0, 240); }

interface SourceRow { id: string; name: string; kind: KnowledgeSourceKind; origin: string; mime_type: string; size: number; status: KnowledgeSourceStatus; created_at: string; updated_at: string; content_digest: string | null; chunk_count: number; page_count: number | null; error: string | null; artifact_id: string | null; artifact_task_id: string | null; artifact_task_title: string | null; artifact_turn_id: string | null; artifact_source_type: "assistant" | "expert" | "expert_team" | null; artifact_source_name: string | null; artifact_source_version: string | null }
interface SearchTextRow { source_id: string; name: string; kind: KnowledgeSourceKind; origin: string; locator: string; text: string }
interface ChunkRow { locator: string; text: string }
function toSource(row: SourceRow): KnowledgeSource { return { id: row.id, name: row.name, kind: row.kind, origin: row.origin, mimeType: row.mime_type, size: row.size, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, contentDigest: row.content_digest ?? undefined, chunkCount: row.chunk_count, pageCount: row.page_count ?? undefined, error: row.error ?? undefined, artifactId: row.artifact_id ?? undefined, artifactSource: row.artifact_id && row.artifact_task_id && row.artifact_task_title ? { artifactId: row.artifact_id, taskId: row.artifact_task_id, taskTitle: row.artifact_task_title, turnId: row.artifact_turn_id ?? undefined, producerType: row.artifact_source_type ?? undefined, producerName: row.artifact_source_name ?? undefined, producerVersion: row.artifact_source_version ?? undefined } : undefined }; }
