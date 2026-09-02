import { z } from "zod";

export const taskStatusSchema = z.enum(["queued", "running", "waiting", "waiting_user", "completed", "failed", "cancelled"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const artifactSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  turnId: z.string().min(1).optional(),
  name: z.string().min(1),
  path: z.string().min(1),
  mimeType: z.string().min(1),
  sourceType: z.enum(["assistant", "expert", "expert_team"]).optional(),
  sourceId: z.string().min(1).optional(),
  sourceName: z.string().min(1).optional(),
  sourceVersion: z.string().min(1).optional(),
  size: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime(),
});
export type Artifact = z.infer<typeof artifactSchema>;

export const expertRunSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  expertId: z.string().min(1),
  expertName: z.string().min(1),
  role: z.string().min(1),
  status: taskStatusSchema,
  output: z.string().optional(),
  error: z.string().optional(),
});
export type ExpertRun = z.infer<typeof expertRunSchema>;

export const embeddedExpertRunSchema = expertRunSchema.omit({ taskId: true });

export const expertSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  summary: z.string().min(1),
  version: z.string().min(1),
  capabilities: z.array(z.string().min(1)).max(20),
  permissions: z.array(z.string().min(1)).max(20),
});
export type ExpertSnapshot = z.infer<typeof expertSnapshotSchema>;

export const teamMemberSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  responsibility: z.string().min(1),
});

export const teamSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  version: z.string().min(1),
  capabilities: z.array(z.string().min(1)).max(20),
  permissions: z.array(z.string().min(1)).max(20),
  members: z.array(teamMemberSnapshotSchema).min(2).max(20),
});
export type TeamSnapshot = z.infer<typeof teamSnapshotSchema>;

export const skillPermissionSchema = z.enum(["workspace.read", "workspace.write", "network.public", "command.execute", "external.send", "workspace.outside"]);
export const skillSnapshotSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  summary: z.string().min(1),
  source: z.string().min(1),
  license: z.string().min(1),
  capabilities: z.array(z.string().min(1)).min(1).max(20),
  permissions: z.array(skillPermissionSchema).max(20),
  instructionDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SkillSnapshot = z.infer<typeof skillSnapshotSchema>;

export const connectorPermissionSchema = z.enum(["workspace.read", "workspace.write", "network.public", "external.read", "external.send", "external.delete", "purchase"]);
export const connectorSnapshotSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/), name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/), summary: z.string().min(1),
  kind: z.enum(["builtin", "remote_mcp"]), source: z.string().min(1), license: z.string().min(1),
  capabilities: z.array(z.string().min(1)).min(1).max(20), permissions: z.array(connectorPermissionSchema).max(20),
  configurationDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ConnectorSnapshot = z.infer<typeof connectorSnapshotSchema>;

export const knowledgeReferenceSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["file", "web", "artifact"]),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  selectedAt: z.string().datetime(),
});
export type KnowledgeReferenceSnapshot = z.infer<typeof knowledgeReferenceSnapshotSchema>;

export const taskTurnSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  status: taskStatusSchema,
  createdAt: z.string().datetime(),
  teamId: z.string().min(1).optional(),
  teamSnapshot: teamSnapshotSchema.optional(),
  expertId: z.string().min(1).optional(),
  expertSnapshot: expertSnapshotSchema.optional(),
  skillSnapshots: z.array(skillSnapshotSchema).max(5).optional(),
  connectorSnapshots: z.array(connectorSnapshotSchema).max(5).optional(),
  knowledgeReferences: z.array(knowledgeReferenceSnapshotSchema).max(5).optional(),
  projectId: z.string().optional(),
  modelMode: z.enum(["auto", "custom"]).optional(),
  permissionMode: z.enum(["restricted", "default", "full"]).optional(),
  attachments: z.array(z.string()).max(10).optional(),
  artifactInputs: z.array(z.string()).max(10).optional(),
  output: z.string().optional(),
  error: z.string().optional(),
  artifactPath: z.string().optional(),
  completedAt: z.string().datetime().optional(),
  expertRuns: z.array(embeddedExpertRunSchema).optional(),
});
export type TaskTurn = z.infer<typeof taskTurnSchema>;

