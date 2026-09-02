import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";

const permissionSchema = z.enum(["workspace.read", "workspace.write", "network.public", "command.execute", "external.send", "workspace.outside"]);
const manifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/), name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/), summary: z.string().min(1),
  category: z.string().min(1), source: z.string().min(1), license: z.string().min(1),
  capabilities: z.array(z.string().min(1)).min(1).max(20), permissions: z.array(permissionSchema).max(20),
  dependencies: z.array(z.string().min(1)).max(20), entrypoint: z.string().min(1), instructions: z.string().min(20),
}).strict();

export type SkillManifest = z.infer<typeof manifestSchema>;
export interface SkillInstallation { skillId: string; version: string; status: "active" | "disabled" | "failed"; installedAt: string; updatedAt: string; previousVersion?: string; error?: string }
export interface SkillCatalogItem { definition: ReturnType<typeof publicDefinition>; installation?: SkillInstallation }

const manifests: SkillManifest[] = [
  { id: "meeting-notes", name: "会议纪要", version: "1.0.0", summary: "从会议材料中提取议题、结论、分歧、负责人和截止时间。", category: "文档处理", source: "牛马办公内置", license: "牛马办公内置许可", capabilities: ["整理议题与结论", "提取行动项", "标注信息缺口"], permissions: ["workspace.read", "workspace.write"], dependencies: [], entrypoint: "instructions.md", instructions: "按议题、结论、分歧、行动项和待确认事项组织内容。行动项必须包含负责人和截止时间；原始材料没有的信息明确标为待确认，不得补写。" },
  { id: "document-delivery", name: "正式文档", version: "1.0.0", summary: "把零散材料整理成结构完整、措辞正式、可直接交付的文档。", category: "文档处理", source: "牛马办公内置", license: "牛马办公内置许可", capabilities: ["重组内容结构", "统一正式措辞", "形成完整交付"], permissions: ["workspace.read", "workspace.write"], dependencies: [], entrypoint: "instructions.md", instructions: "先明确受众、用途和核心结论，再组织标题层级、正文和必要附录。删除空泛套话与重复内容，所有文案采用可直接对外使用的正式中文。" },
  { id: "spreadsheet-insights", name: "表格分析", version: "1.0.0", summary: "核对表格口径，识别趋势、异常和可供管理层判断的重点。", category: "数据分析", source: "牛马办公内置", license: "牛马办公内置许可", capabilities: ["检查数据口径", "识别趋势异常", "形成管理摘要"], permissions: ["workspace.read", "workspace.write"], dependencies: [], entrypoint: "instructions.md", instructions: "分析前说明数据范围、时间口径和缺失值处理。结论需对应具体数据证据；无法证明的因果关系标为假设，并列出需要补充的数据。" },
  { id: "web-research", name: "网页资料研究", version: "1.0.0", summary: "检索公开网页并交叉核验，形成带来源和日期的研究结果。", category: "信息研究", source: "牛马办公内置", license: "牛马办公内置许可", capabilities: ["检索公开信息", "交叉核验来源", "整理证据化结论"], permissions: ["workspace.read", "workspace.write", "network.public"], dependencies: ["公开网络连接"], entrypoint: "instructions.md", instructions: "优先使用官方、原始和时效明确的公开来源。关键结论至少核对来源日期和适用范围，附可访问链接；无法核验的内容不得当作事实。" },
  { id: "presentation-outline", name: "汇报大纲", version: "1.0.0", summary: "将复杂材料整理为面向管理层或客户的页级汇报结构。", category: "演示文稿", source: "牛马办公内置", license: "牛马办公内置许可", capabilities: ["确定汇报主线", "拆分页级内容", "提炼决策事项"], permissions: ["workspace.read", "workspace.write"], dependencies: [], entrypoint: "instructions.md", instructions: "每页只表达一个主要观点，标题直接写结论。区分事实、分析、方案和决策页，并为每页给出支撑材料与讲述重点。" },
];

