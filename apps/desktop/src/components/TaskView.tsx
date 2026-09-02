import { ArrowClockwise, ArrowSquareOut, Books, CaretDown, CaretUp, Check, CircleNotch, Eye, FileText, FolderOpen, MagnifyingGlass, MinusCircle, ShieldWarning, StopCircle, UserFocus, WarningCircle, Wrench, UsersThree, X } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { expertTeams } from "../data";
import type { ArtifactPreview, ArtifactRecord, ConnectorCatalogItemRecord, ExpertRunRecord, KnowledgeSourceRecord, PermissionMode, ProjectRecord, SkillCatalogItemRecord, TaskRecord, TaskTurnRecord } from "../types";
import { Composer } from "./Composer";

const statusLabels = { queued: "等待执行", completed: "已完成", running: "执行中", failed: "需处理", cancelled: "已停止", waiting: "待处理", waiting_user: "等待确认" } as const;

export function TaskView({ task, artifacts, knowledgeSources, projects, skills, connectors, onSubmit, onCancel, onRetry, onResolvePermission, onResolveQuestion, onReuseArtifact, onAddToKnowledge, onModelSettings }: {
  task: TaskRecord;
  artifacts: ArtifactRecord[];
  knowledgeSources: KnowledgeSourceRecord[];
  projects: ProjectRecord[];
  skills: SkillCatalogItemRecord[];
  connectors: ConnectorCatalogItemRecord[];
  onSubmit: (prompt: string, teamId?: string, projectId?: string, modelMode?: "auto" | "custom", attachments?: string[], permissionMode?: PermissionMode, artifactInputs?: string[], skillIds?: string[], connectorIds?: string[], knowledgeIds?: string[]) => void;
  onCancel: () => void;
  onRetry: () => void;
  onResolvePermission: (approvalId: string, decision: "allow_once" | "allow_task" | "deny") => void;
  onResolveQuestion: (questionId: string, answers: Record<string, string[]>, rememberSecretQuestionIds?: string[]) => void;
  onReuseArtifact: (artifactId: string) => void;
  onAddToKnowledge: (artifactId: string) => void;
  onModelSettings: () => void;
}) {
  const [preview, setPreview] = useState<ArtifactPreview>();
  const [previewError, setPreviewError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const turns: TaskTurnRecord[] = task.turns?.length ? task.turns : [{ id: `${task.id}-legacy`, prompt: task.prompt, status: task.status, createdAt: task.createdAt, teamId: task.teamId, teamSnapshot: task.teamSnapshot, expertId: task.expertId, expertSnapshot: task.expertSnapshot, skillSnapshots: task.skillSnapshots, connectorSnapshots: task.connectorSnapshots, knowledgeReferences: task.knowledgeReferences, projectId: task.projectId, modelMode: task.modelMode, permissionMode: task.permissionMode, attachments: task.attachments, artifactInputs: task.artifactInputs, output: task.output, error: task.error, artifactPath: task.artifactPath, completedAt: task.completedAt, expertRuns: task.expertRuns }];
  const active = ["queued", "running", "waiting", "waiting_user"].includes(task.status);
  const matches = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    return turns.flatMap(turn => {
      const turnArtifacts = artifacts.filter(artifact => artifact.turnId ? artifact.turnId === turn.id : turns.length === 1);
      const searchable = [turn.prompt, turn.output, turn.error, ...turnArtifacts.map(artifact => artifact.name)].filter(Boolean).join("\n").toLocaleLowerCase();
      return searchable.includes(query) ? [turn.id] : [];
    });
  }, [artifacts, searchQuery, turns]);
  const navigateMatch = (direction: number) => {
    if (!matches.length) return;
    const next = (searchIndex + direction + matches.length) % matches.length;
    setSearchIndex(next);
    document.getElementById(`turn-${matches[next]}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const showPreview = async (artifactId: string) => {
    setPreviewError("");
    try { setPreview(await window.niuma!.previewArtifact(artifactId)); }
    catch (error) { setPreview(undefined); setPreviewError(error instanceof Error ? error.message : "暂时无法预览交付文件"); }
  };
  return <main className="task-view page">
    <header className="page-header"><div><p>任务</p><h2>{task.title}</h2></div><div className="task-header-actions">{searchOpen ? <div className="task-search"><MagnifyingGlass size={16} /><input autoFocus aria-label="搜索当前任务" value={searchQuery} onChange={event => { setSearchQuery(event.target.value); setSearchIndex(0); }} placeholder="搜索对话与产物" /><span>{searchQuery.trim() ? `${matches.length ? searchIndex + 1 : 0}/${matches.length}` : ""}</span><button aria-label="上一个结果" disabled={!matches.length} onClick={() => navigateMatch(-1)}><CaretUp size={15} /></button><button aria-label="下一个结果" disabled={!matches.length} onClick={() => navigateMatch(1)}><CaretDown size={15} /></button><button aria-label="关闭搜索" onClick={() => { setSearchOpen(false); setSearchQuery(""); }}><X size={15} /></button></div> : <button className="task-search-trigger" aria-label="搜索当前任务" onClick={() => setSearchOpen(true)}><MagnifyingGlass size={18} /></button>}<span className={`status-pill ${task.status}`}>{statusLabels[task.status]}</span>{task.status === "running" && <button className="stop-task" onClick={onCancel}><StopCircle size={17} />停止</button>}</div></header>
    <div className="conversation">
      {turns.map((turn, index) => {
        const latest = index === turns.length - 1;
        const turnTask: TaskRecord = latest ? task : { ...task, prompt: turn.prompt, status: turn.status, teamId: turn.teamId, teamSnapshot: turn.teamSnapshot, expertId: turn.expertId, expertSnapshot: turn.expertSnapshot, skillSnapshots: turn.skillSnapshots, connectorSnapshots: turn.connectorSnapshots, knowledgeReferences: turn.knowledgeReferences, projectId: turn.projectId, modelMode: turn.modelMode, permissionMode: turn.permissionMode, attachments: turn.attachments, artifactInputs: turn.artifactInputs, output: turn.output, error: turn.error, artifactPath: turn.artifactPath, completedAt: turn.completedAt, expertRuns: turn.expertRuns, pendingPermission: undefined };
        const catalogTeam = turnTask.teamId ? expertTeams.find(item => item.id === turnTask.teamId) : undefined;
        const turnTeam = turnTask.teamSnapshot ?? catalogTeam;
        const turnExpert = turnTask.expertSnapshot;
        const turnArtifacts = artifacts.filter(artifact => artifact.turnId ? artifact.turnId === turn.id : turns.length === 1 || index === 0);
        return <section className={`conversation-turn ${matches[searchIndex] === turn.id ? "search-current" : ""}`} id={`turn-${turn.id}`} key={turn.id}>
          <div className="turn-label">第 {index + 1} 轮 · {formatTurnTime(turn.createdAt)}</div>
          <div className="user-bubble">{turn.prompt}</div>
          {!!turnTask.skillSnapshots?.length && <div className="turn-skills"><Wrench size={14} />{turnTask.skillSnapshots.map(skill => <span key={`${skill.id}:${skill.version}`}>{skill.name} · {skill.version}</span>)}</div>}
          {!!turnTask.connectorSnapshots?.length && <div className="turn-skills"><Books size={14} />{turnTask.connectorSnapshots.map(connector => <span key={`${connector.id}:${connector.version}`}>{connector.name} · {connector.version}</span>)}</div>}
          {!!turnTask.knowledgeReferences?.length && <div className="turn-skills"><Books size={14} />{turnTask.knowledgeReferences.map(reference => <span key={`${reference.id}:${reference.contentDigest}`}>{reference.name}</span>)}</div>}
          <section className="run-card">
            <div className="run-heading"><span className="team-avatar" style={{ background: catalogTeam?.accent || "#343434" }}>{turnExpert ? <UserFocus size={20} color="white" /> : <UsersThree size={20} color="white" />}</span><div><strong>{turnExpert?.name || turnTeam?.name || "牛马办公"}</strong><small>{turnExpert ? expertStatus(turnTask) : turnTeam ? teamStatus(turnTask) : singleStatus(turnTask)}</small></div></div>
            {latest && task.progressCard && <ProgressCard task={task} />}
            {latest && task.pendingPermission ? <PermissionCard task={task} onResolve={onResolvePermission} /> : latest && task.pendingQuestion ? <QuestionCard task={task} onResolve={onResolveQuestion} /> : turnTask.status === "failed" ? <ErrorCard task={turnTask} onRetry={latest ? onRetry : undefined} onModelSettings={onModelSettings} /> : turnExpert ? <SingleExpertTimeline task={turnTask} /> : turnTeam ? <ExpertTimeline task={turnTask} teamMembers={turnTeam.members} /> : <SingleRun task={turnTask} />}
            {latest && turnTask.status === "cancelled" && <button className="retry-task" onClick={onRetry}><ArrowClockwise size={16} />重新运行</button>}
            {turnTask.output && (turnTask.status === "running" || turnTask.status === "completed") && <div className={`task-result ${turnTask.status === "running" ? "streaming" : ""}`}><h3>{turnTask.status === "running" ? "正在生成" : "交付结果"}{turnTask.status === "running" && <CircleNotch size={15} className="spin" />}</h3><p>{turnTask.output}</p></div>}
            {turnTask.status === "completed" && turnArtifacts.map(artifact => <div className="deliverable" key={artifact.id}><FileText size={24} /><div><strong>{artifact.name}</strong><span>{artifact.sourceName ? `${artifact.sourceName} · ` : ""}本轮交付文件 · {formatSize(artifact.size)}</span></div><div className="deliverable-actions"><button title="预览" onClick={() => void showPreview(artifact.id)}><Eye size={18} /></button><button title="用系统应用打开" onClick={() => void window.niuma?.openArtifact(artifact.id)}><ArrowSquareOut size={18} /></button><button title="在访达中显示" onClick={() => void window.niuma?.showArtifact(artifact.id)}><FolderOpen size={18} /></button><button title="继续用于新任务" onClick={() => onReuseArtifact(artifact.id)}><ArrowClockwise size={18} /></button><button title={knowledgeSources.some(item => item.artifactId === artifact.id) ? "已加入资料库" : "加入资料库"} disabled={knowledgeSources.some(item => item.artifactId === artifact.id)} onClick={() => onAddToKnowledge(artifact.id)}><Books size={18} /></button></div></div>)}
            {previewError && latest && <p className="artifact-preview-error">{previewError}</p>}
          </section>
        </section>;
      })}
    </div>
    <div className="task-composer"><Composer compact disabled={active} projects={projects} skills={skills} connectors={connectors} knowledgeSources={knowledgeSources} onSubmit={onSubmit} initialTeamId={task.expertId ? `expert:${task.expertId}` : task.teamId ? `team:${task.teamId}` : undefined} initialProjectId={task.projectId} onModelSettings={onModelSettings} /></div>
    {preview && <ArtifactPreviewModal preview={preview} onClose={() => setPreview(undefined)} />}
  </main>;
}

function ArtifactPreviewModal({ preview, onClose }: { preview: ArtifactPreview; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="artifact-preview-modal" role="dialog" aria-modal="true" aria-label={`预览 ${preview.name}`}><header><div><strong>{preview.name}</strong><span>{formatSize(preview.size)}</span></div><button aria-label="关闭预览" onClick={onClose}><X size={19} /></button></header><div className="artifact-preview-body">{preview.kind === "text" ? <pre>{preview.content}</pre> : preview.kind === "image" ? <img src={preview.dataUrl} alt={preview.name} /> : preview.kind === "pdf" ? <object data={preview.dataUrl} type="application/pdf" aria-label={preview.name} /> : <div className="preview-unsupported"><FileText size={38} /><strong>此格式暂不支持应用内预览</strong><p>可以使用系统默认应用打开完整文件。</p></div>}</div></section></div>;
}

function formatSize(size?: number) {
  if (size === undefined) return "已保存到工作空间";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function PermissionCard({ task, onResolve }: { task: TaskRecord; onResolve: (approvalId: string, decision: "allow_once" | "allow_task" | "deny") => void }) {
  const request = task.pendingPermission!;
  const plugin = request.kind === "plugin";
  return <div className="permission-card"><ShieldWarning size={22} /><div><strong>需要你的确认</strong><p>{plugin ? request.description || "任务准备使用一项扩展能力。请确认用途后决定是否继续。" : "任务准备运行一项本机操作。请确认内容后决定是否继续。"}</p><code>{request.command}</code>{request.cwd && <small>位置：{request.cwd}</small>}<div className="permission-actions"><button onClick={() => onResolve(request.id, "deny")}>拒绝</button><button className={plugin ? "primary" : undefined} onClick={() => onResolve(request.id, "allow_once")}>仅允许这一次</button>{!plugin && <button className="primary" onClick={() => onResolve(request.id, "allow_task")}>本任务内允许低风险命令</button>}</div></div></div>;
}

function ProgressCard({ task }: { task: TaskRecord }) {
  const card = task.progressCard!;
  if (!card.steps.length && !card.markdown) return null;
  return <div className="progress-card" aria-label="任务进度">{card.markdown && <p>{card.markdown}</p>}{card.steps.map((item, index) => <div className={`progress-step ${item.status}`} key={`${index}:${item.step}`}><span>{item.status === "completed" ? <Check size={13} weight="bold" /> : item.status === "in_progress" ? <CircleNotch size={13} className="spin" /> : index + 1}</span><strong>{item.step}</strong></div>)}</div>;
}

function QuestionCard({ task, onResolve }: { task: TaskRecord; onResolve: (questionId: string, answers: Record<string, string[]>, rememberSecretQuestionIds?: string[]) => void }) {
  const pending = task.pendingQuestion!;
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [rememberSecrets, setRememberSecrets] = useState<Record<string, boolean>>({});
  const setChoice = (questionId: string, label: string, multi: boolean) => setAnswers(current => {
    const selected = current[questionId] ?? [];
    return { ...current, [questionId]: multi ? selected.includes(label) ? selected.filter(item => item !== label) : [...selected, label] : [label] };
  });
  const resolved = Object.fromEntries(pending.questions.map(question => {
    const values = answers[question.questionId] ?? [];
    const custom = other[question.questionId]?.trim();
    return [question.questionId, custom ? [...values, custom] : values];
  }));
  const complete = pending.questions.every(question => (resolved[question.questionId]?.length ?? 0) > 0);
  const remembered = Object.entries(rememberSecrets).flatMap(([id, enabled]) => enabled ? [id] : []);
  return <form className="question-card" onSubmit={event => { event.preventDefault(); if (complete) onResolve(pending.id, resolved, remembered); }}><strong>继续前需要你确认</strong>{pending.questions.map(question => <fieldset key={question.questionId}><legend>{question.header && <span>{question.header}</span>}{question.question}</legend>{question.options.map(option => <label className="question-option" key={option.label}><input type={question.multiSelect ? "checkbox" : "radio"} name={question.questionId} checked={(answers[question.questionId] ?? []).includes(option.label)} onChange={() => setChoice(question.questionId, option.label, question.multiSelect === true)} /><span><b>{option.label}</b>{option.description && <small>{option.description}</small>}</span></label>)}{(question.isOther || question.options.length === 0 || question.isSecret) && <input className="question-other" type={question.isSecret ? "password" : "text"} autoComplete="off" aria-label={`${question.header || "问题"}的回答`} placeholder={question.isSecret ? "不会显示在对话中" : "填写其他回答"} value={other[question.questionId] ?? ""} onChange={event => setOther(current => ({ ...current, [question.questionId]: event.target.value }))} />}{question.isSecret && question.secretStore?.allowedHosts?.length ? <label className="question-remember"><input type="checkbox" checked={rememberSecrets[question.questionId] === true} onChange={event => setRememberSecrets(current => ({ ...current, [question.questionId]: event.target.checked }))} /><span>保存到本机钥匙串，以后在同一服务中使用</span></label> : null}</fieldset>)}<div className="permission-actions"><button className="primary" type="submit" disabled={!complete}>提交并继续</button></div></form>;
}

function SingleRun({ task }: { task: TaskRecord }) {
  return <div className="run-steps"><div className={`run-step ${task.status === "completed" ? "done" : task.status === "running" ? "active" : ""}`}><span><RunIcon status={task.status} /></span><div><strong>理解任务并完成交付</strong><p>{task.status === "completed" ? "已完成任务并保存交付结果。" : task.status === "cancelled" ? "任务已停止，当前记录已保留。" : "正在处理任务…"}</p></div></div></div>;
}

function ExpertTimeline({ task, teamMembers }: { task: TaskRecord; teamMembers: Array<{ name: string; role: string }> }) {
  const runs: ExpertRunRecord[] = task.expertRuns?.length ? task.expertRuns : teamMembers.map((member, index) => ({ id: String(index), expertId: String(index), expertName: member.name, role: member.role, status: index === 0 && task.status === "running" ? "running" : "waiting" }));
  return <div className="run-steps">
    {runs.map(run => <div className={`run-step ${run.status === "completed" ? "done" : run.status === "running" ? "active" : ""}`} key={run.id}>
      <span><RunIcon status={run.status} /></span><div><strong>{run.expertName} · {run.role}</strong><p>{run.output ? shortOutput(run.output) : run.status === "running" ? "正在处理分工内容…" : run.status === "completed" ? "已完成成员输出。" : "等待开始。"}</p>{run.output && <details className="member-output"><summary>查看独立输出</summary><pre>{run.output}</pre></details>}</div>
    </div>)}
    {task.status === "completed" && <div className="run-step done"><span><Check size={15} weight="bold" /></span><div><strong>负责人汇总与交付</strong><p>已综合所有固定成员输出并完成最终结果。</p></div></div>}
    {task.status === "cancelled" && <div className="run-step"><span><MinusCircle size={15} /></span><div><strong>任务已停止</strong><p>已保留当前的成员输出和任务记录。</p></div></div>}
  </div>;
}

function SingleExpertTimeline({ task }: { task: TaskRecord }) {
  const expert = task.expertSnapshot!;
  const run = task.expertRuns?.[0] ?? { id: expert.id, expertId: expert.id, expertName: expert.name, role: expert.role, status: task.status };
  return <div className="run-steps"><div className={`run-step ${run.status === "completed" ? "done" : run.status === "running" ? "active" : ""}`}><span><RunIcon status={run.status} /></span><div><strong>{run.expertName} · {run.role}</strong><p>{run.output ? shortOutput(run.output) : run.status === "running" ? "正在按专家职责处理任务…" : run.status === "completed" ? "已完成专家交付。" : run.status === "cancelled" ? "执行已停止，当前记录已保留。" : "等待开始。"}</p></div></div></div>;
}

function ErrorCard({ task, onRetry, onModelSettings }: { task: TaskRecord; onRetry?: () => void; onModelSettings: () => void }) {
  const needsModel = /自定义模型|密钥|鉴权/.test(task.error || "");
  return <div className="task-error"><WarningCircle size={21} /><div><strong>任务暂未完成</strong><p>{task.error || "请检查模型设置后重试。"}</p>{onRetry && <div className="task-error-actions">{needsModel && <button onClick={onModelSettings}>检查模型设置</button>}<button className="primary" onClick={onRetry}><ArrowClockwise size={15} />重新运行</button></div>}</div></div>;
}

function RunIcon({ status }: { status: ExpertRunRecord["status"] }) {
  if (status === "completed") return <Check size={15} weight="bold" />;
  if (status === "running") return <CircleNotch size={15} className="spin" />;
  return <span className="idle-dot" />;
}

function shortOutput(output: string) { const normalized = output.replace(/[#*_`>\n]+/g, " ").replace(/\s+/g, " ").trim(); return normalized.length > 130 ? `${normalized.slice(0, 130)}…` : normalized; }
function formatTurnTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "历史记录" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date); }
function teamStatus(task: TaskRecord) {
  if (task.status === "completed") return "固定成员已完成分工并交付";
  if (task.status === "failed") return "需要处理后继续";
  if (task.status === "cancelled") return "执行已停止";
  if (task.status === "queued") return "等待办公引擎接收任务";
  if (task.status === "waiting_user") return "等待你的确认";
  return "正在组织固定成员协作";
}

function expertStatus(task: TaskRecord) {
  if (task.status === "completed") return "专家已完成交付";
  if (task.status === "failed") return "需要处理后继续";
  if (task.status === "cancelled") return "执行已停止";
  if (task.status === "queued") return "等待办公引擎接收任务";
  if (task.status === "waiting_user") return "等待你的确认";
  return "专家正在处理任务";
}

function singleStatus(task: TaskRecord) {
  if (task.status === "completed") return "任务已完成";
  if (task.status === "failed") return "需要处理后继续";
  if (task.status === "cancelled") return "执行已停止";
  if (task.status === "queued") return "等待办公引擎接收任务";
  if (task.status === "waiting_user") return "等待你的确认";
  return "正在执行任务";
}