export const progressCardSchema = z.object({
  revision: z.number().int().positive(),
  markdown: z.string().optional(),
  steps: z.array(z.object({ step: z.string().min(1), status: z.enum(["pending", "in_progress", "completed"]) })).max(50),
});

export const pendingQuestionSchema = z.object({
  id: z.string().min(1),
  expiresAt: z.number().int().nonnegative(),
  questions: z.array(z.object({
    questionId: z.string().regex(/^[a-z][a-z0-9_]*$/), header: z.string().max(12), question: z.string().min(1),
    options: z.array(z.object({ label: z.string().min(1), description: z.string().optional() })).max(4),
    multiSelect: z.boolean().optional(), isOther: z.boolean().optional(), isSecret: z.boolean().optional(),
    secretStore: z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/), kind: z.enum(["secret", "env"]), allowedHosts: z.array(z.string()).max(128).optional(), reason: z.string().max(200).optional() }).optional(),
  })).min(1).max(3),
});

export const taskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  status: taskStatusSchema,
  createdAt: z.string().min(1),
  teamId: z.string().min(1).optional(),
  teamSnapshot: teamSnapshotSchema.optional(),
  expertId: z.string().min(1).optional(),
  expertSnapshot: expertSnapshotSchema.optional(),
  skillSnapshots: z.array(skillSnapshotSchema).max(5).optional(),
  connectorSnapshots: z.array(connectorSnapshotSchema).max(5).optional(),
  knowledgeReferences: z.array(knowledgeReferenceSnapshotSchema).max(5).optional(),
  projectId: z.string().optional(),
  workspacePath: z.string().optional(),
  modelMode: z.enum(["auto", "custom"]).optional(),
  permissionMode: z.enum(["restricted", "default", "full"]).optional(),
  attachments: z.array(z.string()).max(10).optional(),
  artifactInputs: z.array(z.string()).max(10).optional(),
  output: z.string().optional(),
  error: z.string().optional(),
  artifactPath: z.string().optional(),
  completedAt: z.string().optional(),
  expertRuns: z.array(embeddedExpertRunSchema).optional(),
  turns: z.array(taskTurnSchema).max(200).optional(),
  channelOrigin: z.object({ channel: z.enum(["telegram", "feishu"]), envelopeId: z.string().uuid(), bindingId: z.string().uuid(), conversationKey: z.string().min(1).max(300) }).optional(),
  progressCard: progressCardSchema.optional(),
  pendingQuestion: pendingQuestionSchema.optional(),
});
export type Task = z.infer<typeof taskSchema>;

export const projectSourceSchema = z.object({ id: z.string().min(1), name: z.string().min(1), path: z.string().min(1), mimeType: z.string().min(1), size: z.number().int().nonnegative(), createdAt: z.string().datetime() });
export type ProjectSource = z.infer<typeof projectSourceSchema>;

export const projectSchema = z.object({ id: z.string().min(1), name: z.string().min(1), path: z.string().min(1), updatedAt: z.string().min(1), sources: z.array(projectSourceSchema).max(500).optional() });
export type Project = z.infer<typeof projectSchema>;

export const runtimeEventSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  type: z.enum(["task.queued", "task.running", "task.waiting", "task.waiting_user", "task.progress", "task.completed", "task.failed", "task.cancelled", "expert_run.started", "expert_run.completed", "expert_run.failed", "tool.started", "tool.completed", "tool.failed", "artifact.created", "permission.requested", "permission.resolved", "question.requested", "question.resolved"]),
  sequence: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});
export type RuntimeEvent = z.infer<typeof runtimeEventSchema>;

