import { artifactSchema, connectorSnapshotSchema, knowledgeReferenceSnapshotSchema, pendingQuestionSchema, progressCardSchema, runtimeEventSchema, skillSnapshotSchema, taskTurnSchema, type Artifact, type RuntimeEvent } from "@niuma/contracts";
import { access, appendFile, copyFile, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, extname, isAbsolute, join, relative } from "node:path";

type TaskStatus = "queued" | "running" | "waiting" | "waiting_user" | "completed" | "failed" | "cancelled";
export type ExecutionEventType = RuntimeEvent["type"];

export interface StoredExpertRun {
  id: string;
  expertId: string;
  expertName: string;
  role: string;
  status: TaskStatus;
  output?: string;
  error?: string;
}

export interface StoredTaskTurn {
  id: string;
  prompt: string;
  status: TaskStatus;
  createdAt: string;
  teamId?: string;
  teamSnapshot?: StoredTeamSnapshot;
  expertId?: string;
  expertSnapshot?: StoredExpertSnapshot;
  skillSnapshots?: StoredSkillSnapshot[];
  connectorSnapshots?: StoredConnectorSnapshot[];
  knowledgeReferences?: StoredKnowledgeReference[];
  projectId?: string;
  modelMode?: "auto" | "custom";
  permissionMode?: "restricted" | "default" | "full";
  attachments?: string[];
  artifactInputs?: string[];
  output?: string;
  error?: string;
  artifactPath?: string;
  completedAt?: string;
  expertRuns?: StoredExpertRun[];
}

export interface StoredTask {
  id: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  createdAt: string;
  teamId?: string;
  teamSnapshot?: StoredTeamSnapshot;
  expertId?: string;
  expertSnapshot?: StoredExpertSnapshot;
  skillSnapshots?: StoredSkillSnapshot[];
  connectorSnapshots?: StoredConnectorSnapshot[];
  knowledgeReferences?: StoredKnowledgeReference[];
  projectId?: string;
  workspacePath?: string;
  modelMode?: "auto" | "custom";
  permissionMode?: "restricted" | "default" | "full";
  attachments?: string[];
  artifactInputs?: string[];
  output?: string;
  error?: string;
  artifactPath?: string;
  completedAt?: string;
  expertRuns?: StoredExpertRun[];
  turns?: StoredTaskTurn[];
  channelOrigin?: { channel: "telegram" | "feishu"; envelopeId: string; bindingId: string; conversationKey: string };
  pendingPermission?: { id: string; kind?: "exec" | "plugin"; command: string; cwd?: string; description?: string; severity?: "info" | "warning" | "critical"; expiresAt?: number };
  progressCard?: { revision: number; markdown?: string; steps: Array<{ step: string; status: "pending" | "in_progress" | "completed" }> };
  pendingQuestion?: { id: string; expiresAt: number; questions: Array<{ questionId: string; header: string; question: string; options: Array<{ label: string; description?: string }>; multiSelect?: boolean; isOther?: boolean; isSecret?: boolean; secretStore?: { name: string; kind: "secret" | "env"; allowedHosts?: string[]; reason?: string } }> };
}

export interface StoredExpertSnapshot { id: string; name: string; role: string; summary: string; version: string; capabilities: string[]; permissions: string[] }
export interface StoredTeamSnapshot { id: string; name: string; summary: string; version: string; capabilities: string[]; permissions: string[]; members: Array<{ id: string; name: string; role: string; responsibility: string }> }
export interface StoredSkillSnapshot { id: string; name: string; version: string; summary: string; source: string; license: string; capabilities: string[]; permissions: Array<"workspace.read" | "workspace.write" | "network.public" | "command.execute" | "external.send" | "workspace.outside">; instructionDigest: string }
export interface StoredConnectorSnapshot { id: string; name: string; version: string; summary: string; kind: "builtin" | "remote_mcp"; source: string; license: string; capabilities: string[]; permissions: Array<"workspace.read" | "workspace.write" | "network.public" | "external.read" | "external.send" | "external.delete" | "purchase">; configurationDigest: string }
export interface StoredKnowledgeReference { id: string; name: string; kind: "file" | "web" | "artifact"; contentDigest: string; selectedAt: string }

