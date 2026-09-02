export type ViewKey = "new-task" | "projects" | "resources" | "automation" | "knowledge" | "task";

export type AutomationScheduleRecord =
  | { kind: "once"; onceAt: string }
  | { kind: "daily" | "weekdays"; timeOfDay: string }
  | { kind: "weekly"; timeOfDay: string; dayOfWeek: number }
  | { kind: "interval"; timeOfDay: string; intervalDays: number; startDate: string };
export interface AutomationRecord { id: string; name: string; prompt: string; status: "active" | "paused"; schedule: AutomationScheduleRecord; timeZone: string; assistantId?: string; projectId: string; permissionMode: PermissionMode; maxRetries: number; nextRunAt?: string; lastRunAt?: string; createdAt: string; updatedAt: string }
export interface AutomationRunRecord { id: string; automationId: string; scheduledFor: string; status: "queued" | "running" | "waiting_retry" | "completed" | "failed" | "cancelled"; attempt: number; taskId?: string; error?: string; nextAttemptAt?: string; createdAt: string; startedAt?: string; completedAt?: string }
export interface AutomationSnapshotRecord { automations: AutomationRecord[]; runs: AutomationRunRecord[] }
export interface CreateAutomationRecord { name: string; prompt: string; schedule: AutomationScheduleRecord; assistantId?: string; projectId?: string; permissionMode?: PermissionMode; maxRetries?: number }
export interface ChannelBindingRecord { id: string; channel: "telegram" | "feishu"; channelUserId: string; chatId: string; deviceInstallationId: string; scope: "direct" | "group"; status: "active" | "revoked" | "provider_removed"; createdAt: string; lastVerifiedAt: string; revokedAt?: string }
export interface ChannelStatusRecord { configured: boolean; bindings: ChannelBindingRecord[] }
export interface PublicPairingSessionRecord { id: string; channel: "telegram" | "feishu"; deviceInstallationId: string; status: "pending" | "scanned" | "confirmed" | "consumed" | "expired" | "cancelled" | "failed"; failureCount: number; createdAt: string; expiresAt: string; scannedAt?: string; confirmedAt?: string; consumedAt?: string; cancelledAt?: string }
export interface TelegramPairingRecord { session: PublicPairingSessionRecord; deepLink: string }

export type TaskStatus = "queued" | "running" | "waiting" | "waiting_user" | "completed" | "failed" | "cancelled";
export type PermissionMode = "restricted" | "default" | "full";
export interface PermissionRequestRecord { id: string; kind?: "exec" | "plugin"; command: string; cwd?: string; description?: string; severity?: "info" | "warning" | "critical"; expiresAt?: number }
export interface ProgressCardRecord { revision: number; markdown?: string; steps: Array<{ step: string; status: "pending" | "in_progress" | "completed" }> }
export interface PendingQuestionRecord { id: string; expiresAt: number; questions: Array<{ questionId: string; header: string; question: string; options: Array<{ label: string; description?: string }>; multiSelect?: boolean; isOther?: boolean; isSecret?: boolean; secretStore?: { name: string; kind: "secret" | "env"; allowedHosts?: string[]; reason?: string } }> }

export interface ExpertRunRecord {
  id: string;
  expertId: string;
  expertName: string;
  role: string;
  status: TaskStatus;
  output?: string;
  error?: string;
}

export interface ExpertSnapshotRecord { id: string; name: string; role: string; summary: string; version: string; capabilities: string[]; permissions: string[] }
export interface ExpertRecord extends ExpertSnapshotRecord { category: string; tags: string[]; instructions: string; accent: string }
export interface TeamMemberSnapshotRecord { id: string; name: string; role: string; responsibility: string }
export interface TeamSnapshotRecord { id: string; name: string; summary: string; version: string; capabilities: string[]; permissions: string[]; members: TeamMemberSnapshotRecord[] }
export type SkillPermission = "workspace.read" | "workspace.write" | "network.public" | "command.execute" | "external.send" | "workspace.outside";
export interface SkillSnapshotRecord { id: string; name: string; version: string; summary: string; source: string; license: string; capabilities: string[]; permissions: SkillPermission[]; instructionDigest: string }
export interface SkillDefinitionRecord extends SkillSnapshotRecord { category: string; dependencies: string[] }
export interface SkillInstallationRecord { skillId: string; version: string; status: "active" | "disabled" | "failed"; installedAt: string; updatedAt: string; previousVersion?: string; error?: string }
export interface SkillCatalogItemRecord { definition: SkillDefinitionRecord; installation?: SkillInstallationRecord }
export type ConnectorPermission = "workspace.read" | "workspace.write" | "network.public" | "external.read" | "external.send" | "external.delete" | "purchase";
export interface ConnectorSnapshotRecord { id: string; name: string; version: string; summary: string; kind: "builtin" | "remote_mcp"; source: string; license: string; capabilities: string[]; permissions: ConnectorPermission[]; configurationDigest: string }
export interface ConnectorDefinitionRecord extends ConnectorSnapshotRecord { category: string; configurable: boolean }
export interface ConnectorInstallationRecord { connectorId: string; version: string; status: "active" | "disabled" | "failed"; displayName: string; endpoint?: string; transport?: "streamable-http" | "sse"; hasCredential: boolean; updatedAt: string; lastTest?: { state: "success" | "failed"; testedAt: string; message: string } }
export interface ConnectorCatalogItemRecord { definition: ConnectorDefinitionRecord; installation: ConnectorInstallationRecord }
export type KnowledgeSourceKind = "file" | "web" | "artifact";
export type KnowledgeSourceStatus = "parsing" | "ready" | "failed";
export interface KnowledgeReferenceRecord { id: string; name: string; kind: KnowledgeSourceKind; contentDigest: string; selectedAt: string }
export interface KnowledgeSourceRecord { id: string; name: string; kind: KnowledgeSourceKind; origin: string; mimeType: string; size: number; status: KnowledgeSourceStatus; createdAt: string; updatedAt: string; contentDigest?: string; chunkCount: number; pageCount?: number; error?: string; artifactId?: string; artifactSource?: { artifactId: string; taskId: string; taskTitle: string; turnId?: string; producerType?: "assistant" | "expert" | "expert_team"; producerName?: string; producerVersion?: string } }
export interface KnowledgeSearchResultRecord { sourceId: string; sourceName: string; kind: KnowledgeSourceKind; origin: string; locator: string; excerpt: string; score: number }

