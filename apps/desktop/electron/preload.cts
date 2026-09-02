const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

contextBridge.exposeInMainWorld("niuma", {
  getEnvironment: () => ipcRenderer.invoke("app:get-environment"),
  getPreferences: () => ipcRenderer.invoke("preferences:get"),
  saveAppearance: (appearance: "system" | "light" | "dark") => ipcRenderer.invoke("preferences:save", appearance),
  getDataInfo: () => ipcRenderer.invoke("app:data-info"),
  openDataDirectory: () => ipcRenderer.invoke("app:open-data-directory"),
  openDiagnostics: () => ipcRenderer.invoke("app:open-diagnostics"),
  checkUpdate: () => ipcRenderer.invoke("app:check-update"),
  openPath: (targetPath: string) => ipcRenderer.invoke("shell:open-path", targetPath),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  showItemInFolder: (targetPath: string) => ipcRenderer.invoke("shell:show-item", targetPath),
  pickFiles: () => ipcRenderer.invoke("dialog:pick-files"),
  workspaceBootstrap: () => ipcRenderer.invoke("workspace:bootstrap"),
  createProject: (name: string) => ipcRenderer.invoke("project:create", name),
  createProjectWithFolder: (name: string) => ipcRenderer.invoke("project:create-with-folder", name),
  chooseDefaultWorkspaceRoot: () => ipcRenderer.invoke("workspace:choose-default-root"),
  reauthorizeProject: (projectId: string) => ipcRenderer.invoke("project:reauthorize", projectId),
  addProjectFiles: (projectId: string) => ipcRenderer.invoke("project:add-files", projectId),
  listSkills: () => ipcRenderer.invoke("skills:list"),
  installSkill: (skillId: string) => ipcRenderer.invoke("skills:install", skillId),
  setSkillEnabled: (skillId: string, enabled: boolean) => ipcRenderer.invoke("skills:set-enabled", skillId, enabled),
  listConnectors: () => ipcRenderer.invoke("connectors:list"),
  configureRemoteConnector: (input: unknown) => ipcRenderer.invoke("connectors:configure-remote", input),
  testRemoteConnector: () => ipcRenderer.invoke("connectors:test-remote"),
  setConnectorEnabled: (connectorId: string, enabled: boolean) => ipcRenderer.invoke("connectors:set-enabled", connectorId, enabled),
  listKnowledgeSources: () => ipcRenderer.invoke("knowledge:list"),
  addKnowledgeFiles: () => ipcRenderer.invoke("knowledge:add-files"),
  addKnowledgeWeb: (url: string) => ipcRenderer.invoke("knowledge:add-web", url),
  retryKnowledgeSource: (sourceId: string) => ipcRenderer.invoke("knowledge:retry", sourceId),
  removeKnowledgeSource: (sourceId: string) => ipcRenderer.invoke("knowledge:remove", sourceId),
  searchKnowledge: (query: string) => ipcRenderer.invoke("knowledge:search", query),
  snapshotKnowledge: (sourceIds: string[]) => ipcRenderer.invoke("knowledge:snapshot", sourceIds),
  listAutomations: () => ipcRenderer.invoke("automation:list"),
  createAutomation: (input: unknown) => ipcRenderer.invoke("automation:create", input),
  setAutomationEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke("automation:set-enabled", id, enabled),
  removeAutomation: (id: string) => ipcRenderer.invoke("automation:remove", id),
  runAutomationNow: (id: string) => ipcRenderer.invoke("automation:run-now", id),
  retryAutomationRun: (runId: string) => ipcRenderer.invoke("automation:retry-run", runId),
  getChannelStatus: () => ipcRenderer.invoke("channels:status"),
  createTelegramPairing: () => ipcRenderer.invoke("channels:telegram-pair"),
  getTelegramPairing: (id: string) => ipcRenderer.invoke("channels:telegram-pairing", id),
  cancelTelegramPairing: (id: string) => ipcRenderer.invoke("channels:telegram-cancel", id),
  revokeChannelBinding: (id: string) => ipcRenderer.invoke("channels:revoke", id),
  saveTask: (task: unknown) => ipcRenderer.invoke("task:save", task),
  searchTasks: (query: string) => ipcRenderer.invoke("task:search", query),
  runTask: (task: unknown) => ipcRenderer.invoke("task:run", task),
  cancelTask: (taskId: string) => ipcRenderer.invoke("task:cancel", taskId),
  resolvePermission: (taskId: string, approvalId: string, decision: "allow_once" | "allow_task" | "deny") => ipcRenderer.invoke("permission:resolve", taskId, approvalId, decision),
  resolveQuestion: (taskId: string, questionId: string, answers: Record<string, string[]>, rememberSecretQuestionIds: string[] = []) => ipcRenderer.invoke("question:resolve", taskId, questionId, answers, rememberSecretQuestionIds),
  getTaskEvents: (taskId: string) => ipcRenderer.invoke("task:events", taskId),
  previewArtifact: (artifactId: string) => ipcRenderer.invoke("artifact:preview", artifactId),
  openArtifact: (artifactId: string) => ipcRenderer.invoke("artifact:open", artifactId),
  showArtifact: (artifactId: string) => ipcRenderer.invoke("artifact:show", artifactId),
  addArtifactToKnowledge: (artifactId: string) => ipcRenderer.invoke("artifact:add-to-knowledge", artifactId),
  onTaskUpdated: (callback: (task: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, task: unknown) => callback(task);
    ipcRenderer.on("task:updated", listener);
    return () => ipcRenderer.removeListener("task:updated", listener);
  },
  onAutomationUpdated: (callback: (snapshot: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: unknown) => callback(snapshot);
    ipcRenderer.on("automation:updated", listener);
    return () => ipcRenderer.removeListener("automation:updated", listener);
  },
  onRuntimeEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, runtimeEvent: unknown) => callback(runtimeEvent);
    ipcRenderer.on("runtime:event", listener);
    return () => ipcRenderer.removeListener("runtime:event", listener);
  },
  onAppCommand: (callback: (command: "new-task" | "search" | "toggle-sidebar" | "stop-task" | "open-settings") => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: "new-task" | "search" | "toggle-sidebar" | "stop-task" | "open-settings") => callback(command);
    ipcRenderer.on("app:command", listener);
    return () => ipcRenderer.removeListener("app:command", listener);
  },
  getRuntimeStatus: () => ipcRenderer.invoke("runtime:status"),
  getModelSettings: () => ipcRenderer.invoke("model-settings:get"),
  saveModelSettings: (settings: unknown) => ipcRenderer.invoke("model-settings:save", settings),
});
