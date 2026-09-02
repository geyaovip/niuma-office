interface NiumaEnvironment {
  platform: string;
  version: string;
  appearance: "light" | "dark";
  documentsPath: string;
  appDataPath: string;
}

interface NiumaWorkspaceSnapshot {
  tasks: import("./types").TaskRecord[];
  projects: import("./types").ProjectRecord[];
  workspaceSettings: import("./types").WorkspaceSettingsRecord;
  artifacts: import("./types").ArtifactRecord[];
  knowledgeItems: import("./types").KnowledgeItemRecord[];
}

interface NiumaModelSettings {
  provider: "volcengine";
  baseUrl: string;
  modelId: string;
  displayName: string;
  hasApiKey: boolean;
}

interface NiumaRuntimeStatus {
  state: "stopped" | "starting" | "ready" | "unavailable" | "failed";
  message: string;
}

interface NiumaPreferences { appearance: "system" | "light" | "dark" }
interface NiumaDataInfo { path: string; size: number }
interface NiumaUpdateStatus { state: "current" | "available" | "failed" | "unavailable"; currentVersion: string; latestVersion?: string; message: string }

interface Window {
  niuma?: {
    getEnvironment(): Promise<NiumaEnvironment>;
    getPreferences(): Promise<NiumaPreferences>;
    saveAppearance(appearance: NiumaPreferences["appearance"]): Promise<NiumaPreferences>;
    getDataInfo(): Promise<NiumaDataInfo>;
    openDataDirectory(): Promise<void>;
    openDiagnostics(): Promise<void>;
    checkUpdate(): Promise<NiumaUpdateStatus>;
    openPath(path: string): Promise<string>;
    openExternal(url: string): Promise<void>;
    showItemInFolder(path: string): Promise<void>;
    pickFiles(): Promise<string[]>;
    workspaceBootstrap(): Promise<NiumaWorkspaceSnapshot>;
    createProject(name: string): Promise<NiumaWorkspaceSnapshot>;
    createProjectWithFolder(name: string): Promise<NiumaWorkspaceSnapshot | undefined>;
    chooseDefaultWorkspaceRoot(): Promise<NiumaWorkspaceSnapshot | undefined>;
    reauthorizeProject(projectId: string): Promise<NiumaWorkspaceSnapshot | undefined>;
    addProjectFiles(projectId: string): Promise<NiumaWorkspaceSnapshot | undefined>;
    listSkills(): Promise<import("./types").SkillCatalogItemRecord[]>;
    installSkill(skillId: string): Promise<import("./types").SkillCatalogItemRecord[]>;
    setSkillEnabled(skillId: string, enabled: boolean): Promise<import("./types").SkillCatalogItemRecord[]>;
    listConnectors(): Promise<import("./types").ConnectorCatalogItemRecord[]>;
    configureRemoteConnector(input: { displayName: string; endpoint: string; transport: "streamable-http" | "sse"; credential?: string; clearCredential?: boolean }): Promise<import("./types").ConnectorCatalogItemRecord[]>;
    testRemoteConnector(): Promise<import("./types").ConnectorCatalogItemRecord[]>;
    setConnectorEnabled(connectorId: string, enabled: boolean): Promise<import("./types").ConnectorCatalogItemRecord[]>;
    listKnowledgeSources(): Promise<import("./types").KnowledgeSourceRecord[]>;
    addKnowledgeFiles(): Promise<import("./types").KnowledgeSourceRecord[]>;
    addKnowledgeWeb(url: string): Promise<import("./types").KnowledgeSourceRecord[]>;
    retryKnowledgeSource(sourceId: string): Promise<import("./types").KnowledgeSourceRecord[]>;
    removeKnowledgeSource(sourceId: string): Promise<import("./types").KnowledgeSourceRecord[]>;
    searchKnowledge(query: string): Promise<import("./types").KnowledgeSearchResultRecord[]>;
    snapshotKnowledge(sourceIds: string[]): Promise<import("./types").KnowledgeReferenceRecord[]>;
    listAutomations(): Promise<import("./types").AutomationSnapshotRecord>;
    createAutomation(input: import("./types").CreateAutomationRecord): Promise<import("./types").AutomationSnapshotRecord>;
    setAutomationEnabled(id: string, enabled: boolean): Promise<import("./types").AutomationSnapshotRecord>;
    removeAutomation(id: string): Promise<import("./types").AutomationSnapshotRecord>;
    runAutomationNow(id: string): Promise<import("./types").AutomationSnapshotRecord>;
    retryAutomationRun(runId: string): Promise<import("./types").AutomationSnapshotRecord>;
    getChannelStatus(): Promise<import("./types").ChannelStatusRecord>;
    createTelegramPairing(): Promise<import("./types").TelegramPairingRecord>;
    getTelegramPairing(id: string): Promise<import("./types").PublicPairingSessionRecord>;
    cancelTelegramPairing(id: string): Promise<import("./types").PublicPairingSessionRecord>;
    revokeChannelBinding(id: string): Promise<import("./types").ChannelBindingRecord>;
    saveTask(task: import("./types").TaskRecord): Promise<NiumaWorkspaceSnapshot>;
    searchTasks(query: string): Promise<string[]>;
    runTask(task: import("./types").TaskRecord): Promise<import("./types").TaskRecord>;
    cancelTask(taskId: string): Promise<import("./types").TaskRecord>;
    resolvePermission(taskId: string, approvalId: string, decision: "allow_once" | "allow_task" | "deny"): Promise<import("./types").TaskRecord>;
    resolveQuestion(taskId: string, questionId: string, answers: Record<string, string[]>, rememberSecretQuestionIds?: string[]): Promise<import("./types").TaskRecord>;
    getTaskEvents(taskId: string): Promise<import("./types").RuntimeEventRecord[]>;
    previewArtifact(artifactId: string): Promise<import("./types").ArtifactPreview>;
    openArtifact(artifactId: string): Promise<void>;
    showArtifact(artifactId: string): Promise<void>;
    addArtifactToKnowledge(artifactId: string): Promise<import("./types").KnowledgeSourceRecord[]>;
    onTaskUpdated(callback: (task: import("./types").TaskRecord) => void): () => void;
    onAutomationUpdated(callback: (snapshot: import("./types").AutomationSnapshotRecord) => void): () => void;
    onRuntimeEvent(callback: (event: import("./types").RuntimeEventRecord) => void): () => void;
    onAppCommand(callback: (command: "new-task" | "search" | "toggle-sidebar" | "stop-task" | "open-settings") => void): () => void;
    getRuntimeStatus(): Promise<NiumaRuntimeStatus>;
    getModelSettings(): Promise<NiumaModelSettings>;
    saveModelSettings(settings: { baseUrl: string; modelId: string; displayName: string; apiKey?: string; clearApiKey?: boolean }): Promise<NiumaModelSettings>;
  };
}
