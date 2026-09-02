import type { ConnectorSnapshotRecord, KnowledgeReferenceRecord, PermissionMode, SkillSnapshotRecord, TaskRecord } from "../types";
import { experts, expertTeams } from "../data";

export function createLocalTask(prompt: string, teamId?: string, projectId?: string, modelMode: "auto" | "custom" = "auto", attachments: string[] = [], permissionMode: PermissionMode = "default", artifactInputs: string[] = [], skillSnapshots: SkillSnapshotRecord[] = [], connectorSnapshots: ConnectorSnapshotRecord[] = [], knowledgeReferences: KnowledgeReferenceRecord[] = []): TaskRecord {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) throw new Error("任务内容不能为空");
  const createdAt = new Date().toISOString();
  const normalizedAttachments = attachments.slice(0, 10);
  const normalizedArtifactInputs = artifactInputs.slice(0, 10);
  const selection = resolveAssistantSelection(teamId);
  const normalizedSkills = skillSnapshots.slice(0, 5).map(skill => ({ ...skill, capabilities: [...skill.capabilities], permissions: [...skill.permissions] }));
  const normalizedConnectors = connectorSnapshots.slice(0, 5).map(connector => ({ ...connector, capabilities: [...connector.capabilities], permissions: [...connector.permissions] }));
  const normalizedKnowledge = knowledgeReferences.slice(0, 5).map(reference => ({ ...reference }));
  return {
    id: crypto.randomUUID(),
    title: normalizedPrompt.length > 28 ? `${normalizedPrompt.slice(0, 28)}…` : normalizedPrompt,
    prompt: normalizedPrompt,
    status: "queued",
    createdAt,
    teamId: selection.teamId,
    teamSnapshot: selection.teamSnapshot,
    expertId: selection.expertId,
    expertSnapshot: selection.expertSnapshot,
    skillSnapshots: normalizedSkills,
    connectorSnapshots: normalizedConnectors,
    knowledgeReferences: normalizedKnowledge,
    projectId: projectId || "default",
    modelMode,
    permissionMode,
    attachments: normalizedAttachments,
    artifactInputs: normalizedArtifactInputs,
    turns: [{ id: crypto.randomUUID(), prompt: normalizedPrompt, status: "queued", createdAt, teamId: selection.teamId, teamSnapshot: selection.teamSnapshot, expertId: selection.expertId, expertSnapshot: selection.expertSnapshot, skillSnapshots: normalizedSkills, connectorSnapshots: normalizedConnectors, knowledgeReferences: normalizedKnowledge, projectId: projectId || "default", modelMode, permissionMode, attachments: normalizedAttachments, artifactInputs: normalizedArtifactInputs }],
  };
}

export function continueLocalTask(task: TaskRecord, prompt: string, teamId?: string, projectId?: string, modelMode: "auto" | "custom" = "auto", attachments: string[] = [], permissionMode: PermissionMode = "default", artifactInputs: string[] = [], skillSnapshots: SkillSnapshotRecord[] = [], connectorSnapshots: ConnectorSnapshotRecord[] = [], knowledgeReferences: KnowledgeReferenceRecord[] = []): TaskRecord {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) throw new Error("任务内容不能为空");
  const createdAt = new Date().toISOString();
  const normalizedAttachments = attachments.slice(0, 10);
  const normalizedArtifactInputs = artifactInputs.slice(0, 10);
  const selection = resolveAssistantSelection(teamId);
  const normalizedSkills = skillSnapshots.slice(0, 5).map(skill => ({ ...skill, capabilities: [...skill.capabilities], permissions: [...skill.permissions] }));
  const normalizedConnectors = connectorSnapshots.slice(0, 5).map(connector => ({ ...connector, capabilities: [...connector.capabilities], permissions: [...connector.permissions] }));
  const normalizedKnowledge = knowledgeReferences.slice(0, 5).map(reference => ({ ...reference }));
  const turns = task.turns?.length ? task.turns : [{ id: `${task.id}-legacy`, prompt: task.prompt, status: task.status, createdAt: normalizeDate(task.createdAt), teamId: task.teamId, teamSnapshot: task.teamSnapshot, expertId: task.expertId, expertSnapshot: task.expertSnapshot, skillSnapshots: task.skillSnapshots, connectorSnapshots: task.connectorSnapshots, knowledgeReferences: task.knowledgeReferences, projectId: task.projectId, modelMode: task.modelMode, permissionMode: task.permissionMode, attachments: task.attachments, artifactInputs: task.artifactInputs, output: task.output, error: task.error, artifactPath: task.artifactPath, completedAt: task.completedAt, expertRuns: task.expertRuns }];
  return {
    ...task,
    prompt: normalizedPrompt,
    status: "queued",
    teamId: selection.teamId,
    teamSnapshot: selection.teamSnapshot,
    expertId: selection.expertId,
    expertSnapshot: selection.expertSnapshot,
    skillSnapshots: normalizedSkills,
    connectorSnapshots: normalizedConnectors,
    knowledgeReferences: normalizedKnowledge,
    projectId: projectId || "default",
    modelMode,
    permissionMode,
    attachments: normalizedAttachments,
    artifactInputs: normalizedArtifactInputs,
    output: undefined,
    error: undefined,
    artifactPath: undefined,
    completedAt: undefined,
    expertRuns: undefined,
    pendingPermission: undefined,
    turns: [...turns, { id: crypto.randomUUID(), prompt: normalizedPrompt, status: "queued", createdAt, teamId: selection.teamId, teamSnapshot: selection.teamSnapshot, expertId: selection.expertId, expertSnapshot: selection.expertSnapshot, skillSnapshots: normalizedSkills, connectorSnapshots: normalizedConnectors, knowledgeReferences: normalizedKnowledge, projectId: projectId || "default", modelMode, permissionMode, attachments: normalizedAttachments, artifactInputs: normalizedArtifactInputs }],
  };
}

export function retryCurrentTurn(task: TaskRecord): TaskRecord {
  const turns = task.turns?.map((turn, index, all) => index === all.length - 1 ? { ...turn, status: "queued" as const, output: undefined, error: undefined, artifactPath: undefined, completedAt: undefined, expertRuns: undefined } : turn);
  return { ...task, status: "queued", error: undefined, output: undefined, artifactPath: undefined, completedAt: undefined, expertRuns: undefined, pendingPermission: undefined, turns };
}

function normalizeDate(value: string) {
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : new Date(value).toISOString();
}

function resolveAssistantSelection(value?: string) {
  const expertId = value?.startsWith("expert:") ? value.slice("expert:".length) : undefined;
  const teamId = value?.startsWith("team:") ? value.slice("team:".length) : expertId ? undefined : value || undefined;
  const expert = expertId ? experts.find(item => item.id === expertId) : undefined;
  const team = teamId ? expertTeams.find(item => item.id === teamId) : undefined;
  if (expertId && !expert) throw new Error("所选专家当前不可用");
  if (teamId && !team) throw new Error("所选专家团当前不可用");
  const expertSnapshot = expert ? { id: expert.id, name: expert.name, role: expert.role, summary: expert.summary, version: expert.version, capabilities: [...expert.capabilities], permissions: [...expert.permissions] } : undefined;
  const teamSnapshot = team ? { id: team.id, name: team.name, summary: team.summary, version: team.version, capabilities: [...team.capabilities], permissions: [...team.permissions], members: team.members.map(member => ({ ...member })) } : undefined;
  return { teamId, teamSnapshot, expertId, expertSnapshot };
}
