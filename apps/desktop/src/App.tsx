import { SidebarSimple } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { NewTaskView } from "./components/NewTaskView";
import { TaskView } from "./components/TaskView";
import { ResourceView } from "./components/ResourceView";
import { AutomationView, KnowledgeView, ProjectsView } from "./components/SupportingViews";
import { AccountMenu } from "./components/AccountMenu";
import { ModelSettingsModal } from "./components/ModelSettingsModal";
import { useLocalWorkspace } from "./hooks/useLocalWorkspace";
import { continueLocalTask, createLocalTask, retryCurrentTurn } from "./domain/tasks";
import type { PermissionMode, ViewKey } from "./types";

export function App() {
  const { tasks, saveTask, searchTasks, runTask, cancelTask, resolvePermission, resolveQuestion, projects, createProject, createProjectWithFolder, reauthorizeProject, addProjectFiles, workspaceSettings, chooseDefaultWorkspaceRoot, artifacts, knowledgeSources, addArtifactToKnowledge, addKnowledgeFiles, addKnowledgeWeb, retryKnowledgeSource, removeKnowledgeSource, searchKnowledge, taskEvents, loadTaskEvents, runtimeStatus, skills, installSkill, setSkillEnabled, connectors, configureRemoteConnector, testRemoteConnector, setConnectorEnabled, automationSnapshot, createAutomation, setAutomationEnabled, removeAutomation, runAutomationNow, retryAutomationRun } = useLocalWorkspace();
  const [view, setView] = useState<ViewKey>("new-task");
  const [activeTaskId, setActiveTaskId] = useState(tasks[0]?.id ?? "");
  const [accountOpen, setAccountOpen] = useState(false);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"model" | "workspace">("model");
  const [preferredTeamId, setPreferredTeamId] = useState<string>();
  const [preferredProjectId, setPreferredProjectId] = useState<string>();
  const [preferredSkillIds, setPreferredSkillIds] = useState<string[]>([]);
  const [reusedArtifactIds, setReusedArtifactIds] = useState<string[]>([]);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [searchRequest, setSearchRequest] = useState(0);
  const activeTask = tasks.find(task => task.id === activeTaskId) ?? tasks[0];
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let preference: "system" | "light" | "dark" = "system";
    const apply = () => { const effective = preference === "system" ? (media.matches ? "dark" : "light") : preference; document.documentElement.dataset.theme = effective; };
    void window.niuma?.getPreferences().then(value => { preference = value.appearance; apply(); });
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  const navigate = (target: ViewKey) => { if (target === "new-task") setPreferredProjectId(undefined); setView(target); };
  useEffect(() => { if (activeTask?.id) void loadTaskEvents(activeTask.id); }, [activeTask?.id]);
  const resolveSkillSnapshots = (skillIds: string[] = []) => skillIds.map(id => skills.find(item => item.definition.id === id && item.installation?.status === "active")?.definition).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const resolveConnectorSnapshots = (connectorIds: string[] = []) => connectorIds.map(id => connectors.find(item => item.definition.id === id && item.installation.status === "active")?.definition).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const createTask = async (prompt: string, teamId?: string, projectId?: string, modelMode?: "auto" | "custom", attachments?: string[], permissionMode?: PermissionMode, artifactInputs?: string[], skillIds?: string[], connectorIds?: string[], knowledgeIds?: string[]) => {
    const references = knowledgeIds?.length ? await window.niuma?.snapshotKnowledge(knowledgeIds) ?? [] : [];
    const task = createLocalTask(prompt, teamId, projectId, modelMode, attachments, permissionMode, artifactInputs, resolveSkillSnapshots(skillIds), resolveConnectorSnapshots(connectorIds), references);
    setReusedArtifactIds([]);
    setPreferredSkillIds([]);
    setPreferredProjectId(undefined);
    setActiveTaskId(task.id); setView("task");
    await saveTask(task);
    await runTask(task);
  };
  const continueTask = async (prompt: string, teamId?: string, projectId?: string, modelMode?: "auto" | "custom", attachments?: string[], permissionMode?: PermissionMode, artifactInputs?: string[], skillIds?: string[], connectorIds?: string[], knowledgeIds?: string[]) => {
    if (!activeTask || ["queued", "running", "waiting", "waiting_user"].includes(activeTask.status)) return;
    const references = knowledgeIds?.length ? await window.niuma?.snapshotKnowledge(knowledgeIds) ?? [] : [];
    const task = continueLocalTask(activeTask, prompt, teamId, projectId, modelMode, attachments, permissionMode, artifactInputs, resolveSkillSnapshots(skillIds), resolveConnectorSnapshots(connectorIds), references);
    await saveTask(task);
    await runTask(task);
  };
  const openTask = (id: string) => { setActiveTaskId(id); setView("task"); };
  const retryTask = async () => {
    if (!activeTask) return;
    const queued = retryCurrentTurn(activeTask);
    await saveTask(queued);
    await runTask(queued);
  };
  useEffect(() => window.niuma?.onAppCommand(command => {
    if (command === "new-task") navigate("new-task");
    if (command === "search") { setSidebarVisible(true); setSearchRequest(value => value + 1); }
    if (command === "toggle-sidebar") setSidebarVisible(value => !value);
    if (command === "open-settings") { setSettingsSection("workspace"); setModelSettingsOpen(true); }
    if (command === "stop-task" && activeTask && ["queued", "running", "waiting", "waiting_user"].includes(activeTask.status)) void cancelTask(activeTask.id);
  }), [activeTask?.id, activeTask?.status]);
  return <div className={sidebarVisible ? "app-shell" : "app-shell sidebar-hidden"}>{sidebarVisible && <Sidebar current={view} activeTaskId={activeTask?.id} tasks={tasks} searchRequest={searchRequest} onSearch={searchTasks} onNavigate={navigate} onTask={openTask} onAccount={() => setAccountOpen(true)} />}
    <section className="content-shell">
      {!sidebarVisible && <button className="restore-sidebar" aria-label="显示侧栏" title="显示侧栏" onClick={() => setSidebarVisible(true)}><SidebarSimple size={18} /></button>}
      {view === "new-task" && <NewTaskView projects={projects} skills={skills} connectors={connectors} knowledgeSources={knowledgeSources} runtimeStatus={runtimeStatus} onSubmit={createTask} initialTeamId={preferredTeamId} initialProjectId={preferredProjectId} initialArtifacts={artifacts.filter(item => reusedArtifactIds.includes(item.id))} initialSkillIds={preferredSkillIds} onModelSettings={() => { setSettingsSection("model"); setModelSettingsOpen(true); }} />}
      {view === "task" && activeTask && <TaskView task={activeTask} artifacts={artifacts.filter(item => item.taskId === activeTask.id)} knowledgeSources={knowledgeSources} projects={projects} skills={skills} connectors={connectors} onSubmit={continueTask} onCancel={() => void cancelTask(activeTask.id)} onRetry={() => void retryTask()} onResolvePermission={(approvalId, decision) => void resolvePermission(activeTask.id, approvalId, decision)} onResolveQuestion={(questionId, answers, rememberSecretQuestionIds) => void resolveQuestion(activeTask.id, questionId, answers, rememberSecretQuestionIds)} onReuseArtifact={artifactId => { setReusedArtifactIds([artifactId]); setPreferredProjectId(undefined); setView("new-task"); }} onAddToKnowledge={artifactId => void addArtifactToKnowledge(artifactId)} onModelSettings={() => { setSettingsSection("model"); setModelSettingsOpen(true); }} />}
      {view === "projects" && <ProjectsView projects={projects} tasks={tasks} artifacts={artifacts} onCreate={createProject} onCreateWithFolder={createProjectWithFolder} onReauthorize={reauthorizeProject} onAddFiles={addProjectFiles} onNewTask={projectId => { setPreferredProjectId(projectId); setView("new-task"); }} onOpenTask={openTask} />}
      {view === "resources" && <ResourceView skills={skills} connectors={connectors} onInstallSkill={installSkill} onSetSkillEnabled={setSkillEnabled} onUseSkill={skillId => { setPreferredSkillIds([skillId]); setPreferredTeamId(undefined); setPreferredProjectId(undefined); setView("new-task"); }} onConfigureRemoteConnector={configureRemoteConnector} onTestRemoteConnector={testRemoteConnector} onSetConnectorEnabled={setConnectorEnabled} onUseExpert={expertId => { setPreferredTeamId(`expert:${expertId}`); setPreferredProjectId(undefined); setView("new-task"); }} onUseTeam={teamId => { setPreferredTeamId(`team:${teamId}`); setPreferredProjectId(undefined); setView("new-task"); }} />}
      {view === "automation" && <AutomationView snapshot={automationSnapshot} projects={projects} onCreate={createAutomation} onSetEnabled={setAutomationEnabled} onRemove={removeAutomation} onRunNow={runAutomationNow} onRetry={retryAutomationRun} onOpenTask={openTask} />}
      {view === "knowledge" && <KnowledgeView sources={knowledgeSources} onAddFiles={addKnowledgeFiles} onAddWeb={addKnowledgeWeb} onRetry={retryKnowledgeSource} onRemove={removeKnowledgeSource} onSearch={searchKnowledge} />}
    </section>{accountOpen && <AccountMenu runtimeStatus={runtimeStatus} onClose={() => setAccountOpen(false)} onSettings={() => { setAccountOpen(false); setSettingsSection("workspace"); setModelSettingsOpen(true); }} />}{modelSettingsOpen && <ModelSettingsModal initialSection={settingsSection} workspaceSettings={workspaceSettings} onChooseWorkspace={chooseDefaultWorkspaceRoot} onClose={() => setModelSettingsOpen(false)} />}</div>;
}