export interface StoredProjectSource { id: string; name: string; path: string; mimeType: string; size: number; createdAt: string }
export interface StoredProject { id: string; name: string; path: string; updatedAt: string; status?: "ready" | "needs_reauthorization"; sources?: StoredProjectSource[] }
export interface StoredWorkspaceSettings { defaultRootPath: string; status: "ready" | "needs_reauthorization" }
export type StoredArtifact = Artifact;
export interface StoredKnowledgeItem { id: string; artifactId: string; name: string; createdAt: string }
export type StoredExecutionEvent = RuntimeEvent;
export interface WorkspaceSnapshot { tasks: StoredTask[]; projects: StoredProject[]; workspaceSettings: StoredWorkspaceSettings; artifacts: StoredArtifact[]; knowledgeItems: StoredKnowledgeItem[]; executionEvents: StoredExecutionEvent[] }

function isTask(value: unknown): value is StoredTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<StoredTask>;
  if (task.connectorSnapshots !== undefined && (!Array.isArray(task.connectorSnapshots) || task.connectorSnapshots.length > 5 || !task.connectorSnapshots.every(connector => connectorSnapshotSchema.safeParse(connector).success))) return false;
  if (task.knowledgeReferences !== undefined && (!Array.isArray(task.knowledgeReferences) || task.knowledgeReferences.length > 5 || !task.knowledgeReferences.every(reference => knowledgeReferenceSnapshotSchema.safeParse(reference).success))) return false;
  return typeof task.id === "string" && typeof task.title === "string" && typeof task.prompt === "string" && (task.teamId === undefined || typeof task.teamId === "string") && (task.expertId === undefined || typeof task.expertId === "string") && !(task.teamId && task.expertId) && (task.expertSnapshot === undefined || (typeof task.expertSnapshot.id === "string" && task.expertSnapshot.id === task.expertId && Array.isArray(task.expertSnapshot.capabilities) && Array.isArray(task.expertSnapshot.permissions))) && (task.teamSnapshot === undefined || (typeof task.teamSnapshot.id === "string" && task.teamSnapshot.id === task.teamId && Array.isArray(task.teamSnapshot.members) && Array.isArray(task.teamSnapshot.permissions))) && (task.skillSnapshots === undefined || (Array.isArray(task.skillSnapshots) && task.skillSnapshots.length <= 5 && task.skillSnapshots.every(skill => skillSnapshotSchema.safeParse(skill).success))) && (task.workspacePath === undefined || typeof task.workspacePath === "string") && (task.modelMode === undefined || task.modelMode === "auto" || task.modelMode === "custom") && (task.permissionMode === undefined || ["restricted", "default", "full"].includes(task.permissionMode)) && (task.pendingPermission === undefined || (typeof task.pendingPermission.id === "string" && typeof task.pendingPermission.command === "string")) && (task.progressCard === undefined || progressCardSchema.safeParse(task.progressCard).success) && (task.pendingQuestion === undefined || pendingQuestionSchema.safeParse(task.pendingQuestion).success) && (task.channelOrigin === undefined || (["telegram", "feishu"].includes(task.channelOrigin.channel) && typeof task.channelOrigin.envelopeId === "string" && typeof task.channelOrigin.bindingId === "string" && typeof task.channelOrigin.conversationKey === "string")) && (task.attachments === undefined || (Array.isArray(task.attachments) && task.attachments.length <= 10 && task.attachments.every(path => typeof path === "string"))) && (task.artifactInputs === undefined || (Array.isArray(task.artifactInputs) && task.artifactInputs.length <= 10 && task.artifactInputs.every(id => typeof id === "string"))) && (task.turns === undefined || (Array.isArray(task.turns) && task.turns.length <= 200 && task.turns.every(turn => taskTurnSchema.safeParse(turn).success))) && ["queued", "running", "waiting", "waiting_user", "completed", "failed", "cancelled"].includes(task.status ?? "");
}