export class SkillRepository {
  private readonly file: string;
  private readonly installRoot: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly root: string) { this.file = join(root, "data", "skills.json"); this.installRoot = join(root, "skills"); }

  async list(): Promise<SkillCatalogItem[]> { const installations = await this.read(); return manifests.map(manifest => ({ definition: publicDefinition(manifest), installation: installations.find(item => item.skillId === manifest.id) })); }
  async install(skillId: string): Promise<SkillCatalogItem[]> {
    const manifest = manifests.find(item => item.id === skillId); if (!manifest) throw new Error("该技能不在牛马办公的已审核目录中"); validateSkillManifest(manifest, this.installRoot);
    try {
      return await this.mutate(async installations => { const now = new Date().toISOString(); const current = installations.find(item => item.skillId === skillId); const directory = join(this.installRoot, manifest.id, manifest.version); await mkdir(directory, { recursive: true }); await writeFile(join(directory, manifest.entrypoint), `${manifest.instructions}\n`, { encoding: "utf8", mode: 0o600 }); const installation: SkillInstallation = { skillId, version: manifest.version, status: "active", installedAt: current?.installedAt ?? now, updatedAt: now, previousVersion: current && current.version !== manifest.version ? current.version : current?.previousVersion }; return [...installations.filter(item => item.skillId !== skillId), installation]; });
    } catch (error) {
      const message = error instanceof Error ? error.message : "安装未完成";
      return this.mutate(async installations => { const now = new Date().toISOString(); const current = installations.find(item => item.skillId === skillId); const failed: SkillInstallation = { skillId, version: manifest.version, status: "failed", installedAt: current?.installedAt ?? now, updatedAt: now, previousVersion: current?.version !== manifest.version ? current?.version : current?.previousVersion, error: message }; return [...installations.filter(item => item.skillId !== skillId), failed]; });
    }
  }
  async setEnabled(skillId: string, enabled: boolean): Promise<SkillCatalogItem[]> {
    if (!manifests.some(item => item.id === skillId)) throw new Error("未找到技能");
    return this.mutate(async installations => { const current = installations.find(item => item.skillId === skillId); if (!current) throw new Error("请先安装此技能"); const updated = { ...current, status: enabled ? "active" as const : "disabled" as const, updatedAt: new Date().toISOString(), error: undefined }; return [...installations.filter(item => item.skillId !== skillId), updated]; });
  }
  async resolveSnapshots(snapshots: Array<{ id: string; version: string; instructionDigest: string }>, permissionMode: "restricted" | "default" | "full" = "default") {
    const installations = await this.read();
    const allowed = permissionMode === "restricted" ? new Set(["workspace.read"]) : permissionMode === "default" ? new Set(["workspace.read", "workspace.write", "network.public"]) : new Set(permissionSchema.options);
    return snapshots.map(snapshot => { const manifest = manifests.find(item => item.id === snapshot.id && item.version === snapshot.version); const installation = installations.find(item => item.skillId === snapshot.id && item.version === snapshot.version && item.status === "active"); if (!manifest || !installation || digest(manifest.instructions) !== snapshot.instructionDigest) throw new Error(`技能“${snapshot.id}”当前不可用，请重新选择`); const denied = manifest.permissions.find(permission => !allowed.has(permission)); if (denied) throw new Error(`当前任务权限不足以使用技能“${manifest.name}”`); return manifest; });
  }
  private async read(): Promise<SkillInstallation[]> { try { const value = JSON.parse(await readFile(this.file, "utf8")); return Array.isArray(value) ? value.filter(isInstallation) : []; } catch { return []; } }
  private async mutate(change: (items: SkillInstallation[]) => Promise<SkillInstallation[]>) { const operation = this.queue.then(async () => { const items = await change(await this.read()); await mkdir(join(this.root, "data"), { recursive: true }); const temporary = `${this.file}.tmp`; await writeFile(temporary, `${JSON.stringify(items, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }); await rename(temporary, this.file); return this.list(); }); this.queue = operation.catch(() => undefined); return operation; }
}

export function validateSkillManifest(input: unknown, installRoot: string) { const manifest = manifestSchema.parse(input); if (!manifest.license.trim()) throw new Error("技能缺少 License"); const versionRoot = resolve(installRoot, manifest.id, manifest.version); const target = resolve(versionRoot, manifest.entrypoint); const relativePath = relative(versionRoot, target); if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error("技能入口路径越界"); return manifest; }
function publicDefinition(manifest: SkillManifest) { return { id: manifest.id, name: manifest.name, version: manifest.version, summary: manifest.summary, category: manifest.category, source: manifest.source, license: manifest.license, capabilities: [...manifest.capabilities], permissions: [...manifest.permissions], dependencies: [...manifest.dependencies], instructionDigest: digest(manifest.instructions) }; }
function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
function isInstallation(value: unknown): value is SkillInstallation { if (!value || typeof value !== "object") return false; const item = value as Partial<SkillInstallation>; return typeof item.skillId === "string" && typeof item.version === "string" && ["active", "disabled", "failed"].includes(item.status ?? "") && typeof item.installedAt === "string" && typeof item.updatedAt === "string" && (item.previousVersion === undefined || typeof item.previousVersion === "string") && (item.error === undefined || typeof item.error === "string"); }