export const automationScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once"), onceAt: z.string().datetime() }),
  z.object({ kind: z.literal("daily"), timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
  z.object({ kind: z.literal("weekdays"), timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
  z.object({ kind: z.literal("weekly"), timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), dayOfWeek: z.number().int().min(0).max(6) }),
  z.object({ kind: z.literal("interval"), timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), intervalDays: z.number().int().min(2).max(90), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
]);
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;

export const automationStatusSchema = z.enum(["active", "paused"]);
export const automationRunStatusSchema = z.enum(["queued", "running", "waiting_retry", "completed", "failed", "cancelled"]);
export const automationSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(80), prompt: z.string().min(1).max(20_000), status: automationStatusSchema,
  schedule: automationScheduleSchema, timeZone: z.string().min(1), assistantId: z.string().max(80).optional(), projectId: z.string().min(1),
  permissionMode: z.enum(["restricted", "default", "full"]), maxRetries: z.number().int().min(0).max(2),
  nextRunAt: z.string().datetime().optional(), lastRunAt: z.string().datetime().optional(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type Automation = z.infer<typeof automationSchema>;

export const automationRunSchema = z.object({
  id: z.string().min(1), automationId: z.string().min(1), scheduledFor: z.string().datetime(), status: automationRunStatusSchema,
  attempt: z.number().int().min(1).max(10), taskId: z.string().min(1).optional(), error: z.string().max(300).optional(), nextAttemptAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(), startedAt: z.string().datetime().optional(), completedAt: z.string().datetime().optional(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

export const channelSchema = z.enum(["telegram", "feishu"]);
export type Channel = z.infer<typeof channelSchema>;
export const channelScopeSchema = z.enum(["direct", "group"]);
export const pairingStatusSchema = z.enum(["pending", "scanned", "confirmed", "consumed", "expired", "cancelled", "failed"]);
export const pairingSessionSchema = z.object({
  id: z.string().uuid(), channel: channelSchema, deviceInstallationId: z.string().uuid(), tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: pairingStatusSchema, failureCount: z.number().int().min(0).max(10), createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
  scannedAt: z.string().datetime().optional(), confirmedAt: z.string().datetime().optional(), consumedAt: z.string().datetime().optional(), cancelledAt: z.string().datetime().optional(),
});
export type PairingSession = z.infer<typeof pairingSessionSchema>;
export const channelBindingSchema = z.object({
  id: z.string().uuid(), channel: channelSchema, channelUserId: z.string().min(1).max(200), chatId: z.string().min(1).max(200),
  accountId: z.string().uuid().optional(), deviceInstallationId: z.string().uuid(), scope: channelScopeSchema, status: z.enum(["active", "revoked", "provider_removed"]),
  createdAt: z.string().datetime(), lastVerifiedAt: z.string().datetime(), revokedAt: z.string().datetime().optional(),
});
export type ChannelBinding = z.infer<typeof channelBindingSchema>;
export const channelAttachmentSchema = z.object({ id: z.string().min(1), name: z.string().min(1).max(255), mimeType: z.string().min(1).max(120), size: z.number().int().nonnegative().max(50 * 1024 * 1024), downloadUrl: z.string().url(), expiresAt: z.string().datetime() });
export const channelEnvelopeSchema = z.object({
  id: z.string().uuid(), channel: channelSchema, providerEventId: z.string().min(1).max(300), idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
  bindingId: z.string().uuid(), conversationKey: z.string().min(1).max(300), senderId: z.string().min(1).max(200), chatId: z.string().min(1).max(200), scope: channelScopeSchema,
  kind: z.enum(["task.create", "task.cancel", "task.status"]), text: z.string().max(20_000), attachments: z.array(channelAttachmentSchema).max(10), createdAt: z.string().datetime(),
});
export type ChannelEnvelope = z.infer<typeof channelEnvelopeSchema>;
export const deliveryReceiptSchema = z.object({ envelopeId: z.string().uuid(), deviceInstallationId: z.string().uuid(), status: z.enum(["delivered", "acked", "rejected", "expired"]), taskId: z.string().min(1).optional(), reason: z.string().max(300).optional(), receivedAt: z.string().datetime() });
export type DeliveryReceipt = z.infer<typeof deliveryReceiptSchema>;
export const signedDeviceRequestSchema = z.object({ deviceInstallationId: z.string().uuid(), timestamp: z.number().int().positive(), nonce: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/), signature: z.string().regex(/^[A-Za-z0-9_-]{40,200}$/) });
export type SignedDeviceRequest = z.infer<typeof signedDeviceRequestSchema>;
