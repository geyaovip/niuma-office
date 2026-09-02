import { ChartBar, Code, FileText, Palette, PresentationChart } from "@phosphor-icons/react";
import { useState } from "react";
import type { ArtifactRecord, ConnectorCatalogItemRecord, KnowledgeSourceRecord, PermissionMode, ProjectRecord, SkillCatalogItemRecord } from "../types";
import { Composer } from "./Composer";

const prompts = {
  "日常办公": [{ icon: FileText, label: "整理一份会议纪要" }, { icon: ChartBar, label: "分析表格中的经营数据" }, { icon: PresentationChart, label: "制作项目汇报大纲" }, { icon: FileText, label: "起草一封正式邮件" }],
  "代码开发": [{ icon: Code, label: "梳理需求并拆分开发任务" }, { icon: Code, label: "检查代码中的潜在问题" }, { icon: FileText, label: "整理接口与数据说明" }, { icon: PresentationChart, label: "生成技术方案大纲" }],
  "设计创意": [{ icon: Palette, label: "整理一份视觉设计方向" }, { icon: PresentationChart, label: "制作提案结构" }, { icon: FileText, label: "优化产品页面文案" }, { icon: ChartBar, label: "归纳用户反馈与机会点" }],
} as const;

export function NewTaskView({ projects, skills, connectors, knowledgeSources, runtimeStatus, onSubmit, initialTeamId, initialProjectId, initialArtifacts, initialSkillIds, initialConnectorIds, onModelSettings }: { projects: ProjectRecord[]; skills: SkillCatalogItemRecord[]; connectors: ConnectorCatalogItemRecord[]; knowledgeSources: KnowledgeSourceRecord[]; runtimeStatus: NiumaRuntimeStatus; onSubmit: (prompt: string, teamId?: string, projectId?: string, modelMode?: "auto" | "custom", attachments?: string[], permissionMode?: PermissionMode, artifactInputs?: string[], skillIds?: string[], connectorIds?: string[], knowledgeIds?: string[]) => void; initialTeamId?: string; initialProjectId?: string; initialArtifacts?: ArtifactRecord[]; initialSkillIds?: string[]; initialConnectorIds?: string[]; onModelSettings: () => void }) {
  const [scene, setScene] = useState("日常办公");
  const [suggestedPrompt, setSuggestedPrompt] = useState("");
  return <main className="new-task-view page"><div className="new-task-center">
    <div className="hero-logo"><img src="./brand/niuma-mascot-mark-v3.png" alt="牛马办公" /></div>
    <h1>牛马办公，我帮你</h1>
    <p className="hero-copy">专门替“牛马”干活的 AI 办公工具</p>
    <div className="scene-switch" aria-label="任务场景">{[{ label: "日常办公", icon: FileText }, { label: "代码开发", icon: Code }, { label: "设计创意", icon: Palette }].map(({ label, icon: Icon }) => <button key={label} className={scene === label ? "selected" : ""} onClick={() => setScene(label)}><Icon size={15} />{label}</button>)}</div>
    <div className="prompt-grid">{prompts[scene as keyof typeof prompts].map(({ icon: Icon, label }) => <button key={label} onClick={() => setSuggestedPrompt(label)}><Icon size={18} /><span>{label}</span></button>)}</div>
    {(runtimeStatus.state === "failed" || runtimeStatus.state === "unavailable") && <div className="runtime-notice" role="status"><strong>本地执行服务暂不可用</strong><span>请稍后重试；已有任务和文件不会受影响。</span></div>}
    <Composer projects={projects} skills={skills} connectors={connectors} knowledgeSources={knowledgeSources} onSubmit={onSubmit} initialTeamId={initialTeamId} initialProjectId={initialProjectId} initialArtifacts={initialArtifacts} initialSkillIds={initialSkillIds} initialConnectorIds={initialConnectorIds} onModelSettings={onModelSettings} suggestedPrompt={suggestedPrompt} />
  </div></main>;
}