function isKnowledgeItem(value: unknown): value is StoredKnowledgeItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StoredKnowledgeItem>;
  return typeof item.id === "string" && typeof item.artifactId === "string" && typeof item.name === "string" && typeof item.createdAt === "string";
}

export class WorkspaceRepository {
  private readonly root: string;
  private readonly defaultWorkspacePath: string;
  private readonly dataFile: string;
  private readonly legacyDataFile: string;
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(appDataPath: string, documentsPath?: string) {
    this.root = join(appDataPath, "牛马办公");
    this.defaultWorkspacePath = documentsPath ? join(documentsPath, "牛马办公") : join(this.root, "Workspace");
    this.dataFile = join(this.root, "data", "workspace.json");
    this.legacyDataFile = join(appDataPath, "星伴办公", "data", "workspace.json");
  }

  async bootstrap(): Promise<WorkspaceSnapshot> {
    const workspacePath = this.defaultWorkspacePath;
    await mkdir(workspacePath, { recursive: true });
    await mkdir(join(this.root, "data"), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.dataFile, "utf8")) as WorkspaceSnapshot;
      const storedProjects = Array.isArray(parsed.projects) && parsed.projects.length
        ? parsed.projects.map(project => project.id === "default" && project.path === join(this.root, "Workspace") ? { ...project, path: workspacePath } : project)
        : this.defaultProjects(workspacePath);
      const projects = await Promise.all(storedProjects.map(async project => ({ ...project, status: await directoryStatus(project.path) })));
      const defaultProject = projects.find(project => project.id === "default") ?? projects[0]!;
      const workspaceSettings: StoredWorkspaceSettings = { defaultRootPath: defaultProject.path, status: defaultProject.status ?? "needs_reauthorization" };
      const executionEvents = Array.isArray(parsed.executionEvents) ? parsed.executionEvents.flatMap(event => { const result = runtimeEventSchema.safeParse(event); return result.success ? [result.data] : []; }) : [];
      const artifacts = Array.isArray(parsed.artifacts) ? parsed.artifacts.flatMap(artifact => { const result = artifactSchema.safeParse(artifact); return result.success ? [result.data] : []; }) : [];
      const knowledgeItems = Array.isArray(parsed.knowledgeItems) ? parsed.knowledgeItems.filter(isKnowledgeItem).filter(item => artifacts.some(artifact => artifact.id === item.artifactId)) : [];
      const snapshot = { tasks: Array.isArray(parsed.tasks) ? parsed.tasks.filter(isTask) : [], projects, workspaceSettings, artifacts, knowledgeItems, executionEvents };
      if (JSON.stringify(projects) !== JSON.stringify(parsed.projects)) await this.write(snapshot);
      return snapshot;
    } catch {
      const initial = await this.readLegacy(workspacePath);
      await this.write(initial);
      return initial;
    }
  }

  async saveTask(input: unknown): Promise<WorkspaceSnapshot> {
    if (!isTask(input)) throw new Error("任务数据格式无效");
    return this.storeTask(input);
  }

  async saveTaskWithEvent(input: unknown, type: ExecutionEventType, payload: Record<string, unknown> = {}, dedupeKey?: string): Promise<WorkspaceSnapshot> {
    if (!isTask(input)) throw new Error("任务数据格式无效");
    return this.storeTask(input, type, payload, dedupeKey);
  }

  async saveTaskWithArtifact(input: unknown, artifactInput: unknown): Promise<WorkspaceSnapshot> {
    if (!isTask(input)) throw new Error("任务数据格式无效");
    const parsed = artifactSchema.parse(artifactInput);
    if (parsed.taskId !== input.id) throw new Error("产物与任务不匹配");
    await this.assertPathInTaskWorkspace(input, parsed.path);
    const details = await stat(parsed.path);
    if (!details.isFile()) throw new Error("交付文件不存在");
    const artifact = { ...parsed, size: details.size };
    const operation = this.mutationQueue.then(async () => {
      const current = await this.bootstrap();
      const tasks = [input, ...current.tasks.filter(task => task.id !== input.id)];
      const artifacts = [artifact, ...current.artifacts.filter(item => item.id !== artifact.id)];
      const duplicate = current.executionEvents.some(event => event.taskId === input.id && event.type === "artifact.created" && event.payload.artifactId === artifact.id);
      let executionEvents = current.executionEvents;
      if (!duplicate) {
        const sequence = executionEvents.reduce((highest, event) => event.taskId === input.id ? Math.max(highest, event.sequence) : highest, -1) + 1;
        executionEvents = [...executionEvents, runtimeEventSchema.parse({ id: `${input.id}:${sequence}:artifact.created`, taskId: input.id, type: "artifact.created", sequence, createdAt: new Date().toISOString(), payload: { artifactId: artifact.id, name: artifact.name, mimeType: artifact.mimeType, size: artifact.size } })].slice(-5_000);
      }
      const next = { ...current, tasks, artifacts, executionEvents };
      await this.write(next);
      return next;
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  async getArtifact(artifactId: string): Promise<StoredArtifact> {
    const snapshot = await this.bootstrap();
    const artifact = snapshot.artifacts.find(item => item.id === artifactId);
    if (!artifact) throw new Error("未找到交付文件");
    const task = snapshot.tasks.find(item => item.id === artifact.taskId);
    if (!task) throw new Error("交付文件所属任务不存在");
    await this.assertPathInTaskWorkspace(task, artifact.path);
    const details = await stat(artifact.path).catch(() => undefined);
    if (!details?.isFile()) throw new Error("交付文件已被移动或删除");
    return { ...artifact, size: details.size };
  }

  async getArtifactPaths(artifactIds: string[]): Promise<string[]> {
    const unique = [...new Set(artifactIds)].slice(0, 10);
    return Promise.all(unique.map(async id => (await this.getArtifact(id)).path));
  }

  async addArtifactToKnowledge(artifactId: string): Promise<WorkspaceSnapshot> {
    const artifact = await this.getArtifact(artifactId);
    const operation = this.mutationQueue.then(async () => {
      const current = await this.bootstrap();
      if (current.knowledgeItems.some(item => item.artifactId === artifactId)) return current;
      const item: StoredKnowledgeItem = { id: `knowledge-${artifactId}`, artifactId, name: artifact.name, createdAt: new Date().toISOString() };
      const next = { ...current, knowledgeItems: [item, ...current.knowledgeItems] };
      await this.write(next);
      return next;
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  async clearLegacyKnowledgeItems(artifactIds: string[]): Promise<WorkspaceSnapshot> {
    const removeIds = new Set(artifactIds);
    if (!removeIds.size) return this.bootstrap();
    const operation = this.mutationQueue.then(async () => {
      const current = await this.bootstrap();
      const next = { ...current, knowledgeItems: current.knowledgeItems.filter(item => !removeIds.has(item.artifactId)) };
      await this.write(next);
      return next;
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  async getExecutionEvents(taskId: string): Promise<StoredExecutionEvent[]> {
    return (await this.bootstrap()).executionEvents.filter(event => event.taskId === taskId).sort((a, b) => a.sequence - b.sequence);
  }

  async recordDiagnostic(taskId: string, error: unknown): Promise<void> {
    const logDirectory = join(this.root, "logs");
    await mkdir(logDirectory, { recursive: true });
    const raw = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
    const safe = redactDiagnostic(raw).slice(0, 8_000).replace(/[\r\n]+/g, " ");
    await appendFile(join(logDirectory, "task-errors.log"), `${new Date().toISOString()} task=${taskId} ${safe}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async recoverInterruptedTasks(): Promise<WorkspaceSnapshot> {
    const current = await this.bootstrap();
    const interruptedTasks = current.tasks.filter(task => task.status === "running" || task.expertRuns?.some(run => run.status === "running"));
    if (!interruptedTasks.length) return current;
    let executionEvents = current.executionEvents;
    for (const task of interruptedTasks) {
      const sequence = executionEvents.reduce((highest, event) => event.taskId === task.id ? Math.max(highest, event.sequence) : highest, -1) + 1;
      executionEvents = [...executionEvents, { id: `${task.id}:${sequence}:task.failed`, taskId: task.id, type: "task.failed", sequence, createdAt: new Date().toISOString(), payload: { recovery: true } }];
    }
    const recovered = {
      ...current,
      executionEvents: executionEvents.slice(-5_000),
      tasks: current.tasks.map(task => interruptedTasks.some(interrupted => interrupted.id === task.id) ? recoverInterruptedTask(task) : task),
    };
    await this.write(recovered);
    return recovered;
  }

  getRoot() { return this.root; }

  async getProjectPath(projectId?: string): Promise<string> {
    const snapshot = await this.bootstrap();
    const project = snapshot.projects.find(item => item.id === (projectId || "default")) ?? snapshot.projects[0]!;
    if (project.status !== "ready") throw new Error("工作空间需要重新授权，请在设置中重新选择目录");
    return project.path;
  }

  async validateWorkspacePath(path: string) {
    if (await directoryStatus(path) !== "ready") throw new Error("工作空间需要重新授权，请在设置中重新选择目录");
    return path;
  }

  async getTask(taskId: string): Promise<StoredTask | undefined> {
    return (await this.bootstrap()).tasks.find(task => task.id === taskId);
  }

  async createProject(nameInput: unknown, selectedPath?: string): Promise<WorkspaceSnapshot> {
    if (typeof nameInput !== "string") throw new Error("项目名称无效");
    const name = nameInput.trim().slice(0, 40);
    if (!name) throw new Error("请输入项目名称");
    const operation = this.mutationQueue.then(async () => {
      const current = await this.bootstrap();
      if (current.projects.some(project => project.name === name)) throw new Error("已存在同名项目");
      const id = `project-${Date.now().toString(36)}`;
      const defaultRoot = current.projects.find(project => project.id === "default");
      if (!defaultRoot || defaultRoot.status !== "ready") throw new Error("默认工作空间需要重新授权");
      const path = selectedPath ?? join(defaultRoot.path, "项目", `${id}-${safeDirectoryName(name)}`);
      if (selectedPath) {
        if (await directoryStatus(path) !== "ready") throw new Error("所选文件夹当前不可访问");
      } else await mkdir(path, { recursive: true });
      const next = { ...current, projects: [...current.projects, { id, name, path, updatedAt: "刚刚", status: "ready" as const }] };
      await this.write(next);
      return next;
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  async addProjectFiles(projectId: string, paths: string[]): Promise<WorkspaceSnapshot> {
    const selectedPaths = [...new Set(paths)].slice(0, 20);
    if (!selectedPaths.length) return this.bootstrap();
    const operation = this.mutationQueue.then(async () => {
      const current = await this.bootstrap();
      const project = current.projects.find(item => item.id === projectId && item.id !== "default");
      if (!project) throw new Error("未找到项目");
      if (project.status !== "ready") throw new Error("项目目录需要重新授权");
      const sourceDirectory = join(project.path, "资料");
      await mkdir(sourceDirectory, { recursive: true });
      const createdAt = new Date().toISOString();
      const sources = await Promise.all(selectedPaths.map(async (sourcePath, index) => {
        const details = await stat(sourcePath);
        if (!details.isFile()) throw new Error("项目资料必须是文件");
        if (details.size > 100 * 1024 * 1024) throw new Error(`资料“${safeDirectoryName(basename(sourcePath) || "文件")}”超过 100 MB`);
        const id = `source-${Date.now().toString(36)}-${index + 1}`;
        const name = basename(sourcePath) || "项目资料";
        const targetPath = join(sourceDirectory, `${id}-${safeDirectoryName(name)}`);
        await copyFile(sourcePath, targetPath);
        return { id, name, path: targetPath, mimeType: mimeTypeForPath(targetPath), size: details.size, createdAt };
      }));
      const projects = current.projects.map(item => item.id === projectId ? { ...item, sources: [...(item.sources ?? []), ...sources], updatedAt: createdAt } : item);
      const next = { ...current, projects };
      await this.write(next);
      return next;
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  async getProjectSourcePaths(projectId?: string): Promise<string[]> {
    if (!projectId || projectId === "default") return [];
    const snapshot = await this.bootstrap();
    const project = snapshot.projects.find(item => item.id === projectId);
    if (!project) throw new Error("未找到项目");
    if (project.status !== "ready") throw new Error("项目目录需要重新授权");
    const workspacePath = await realpath(project.path);
    return Promise.all((project.sources ?? []).slice(0, 50).map(async source => {
      const filePath = await realpath(source.path).catch(() => undefined);
      if (!filePath) throw new Error(`项目资料“${source.name}”已被移动或删除`);
      const child = relative(workspacePath, filePath);
      if (child === "" || child.startsWith("..") || isAbsolute(child)) throw new Error("项目资料不在当前项目目录内");
      const details = await stat(filePath);
      if (!details.isFile()) throw new Error(`项目资料“${source.name}”不可用`);
      return filePath;
    }));
  }

  async setDefaultRoot(path: string): Promise<WorkspaceSnapshot> {
    if (await directoryStatus(path) !== "ready") throw new Error("所选文件夹当前不可访问或不可写");
    const operation = this.mutationQueue.then(async () => {
      const current = await this.bootstrap();
      const projects = current.projects.map(project => project.id === "default" ? { ...project, path, status: "ready" as const, updatedAt: "刚刚" } : project);
      const next = { ...current, projects, workspaceSettings: { defaultRootPath: path, status: "ready" as const } };
      await this.write(next);
      return next;
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  async reauthorizeProject(projectId: string, path: string): Promise<WorkspaceSnapshot> {
    if (await directoryStatus(path) !== "ready") throw new Error("所选文件夹当前不可访问或不可写");
    if (projectId === "default") return this.setDefaultRoot(path);
    const operation = this.mutationQueue.then(async () => {
      const current = await this.bootstrap();
      if (!current.projects.some(project => project.id === projectId)) throw new Error("未找到项目");
      const projects = current.projects.map(project => project.id === projectId ? { ...project, path, status: "ready" as const, updatedAt: "刚刚" } : project);
      const next = { ...current, projects };
      await this.write(next);
      return next;
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  private defaultProjects(workspacePath: string): StoredProject[] {
    return [{ id: "default", name: "默认工作空间", path: workspacePath, updatedAt: "刚刚", status: "ready" }];
  }

  private async readLegacy(workspacePath: string): Promise<WorkspaceSnapshot> {
    try {
      const parsed = JSON.parse(await readFile(this.legacyDataFile, "utf8")) as WorkspaceSnapshot;
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.filter(isTask) : [];
      const projects = Array.isArray(parsed.projects)
        ? parsed.projects.map(project => project.id === "default" ? { ...project, path: workspacePath } : project)
        : [];
      const executionEvents = Array.isArray(parsed.executionEvents) ? parsed.executionEvents.flatMap(event => { const result = runtimeEventSchema.safeParse(event); return result.success ? [result.data] : []; }) : [];
      const resolvedProjects = projects.length ? projects : this.defaultProjects(workspacePath);
      const defaultProject = resolvedProjects.find(project => project.id === "default") ?? resolvedProjects[0]!;
      return { tasks, projects: resolvedProjects, workspaceSettings: { defaultRootPath: defaultProject.path, status: defaultProject.status ?? "ready" }, artifacts: [], knowledgeItems: [], executionEvents };
    } catch {
      return { tasks: [], projects: this.defaultProjects(workspacePath), workspaceSettings: { defaultRootPath: workspacePath, status: "ready" }, artifacts: [], knowledgeItems: [], executionEvents: [] };
    }
  }

  private storeTask(input: StoredTask, type?: ExecutionEventType, payload: Record<string, unknown> = {}, dedupeKey?: string): Promise<WorkspaceSnapshot> {
    const operation = this.mutationQueue.then(async () => {
      const current = await this.bootstrap();
      const existing = current.tasks.findIndex(task => task.id === input.id);
      const tasks = [...current.tasks];
      if (existing >= 0) tasks[existing] = input; else tasks.unshift(input);
      let executionEvents = current.executionEvents;
      const duplicate = dedupeKey && executionEvents.some(event => event.taskId === input.id && event.payload.dedupeKey === dedupeKey);
      if (type && !duplicate) {
        const sequence = executionEvents.reduce((highest, event) => event.taskId === input.id ? Math.max(highest, event.sequence) : highest, -1) + 1;
        const event = runtimeEventSchema.parse({ id: `${input.id}:${sequence}:${type}`, taskId: input.id, type, sequence, createdAt: new Date().toISOString(), payload: dedupeKey ? { ...payload, dedupeKey } : payload });
        executionEvents = [...executionEvents, event].slice(-5_000);
      }
      const next = { ...current, tasks, executionEvents };
      await this.write(next);
      return next;
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  private async write(snapshot: WorkspaceSnapshot) {
    const temporary = `${this.dataFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.dataFile);
  }

  private async assertPathInTaskWorkspace(task: StoredTask, targetPath: string) {
    if (!isAbsolute(targetPath)) throw new Error("交付文件路径无效");
    const projectPath = task.workspacePath ? await this.validateWorkspacePath(task.workspacePath) : await this.getProjectPath(task.projectId);
    const [workspacePath, filePath] = await Promise.all([realpath(projectPath), realpath(targetPath)]);
    const child = relative(workspacePath, filePath);
    if (child === "" || child.startsWith("..") || isAbsolute(child)) throw new Error("交付文件不在当前工作空间内");
  }
}

function recoverInterruptedTask(task: StoredTask): StoredTask {
  const error = "上次执行因应用退出而中断，可以重新提交任务。";
  const expertRuns = task.expertRuns?.map(run => run.status === "running" ? { ...run, status: "failed" as const, error: "执行中断" } : run);
  const turns = task.turns?.map((turn, index, all) => index === all.length - 1 ? { ...turn, status: "failed" as const, error, expertRuns } : turn);
  return { ...task, status: "failed", error, expertRuns, turns };
}

function safeDirectoryName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "新项目";
}

function redactDiagnostic(value: string) {
  return value
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[REDACTED]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_ -]?key|token|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

export function mimeTypeForPath(path: string) {
  const extension = extname(path).toLowerCase();
  return ({ ".md": "text/markdown", ".txt": "text/plain", ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".html": "text/html", ".csv": "text/csv", ".json": "application/json" } as Record<string, string>)[extension] ?? "application/octet-stream";
}

async function directoryStatus(path: string): Promise<"ready" | "needs_reauthorization"> {
  try {
    const details = await stat(path);
    if (!details.isDirectory()) return "needs_reauthorization";
    await access(path, constants.R_OK | constants.W_OK);
    return "ready";
  } catch { return "needs_reauthorization"; }
}