export interface TaskTurnRecord {
  id: string;
  prompt: string;
  status: TaskStatus;
  createdAt: string;
  teamId?: string;
  teamSnapshot?: TeamSnapshotRecord;
  expertId?: string;
  expertSnapshot?: ExpertSnapshotRecord;
  skillSnapshots?: SkillSnapshotRecord[];
  connectorSnapshots?: ConnectorSnapshotRecord[];
  knowledgeReferences?: KnowledgeReferenceRecord[];
  projectId?: string;
  modelMode?: "auto" | "custom";
  permissionMode?: PermissionMode;
  attachments?: string[];
  artifactInputs?: string[];
  output?: string;
  error?: string;
  artifactPath?: string;
  completedAt?: string;
  expertRuns?: ExpertRunRecord[];
}

export interface TaskRecord {
  id: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  createdAt: string;
  teamId?: string;
  teamSnapshot?: TeamSnapshotRecord;
  expertId?: string;
  expertSnapshot?: ExpertSnapshotRecord;
  skillSnapshots?: SkillSnapshotRecord[];
  connectorSnapshots?: ConnectorSnapshotRecord[];
  knowledgeReferences?: KnowledgeReferenceRecord[];
  projectId?: string;
  workspacePath?: string;
  modelMode?: "auto" | "custom";
  permissionMode?: PermissionMode;
  attachments?: string[];
  artifactInputs?: string[];
  output?: string;
  error?: string;
  artifactPath?: string;
  completedAt?: string;
  expertRuns?: ExpertRunRecord[];
  turns?: TaskTurnRecord[];
  pendingPermission?: PermissionRequestRecord;
  progressCard?: ProgressCardRecord;
  pendingQuestion?: PendingQuestionRecord;
  channelOrigin?: { channel: "telegram" | "feishu"; envelopeId: string; bindingId: string; conversationKey: string };
}

export interface ArtifactRecord { id: string; taskId: string; turnId?: string; name: string; path: string; mimeType: string; sourceType?: "assistant" | "expert" | "expert_team"; sourceId?: string; sourceName?: string; sourceVersion?: string; size?: number; createdAt: string }
export interface KnowledgeItemRecord { id: string; artifactId: string; name: string; createdAt: string }
export type ArtifactPreview =
  | { kind: "text"; name: string; mimeType: string; content: string; size: number }
  | { kind: "image" | "pdf"; name: string; mimeType: string; dataUrl: string; size: number }
  | { kind: "unsupported"; name: string; mimeType: string; size: number };

export interface TeamRecord extends TeamSnapshotRecord {
  tags: string[];
  accent: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  updatedAt: string;
  status?: "ready" | "needs_reauthorization";
  sources?: ProjectSourceRecord[];
}

export interface ProjectSourceRecord { id: string; name: string; path: string; mimeType: string; size: number; createdAt: string }

export interface WorkspaceSettingsRecord { defaultRootPath: string; status: "ready" | "needs_reauthorization" }

export interface RuntimeEventRecord {
  id: string;
  taskId: string;
  type: "task.queued" | "task.running" | "task.waiting" | "task.waiting_user" | "task.progress" | "task.completed" | "task.failed" | "task.cancelled" | "expert_run.started" | "expert_run.completed" | "expert_run.failed" | "tool.started" | "tool.completed" | "tool.failed" | "artifact.created" | "permission.requested" | "permission.resolved" | "question.requested" | "question.resolved";
  sequence: number;
  createdAt: string;
  payload: Record<string, unknown>;
}
