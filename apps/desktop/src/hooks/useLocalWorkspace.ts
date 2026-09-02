import { useCallback, useEffect, useMemo, useState } from "react";
import { initialProjects, initialTasks } from "../data";
import type { ArtifactRecord, AutomationSnapshotRecord, ConnectorCatalogItemRecord, CreateAutomationRecord, KnowledgeSearchResultRecord, KnowledgeSourceRecord, ProjectRecord, RuntimeEventRecord, SkillCatalogItemRecord, TaskRecord, WorkspaceSettingsRecord } from "../types";

const TASKS_KEY = "niuma.tasks.v1";
const PROJECTS_KEY = "niuma.projects.v1";
const LEGACY_TASKS_KEY = "xingban.tasks.v1";
const LEGACY_PROJECTS_KEY = "xingban.projects.v1";

function readStored<T>(key: string, fallback: T, legacyKey?: string): T {
  try {
    const value = localStorage.getItem(key) ?? (legacyKey ? localStorage.getItem(legacyKey) : null);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function useLocalWorkspace() {
  const [tasks, setTasks] = useState<TaskRecord[]>(() => readStored(TASKS_KEY, initialTasks, LEGACY_TASKS_KEY));
  const [projects, setProjects] = useState<ProjectRecord[]>(() => readStored(PROJECTS_KEY, initialProjects, LEGACY_PROJECTS_KEY));
  const [taskEvents, setTaskEvents] = useState<Record<string, RuntimeEventRecord[]>>({});
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSourceRecord[]>([]);
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettingsRecord>({ defaultRootPath: "", status: "ready" });
  const [runtimeStatus, setRuntimeStatus] = useState<NiumaRuntimeStatus>({ state: "stopped", message: "本地执行服务将在任务开始时启动" });
  const [skills, setSkills] = useState<SkillCatalogItemRecord[]>([]);
  const [connectors, setConnectors] = useState<ConnectorCatalogItemRecord[]>([]);
  const [automationSnapshot, setAutomationSnapshot] = useState<AutomationSnapshotRecord>({ automations: [], runs: [] });

  useEffect(() => localStorage.setItem(TASKS_KEY, JSON.stringify(tasks)), [tasks]);
  useEffect(() => localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects)), [projects]);

  useEffect(() => {
    if (!window.niuma) return;
    void window.niuma.workspaceBootstrap().then(snapshot => {
      setTasks(snapshot.tasks);
      setProjects(snapshot.projects);
      setArtifacts(snapshot.artifacts);
      setWorkspaceSettings(snapshot.workspaceSettings);
    });
  }, []);

  useEffect(() => { if (window.niuma) void window.niuma.listSkills().then(setSkills); }, []);
  useEffect(() => { if (window.niuma) void window.niuma.listConnectors().then(setConnectors); }, []);
  useEffect(() => { if (window.niuma) void window.niuma.listKnowledgeSources().then(setKnowledgeSources); }, []);
  useEffect(() => { if (window.niuma) void window.niuma.listAutomations().then(setAutomationSnapshot); }, []);

  useEffect(() => {
    if (!window.niuma) return;
    const refresh = () => void window.niuma?.getRuntimeStatus().then(setRuntimeStatus).catch(() => setRuntimeStatus({ state: "unavailable", message: "暂时无法连接本地执行服务，请稍后重试" }));
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => window.niuma?.onTaskUpdated(task => {
    setTasks(current => [task, ...current.filter(item => item.id !== task.id)]);
  }), []);

  useEffect(() => window.niuma?.onAutomationUpdated(setAutomationSnapshot), []);

  useEffect(() => window.niuma?.onRuntimeEvent(event => {
    setTaskEvents(current => {
      const existing = current[event.taskId] ?? [];
      if (existing.some(item => item.id === event.id)) return current;
      return { ...current, [event.taskId]: [...existing, event].sort((a, b) => a.sequence - b.sequence) };
    });
  }), []);

  const saveTask = async (task: TaskRecord) => {
    setTasks(current => [task, ...current.filter(item => item.id !== task.id)]);
    if (window.niuma) {
      const snapshot = await window.niuma.saveTask(task);
      setTasks(snapshot.tasks);
    }
    return task;
  };

  const runTask = async (task: TaskRecord) => {
    if (!window.niuma) return task;
    const updated = await window.niuma.runTask(task);
    setTasks(current => [updated, ...current.filter(item => item.id !== updated.id)]);
    const snapshot = await window.niuma.workspaceBootstrap();
    setArtifacts(snapshot.artifacts);
    return updated;
  };

  const cancelTask = async (taskId: string) => {
    if (!window.niuma) return;
    const updated = await window.niuma.cancelTask(taskId);
    setTasks(current => [updated, ...current.filter(item => item.id !== updated.id)]);
  };

  const resolvePermission = async (taskId: string, approvalId: string, decision: "allow_once" | "allow_task" | "deny") => {
    if (!window.niuma) return;
    const updated = await window.niuma.resolvePermission(taskId, approvalId, decision);
    setTasks(current => [updated, ...current.filter(item => item.id !== updated.id)]);
  };

  const resolveQuestion = async (taskId: string, questionId: string, answers: Record<string, string[]>, rememberSecretQuestionIds: string[] = []) => {
    if (!window.niuma) return;
    const updated = await window.niuma.resolveQuestion(taskId, questionId, answers, rememberSecretQuestionIds);
    setTasks(current => [updated, ...current.filter(item => item.id !== updated.id)]);
  };

  const searchTasks = useCallback(async (query: string): Promise<string[]> => window.niuma ? window.niuma.searchTasks(query) : [], []);

  const createProject = async (name: string) => {
    if (!window.niuma) return;
    const snapshot = await window.niuma.createProject(name);
    setProjects(snapshot.projects);
    setWorkspaceSettings(snapshot.workspaceSettings);
  };

  const createProjectWithFolder = async (name: string) => {
    if (!window.niuma) return;
    const snapshot = await window.niuma.createProjectWithFolder(name);
    if (!snapshot) return;
    setProjects(snapshot.projects);
    setWorkspaceSettings(snapshot.workspaceSettings);
  };

  const chooseDefaultWorkspaceRoot = async () => {
    if (!window.niuma) return false;
    const snapshot = await window.niuma.chooseDefaultWorkspaceRoot();
    if (!snapshot) return false;
    setProjects(snapshot.projects);
    setWorkspaceSettings(snapshot.workspaceSettings);
    return true;
  };

  const reauthorizeProject = async (projectId: string) => {
    if (!window.niuma) return false;
    const snapshot = await window.niuma.reauthorizeProject(projectId);
    if (!snapshot) return false;
    setProjects(snapshot.projects);
    setWorkspaceSettings(snapshot.workspaceSettings);
    return true;
  };

  const addProjectFiles = async (projectId: string) => {
    if (!window.niuma) return false;
    const snapshot = await window.niuma.addProjectFiles(projectId);
    if (!snapshot) return false;
    setProjects(snapshot.projects);
    return true;
  };

  const loadTaskEvents = async (taskId: string) => {
    if (!window.niuma) return [];
    const events = await window.niuma.getTaskEvents(taskId);
    setTaskEvents(current => ({ ...current, [taskId]: events }));
    return events;
  };

  const addArtifactToKnowledge = async (artifactId: string) => {
    if (!window.niuma) return;
    setKnowledgeSources(await window.niuma.addArtifactToKnowledge(artifactId));
  };
  const addKnowledgeFiles = async () => { if (!window.niuma) return; setKnowledgeSources(await window.niuma.addKnowledgeFiles()); };
  const addKnowledgeWeb = async (url: string) => { if (!window.niuma) return; setKnowledgeSources(await window.niuma.addKnowledgeWeb(url)); };
  const retryKnowledgeSource = async (sourceId: string) => { if (!window.niuma) return; setKnowledgeSources(await window.niuma.retryKnowledgeSource(sourceId)); };
  const removeKnowledgeSource = async (sourceId: string) => { if (!window.niuma) return; setKnowledgeSources(await window.niuma.removeKnowledgeSource(sourceId)); };
  const searchKnowledge = async (query: string): Promise<KnowledgeSearchResultRecord[]> => window.niuma ? window.niuma.searchKnowledge(query) : [];

  const installSkill = async (skillId: string) => { if (!window.niuma) return; setSkills(await window.niuma.installSkill(skillId)); };
  const setSkillEnabled = async (skillId: string, enabled: boolean) => { if (!window.niuma) return; setSkills(await window.niuma.setSkillEnabled(skillId, enabled)); };
  const configureRemoteConnector = async (input: { displayName: string; endpoint: string; transport: "streamable-http" | "sse"; credential?: string; clearCredential?: boolean }) => { if (!window.niuma) return; const next = await window.niuma.configureRemoteConnector(input); setConnectors(next); return next.find(item => item.definition.id === "remote-mcp"); };
  const testRemoteConnector = async () => { if (!window.niuma) return; const next = await window.niuma.testRemoteConnector(); setConnectors(next); return next.find(item => item.definition.id === "remote-mcp"); };
  const setConnectorEnabled = async (connectorId: string, enabled: boolean) => { if (!window.niuma) return; setConnectors(await window.niuma.setConnectorEnabled(connectorId, enabled)); };
  const createAutomation = async (input: CreateAutomationRecord) => { if (!window.niuma) return; setAutomationSnapshot(await window.niuma.createAutomation(input)); };
  const setAutomationEnabled = async (id: string, enabled: boolean) => { if (!window.niuma) return; setAutomationSnapshot(await window.niuma.setAutomationEnabled(id, enabled)); };
  const removeAutomation = async (id: string) => { if (!window.niuma) return; setAutomationSnapshot(await window.niuma.removeAutomation(id)); };
  const runAutomationNow = async (id: string) => { if (!window.niuma) return; setAutomationSnapshot(await window.niuma.runAutomationNow(id)); };
  const retryAutomationRun = async (runId: string) => { if (!window.niuma) return; setAutomationSnapshot(await window.niuma.retryAutomationRun(runId)); };

  return useMemo(() => ({ tasks, setTasks, saveTask, searchTasks, runTask, cancelTask, resolvePermission, resolveQuestion, projects, setProjects, createProject, createProjectWithFolder, reauthorizeProject, addProjectFiles, workspaceSettings, chooseDefaultWorkspaceRoot, artifacts, knowledgeSources, addArtifactToKnowledge, addKnowledgeFiles, addKnowledgeWeb, retryKnowledgeSource, removeKnowledgeSource, searchKnowledge, taskEvents, loadTaskEvents, runtimeStatus, skills, installSkill, setSkillEnabled, connectors, configureRemoteConnector, testRemoteConnector, setConnectorEnabled, automationSnapshot, createAutomation, setAutomationEnabled, removeAutomation, runAutomationNow, retryAutomationRun }), [tasks, projects, workspaceSettings, artifacts, knowledgeSources, taskEvents, runtimeStatus, skills, connectors, automationSnapshot, searchTasks]);
}
