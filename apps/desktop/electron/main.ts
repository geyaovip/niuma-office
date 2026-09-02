import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, powerMonitor, safeStorage, shell, type MenuItemConstructorOptions } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendFileSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { WorkspaceRepository } from "./services/workspace-repository.js";
import { ModelSettingsRepository } from "./services/model-settings-repository.js";
import { OpenClawSupervisor } from "./services/openclaw-supervisor.js";
import { TaskExecutor } from "./services/task-executor.js";
import { ArtifactService } from "./services/artifact-service.js";
import { PreferencesRepository, type AppearancePreference } from "./services/preferences-repository.js";
import { SkillRepository } from "./services/skill-repository.js";
import { ConnectorRepository } from "./services/connector-repository.js";
import { KnowledgeRepository } from "./services/knowledge-repository.js";
import { AutomationRepository } from "./services/automation-repository.js";
import { AutomationService } from "./services/automation-service.js";
import { DeviceIdentityRepository } from "./services/device-identity-repository.js";
import { ChannelClient } from "./services/channel-client.js";
import { ChannelDeliveryService } from "./services/channel-delivery-service.js";
import { CredentialRepository } from "./services/credential-repository.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const developmentUrl = process.env.VITE_DEV_SERVER_URL;
app.setName("牛马办公");

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    title: "牛马办公",
    backgroundColor: "#ffffff",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 16 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(currentDirectory, "preload.cjs"),
    },
  });

  window.once("ready-to-show", () => window.show());

  if (developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(join(currentDirectory, "../client/index.html"));
  }

  return window;
}

type AppCommand = "new-task" | "search" | "toggle-sidebar" | "stop-task" | "open-settings";

function installApplicationMenu(window: BrowserWindow) {
  const send = (command: AppCommand) => window.webContents.send("app:command", command);
  const template: MenuItemConstructorOptions[] = [
    {
      label: "牛马办公",
      submenu: [
        { role: "about", label: "关于牛马办公" },
        { type: "separator" },
        { label: "设置…", accelerator: "CommandOrControl+,", click: () => send("open-settings") },
        { type: "separator" },
        { role: "services", label: "服务" },
        { type: "separator" },
        { role: "hide", label: "隐藏牛马办公" },
        { role: "hideOthers", label: "隐藏其他" },
        { role: "unhide", label: "全部显示" },
        { type: "separator" },
        { role: "quit", label: "退出牛马办公" },
      ],
    },
    {
      label: "文件",
      submenu: [
        { label: "新建任务", accelerator: "CommandOrControl+N", click: () => send("new-task") },
        { type: "separator" },
        { role: "close", label: "关闭窗口" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "显示",
      submenu: [
        { label: "搜索任务", accelerator: "CommandOrControl+K", click: () => send("search") },
        { label: "显示或隐藏侧栏", accelerator: "CommandOrControl+Control+S", click: () => send("toggle-sidebar") },
        { type: "separator" },
        { role: "togglefullscreen", label: "进入全屏幕" },
      ],
    },
    {
      label: "任务",
      submenu: [
        { label: "停止当前任务", accelerator: "CommandOrControl+.", click: () => send("stop-task") },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "zoom", label: "缩放" },
        { type: "separator" },
        { role: "front", label: "前置全部窗口" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  const diagnosticsFile = join(app.getPath("temp"), "niuma-desktop-main.log");
  const recordDiagnostic = (message: string) => appendFileSync(diagnosticsFile, `${new Date().toISOString()} ${message}\n`);
  const appDataPath = app.getPath("appData");
  recordDiagnostic(`ready appData=${appDataPath}`);
  const workspace = new WorkspaceRepository(appDataPath, app.getPath("documents"));
  const modelSettings = new ModelSettingsRepository(appDataPath);
  const preferences = new PreferencesRepository(workspace.getRoot());
  const skills = new SkillRepository(workspace.getRoot());
  const connectors = new ConnectorRepository(workspace.getRoot(), { available: () => safeStorage.isEncryptionAvailable(), encrypt: value => safeStorage.encryptString(value).toString("base64"), decrypt: value => safeStorage.decryptString(Buffer.from(value, "base64")) });
  const credentials = new CredentialRepository(workspace.getRoot(), { available: () => safeStorage.isEncryptionAvailable(), encrypt: value => safeStorage.encryptString(value).toString("base64"), decrypt: value => safeStorage.decryptString(Buffer.from(value, "base64")) });
  const deviceIdentity = new DeviceIdentityRepository(workspace.getRoot(), { available: () => safeStorage.isEncryptionAvailable(), encrypt: value => safeStorage.encryptString(value).toString("base64"), decrypt: value => safeStorage.decryptString(Buffer.from(value, "base64")) });
  deviceIdentity.getPublicIdentity();
  const knowledge = new KnowledgeRepository(workspace.getRoot());
  const runtimeRoot = app.isPackaged ? join(process.resourcesPath, "runtime") : join(app.getAppPath(), "runtime");
  const runtime = new OpenClawSupervisor(workspace.getRoot(), runtimeRoot);
  const channelClient = new ChannelClient(process.env.NIUMA_API_URL?.trim(), deviceIdentity);
  const taskExecutor = new TaskExecutor(workspace, modelSettings, runtime, undefined, undefined, skills, connectors, knowledge, credentials, channelClient);
  const broadcast = (channel: string, payload: unknown) => BrowserWindow.getAllWindows().forEach(window => window.webContents.send(channel, payload));
  const channelDelivery = new ChannelDeliveryService(channelClient, workspace, taskExecutor, task => broadcast("task:updated", task), event => broadcast("runtime:event", event));
  const automationRepository = new AutomationRepository(workspace.getRoot());
  const automation = new AutomationService(automationRepository, workspace, taskExecutor, snapshot => broadcast("automation:updated", snapshot), task => broadcast("task:updated", task), event => broadcast("runtime:event", event));
  const artifacts = new ArtifactService(workspace);
  void preferences.get().then(value => { nativeTheme.themeSource = value.appearance; });
  void workspace.recoverInterruptedTasks()
    .then(async () => {
      const snapshot = await workspace.bootstrap();
      const migrated: string[] = [];
      for (const item of snapshot.knowledgeItems) {
        try {
          const artifact = await workspace.getArtifact(item.artifactId);
          const task = await workspace.getTask(artifact.taskId);
          if (!task) continue;
          await knowledge.addArtifact({ ...artifact, taskTitle: task.title });
          migrated.push(item.artifactId);
        } catch (error) { recordDiagnostic(`legacy knowledge migration skipped ${item.artifactId} ${String(error)}`); }
      }
      await workspace.clearLegacyKnowledgeItems(migrated);
      recordDiagnostic("workspace bootstrap complete");
    })
    .catch(error => recordDiagnostic(`workspace bootstrap failed ${String(error)}`));
  ipcMain.handle("app:get-environment", () => ({
    platform: process.platform,
    version: app.getVersion(),
    appearance: nativeTheme.shouldUseDarkColors ? "dark" : "light",
    documentsPath: app.getPath("documents"),
    appDataPath: workspace.getRoot(),
  }));

  ipcMain.handle("preferences:get", () => preferences.get());
  ipcMain.handle("preferences:save", async (_event, appearance: AppearancePreference) => {
    const saved = await preferences.save({ appearance });
    nativeTheme.themeSource = saved.appearance;
    return saved;
  });
  ipcMain.handle("app:data-info", async () => ({ path: workspace.getRoot(), size: await directorySize(workspace.getRoot()) }));
  ipcMain.handle("app:open-data-directory", async () => {
    const message = await shell.openPath(workspace.getRoot());
    if (message) throw new Error("无法打开本地数据目录，请检查访达权限后重试");
  });
  ipcMain.handle("app:open-diagnostics", async () => {
    const diagnosticsPath = join(workspace.getRoot(), "logs");
    await mkdir(diagnosticsPath, { recursive: true });
    const message = await shell.openPath(diagnosticsPath);
    if (message) throw new Error("无法打开诊断记录目录，请检查访达权限后重试");
  });
  ipcMain.handle("app:check-update", async () => {
    const manifestUrl = process.env.NIUMA_UPDATE_MANIFEST_URL?.trim();
    if (!manifestUrl) return { state: "unavailable", currentVersion: app.getVersion(), message: "当前内部体验版尚未配置更新服务。" };
    try {
      const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json() as { version?: string };
      if (!manifest.version || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.version)) throw new Error("invalid manifest");
      const available = compareVersions(manifest.version, app.getVersion()) > 0;
      return { state: available ? "available" : "current", currentVersion: app.getVersion(), latestVersion: manifest.version, message: available ? `发现新版本 ${manifest.version}` : "当前已是最新版本。" };
    } catch { return { state: "failed", currentVersion: app.getVersion(), message: "暂时无法检查更新，请稍后重试。" }; }
  });

  ipcMain.handle("shell:open-path", async (_event, path: string) => shell.openPath(path));
  ipcMain.handle("shell:open-external", async (_event, rawUrl: string) => { const url = new URL(rawUrl); if (url.protocol !== "https:") throw new Error("只能打开安全链接"); await shell.openExternal(url.toString()); });
  ipcMain.handle("shell:show-item", (_event, path: string) => shell.showItemInFolder(path));
  ipcMain.handle("dialog:pick-files", async () => {
    const result = await dialog.showOpenDialog({ title: "选择要加入任务的文件", properties: ["openFile", "multiSelections"] });
    return result.canceled ? [] : result.filePaths.slice(0, 10);
  });
  ipcMain.handle("workspace:bootstrap", () => workspace.bootstrap());
  ipcMain.handle("project:create", (_event, name: string) => workspace.createProject(name));
  ipcMain.handle("project:create-with-folder", async (_event, name: string) => {
    const result = await dialog.showOpenDialog({ title: "选择项目文件夹", buttonLabel: "使用此文件夹", properties: ["openDirectory", "createDirectory"], securityScopedBookmarks: true });
    if (result.canceled || !result.filePaths[0]) return undefined;
    return workspace.createProject(name, result.filePaths[0]);
  });
  ipcMain.handle("workspace:choose-default-root", async () => {
    const result = await dialog.showOpenDialog({ title: "选择牛马办公默认工作空间", buttonLabel: "设为默认目录", properties: ["openDirectory", "createDirectory"], securityScopedBookmarks: true });
    if (result.canceled || !result.filePaths[0]) return undefined;
    return workspace.setDefaultRoot(result.filePaths[0]);
  });
  ipcMain.handle("project:reauthorize", async (_event, projectId: string) => {
    const result = await dialog.showOpenDialog({ title: "重新选择工作空间目录", buttonLabel: "重新授权", properties: ["openDirectory"], securityScopedBookmarks: true });
    if (result.canceled || !result.filePaths[0]) return undefined;
    return workspace.reauthorizeProject(projectId, result.filePaths[0]);
  });
  ipcMain.handle("project:add-files", async (_event, projectId: string) => {
    const result = await dialog.showOpenDialog({ title: "选择要加入项目的资料", buttonLabel: "加入项目", properties: ["openFile", "multiSelections"] });
    if (result.canceled || !result.filePaths.length) return undefined;
    return workspace.addProjectFiles(projectId, result.filePaths);
  });
  ipcMain.handle("skills:list", () => skills.list());
  ipcMain.handle("skills:install", (_event, skillId: string) => skills.install(skillId));
  ipcMain.handle("skills:set-enabled", (_event, skillId: string, enabled: boolean) => skills.setEnabled(skillId, enabled));
  ipcMain.handle("connectors:list", () => connectors.list());
  ipcMain.handle("connectors:configure-remote", (_event, input: unknown) => connectors.configureRemote(input));
  ipcMain.handle("connectors:test-remote", () => connectors.testRemote());
  ipcMain.handle("connectors:set-enabled", (_event, connectorId: string, enabled: boolean) => connectors.setEnabled(connectorId, enabled));
  ipcMain.handle("knowledge:list", () => knowledge.list());
  ipcMain.handle("knowledge:add-files", async () => {
    const result = await dialog.showOpenDialog({ title: "选择要加入资料库的文件", buttonLabel: "加入资料库", properties: ["openFile", "multiSelections"], filters: [{ name: "支持的资料", extensions: ["pdf", "docx", "md", "markdown", "txt"] }] });
    return result.canceled ? knowledge.list() : knowledge.addFiles(result.filePaths);
  });
  ipcMain.handle("knowledge:add-web", (_event, url: string) => knowledge.addWeb(url));
  ipcMain.handle("knowledge:retry", (_event, sourceId: string) => knowledge.retry(sourceId));
  ipcMain.handle("knowledge:remove", (_event, sourceId: string) => knowledge.remove(sourceId));
  ipcMain.handle("knowledge:search", (_event, query: string) => knowledge.search(query));
  ipcMain.handle("knowledge:snapshot", (_event, sourceIds: string[]) => knowledge.snapshot(sourceIds));
  ipcMain.handle("automation:list", () => automation.list());
  ipcMain.handle("automation:create", (_event, input: unknown) => automation.create(input as never));
  ipcMain.handle("automation:set-enabled", (_event, id: string, enabled: boolean) => automation.setEnabled(id, enabled));
  ipcMain.handle("automation:remove", (_event, id: string) => automation.remove(id));
  ipcMain.handle("automation:run-now", (_event, id: string) => automation.runNow(id));
  ipcMain.handle("automation:retry-run", (_event, runId: string) => automation.retryRun(runId));
  ipcMain.handle("channels:status", async () => ({ configured: channelClient.configured, bindings: channelClient.configured ? await channelClient.listBindings() : [] }));
  ipcMain.handle("channels:telegram-pair", () => channelClient.createTelegramPairing());
  ipcMain.handle("channels:telegram-pairing", (_event, id: string) => channelClient.getTelegramPairing(id));
  ipcMain.handle("channels:telegram-cancel", (_event, id: string) => channelClient.cancelTelegramPairing(id));
  ipcMain.handle("channels:revoke", (_event, id: string) => channelClient.revokeBinding(id));
  ipcMain.handle("task:save", (_event, task: unknown) => workspace.saveTask(task));
  ipcMain.handle("task:search", async (_event, query: string) => {
    const snapshot = await workspace.bootstrap();
    try {
      return await taskExecutor.searchSessions(query, snapshot.tasks);
    } catch {
      // The renderer always keeps a local title/prompt fallback. A stopped or
      // unavailable runtime must not turn task search into an error state.
      return [];
    }
  });
  ipcMain.handle("task:run", (event, task: unknown) => taskExecutor.run(task as never, updated => { event.sender.send("task:updated", updated); void channelDelivery.notifyTask(updated); }, runtimeEvent => event.sender.send("runtime:event", runtimeEvent)));
  ipcMain.handle("task:cancel", (event, taskId: string) => taskExecutor.cancel(taskId, updated => event.sender.send("task:updated", updated), runtimeEvent => event.sender.send("runtime:event", runtimeEvent)));
  ipcMain.handle("permission:resolve", (event, taskId: string, approvalId: string, decision: "allow_once" | "allow_task" | "deny") => taskExecutor.resolvePermission(taskId, approvalId, decision, updated => { event.sender.send("task:updated", updated); void channelDelivery.notifyTask(updated); }, runtimeEvent => event.sender.send("runtime:event", runtimeEvent)));
  ipcMain.handle("question:resolve", (event, taskId: string, questionId: string, answers: Record<string, string[]>, rememberSecretQuestionIds: string[]) => taskExecutor.resolveQuestion(taskId, questionId, answers, rememberSecretQuestionIds, updated => { event.sender.send("task:updated", updated); void channelDelivery.notifyTask(updated); }, runtimeEvent => event.sender.send("runtime:event", runtimeEvent)));
  ipcMain.handle("task:events", (_event, taskId: string) => workspace.getExecutionEvents(taskId));
  ipcMain.handle("artifact:preview", (_event, artifactId: string) => artifacts.preview(artifactId));
  ipcMain.handle("artifact:open", async (_event, artifactId: string) => {
    const message = await shell.openPath(await artifacts.path(artifactId));
    if (message) throw new Error("无法打开交付文件，请在访达中定位后重试");
  });
  ipcMain.handle("artifact:show", async (_event, artifactId: string) => shell.showItemInFolder(await artifacts.path(artifactId)));
  ipcMain.handle("artifact:add-to-knowledge", async (_event, artifactId: string) => {
    const artifact = await workspace.getArtifact(artifactId);
    const task = await workspace.getTask(artifact.taskId);
    if (!task) throw new Error("交付文件所属任务不存在");
    return knowledge.addArtifact({ ...artifact, taskTitle: task.title });
  });
  ipcMain.handle("runtime:status", () => runtime.getStatus());
  ipcMain.handle("model-settings:get", () => modelSettings.getPublic());
  ipcMain.handle("model-settings:save", (_event, settings: unknown) => modelSettings.save(settings));

  const mainWindow = createMainWindow();
  installApplicationMenu(mainWindow);
  automation.start();
  channelDelivery.start();
  powerMonitor.on("resume", () => void automation.tick());
  app.once("before-quit", () => { automation.stop(); channelDelivery.stop(); automationRepository.close(); knowledge.close(); void runtime.stop(); });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

async function directorySize(path: string): Promise<number> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const target = join(path, entry.name);
      total += entry.isDirectory() ? await directorySize(target) : entry.isFile() ? (await stat(target)).size : 0;
    }
    return total;
  } catch { return 0; }
}

function compareVersions(left: string, right: string) {
  const parts = (value: string) => value.split(/[.-]/).slice(0, 3).map(item => Number.parseInt(item, 10) || 0);
  const a = parts(left); const b = parts(right);
  for (let index = 0; index < 3; index += 1) { if (a[index] !== b[index]) return a[index]! - b[index]!; }
  return 0;
}
