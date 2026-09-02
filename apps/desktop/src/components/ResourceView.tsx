import { ArrowLeft, CheckCircle, LinkSimple, MagnifyingGlass, ShieldCheck, UserFocus, UsersThree, Wrench } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { experts, expertTeams } from "../data";
import type { ConnectorCatalogItemRecord, ExpertRecord, SkillCatalogItemRecord, TeamRecord } from "../types";

type Tab = "experts" | "skills" | "connectors";
type ExpertKind = "single" | "team";

interface Props {
  skills: SkillCatalogItemRecord[];
  connectors: ConnectorCatalogItemRecord[];
  onInstallSkill: (skillId: string) => Promise<void>;
  onSetSkillEnabled: (skillId: string, enabled: boolean) => Promise<void>;
  onUseSkill: (skillId: string) => void;
  onConfigureRemoteConnector: (input: { displayName: string; endpoint: string; transport: "streamable-http" | "sse"; credential?: string; clearCredential?: boolean }) => Promise<ConnectorCatalogItemRecord | undefined>;
  onTestRemoteConnector: () => Promise<ConnectorCatalogItemRecord | undefined>;
  onSetConnectorEnabled: (connectorId: string, enabled: boolean) => Promise<void>;
  onUseExpert: (expertId: string) => void;
  onUseTeam: (teamId: string) => void;
}

export function ResourceView({ skills, connectors, onInstallSkill, onSetSkillEnabled, onUseSkill, onConfigureRemoteConnector, onTestRemoteConnector, onSetConnectorEnabled, onUseExpert, onUseTeam }: Props) {
  const [tab, setTab] = useState<Tab>("experts");
  const [kind, setKind] = useState<ExpertKind>("single");
  const [query, setQuery] = useState("");
  const [selectedExpert, setSelectedExpert] = useState<ExpertRecord>();
  const [selectedTeam, setSelectedTeam] = useState<TeamRecord>();
  const [selectedSkill, setSelectedSkill] = useState<SkillCatalogItemRecord>();
  const [selectedConnector, setSelectedConnector] = useState<ConnectorCatalogItemRecord>();
  const [skillAction, setSkillAction] = useState("");
  const [skillError, setSkillError] = useState("");
  const tabs: Array<{ key: Tab; label: string; icon: typeof Wrench }> = [
    { key: "experts", label: "专家", icon: UserFocus },
    { key: "skills", label: "技能", icon: Wrench },
    { key: "connectors", label: "连接器", icon: LinkSimple },
  ];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredExperts = useMemo(() => experts.filter(expert => [expert.name, expert.role, expert.summary, expert.category, ...expert.tags].join(" ").toLowerCase().includes(normalizedQuery)), [normalizedQuery]);
  const filteredTeams = useMemo(() => expertTeams.filter(team => [team.name, team.summary, ...team.tags, ...team.members.flatMap(member => [member.name, member.role])].join(" ").toLowerCase().includes(normalizedQuery)), [normalizedQuery]);
  const filteredSkills = useMemo(() => skills.filter(item => [item.definition.name, item.definition.summary, item.definition.category, ...item.definition.capabilities].join(" ").toLowerCase().includes(normalizedQuery)), [normalizedQuery, skills]);
  const filteredConnectors = useMemo(() => connectors.filter(item => [item.definition.name, item.definition.summary, item.definition.category, ...item.definition.capabilities].join(" ").toLowerCase().includes(normalizedQuery)), [connectors, normalizedQuery]);
  const setActiveTab = (next: Tab) => { setTab(next); setQuery(""); setSelectedExpert(undefined); setSelectedTeam(undefined); setSelectedSkill(undefined); setSelectedConnector(undefined); setSkillError(""); };
  const actOnSkill = async (action: () => Promise<void>, skillId: string) => { setSkillAction(skillId); setSkillError(""); try { await action(); setSelectedSkill(undefined); } catch (error) { setSkillError(userFacingError(error, "技能状态更新失败，请重试")); } finally { setSkillAction(""); } };

  return <main className="resource-view page">
    <header className="resource-header">
      <div className="segmented">{tabs.map(({ key, label, icon: Icon }) => <button key={key} className={tab === key ? "selected" : ""} onClick={() => setActiveTab(key)}><Icon size={18} />{label}</button>)}</div>
      <label className="search"><MagnifyingGlass size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`搜索${tab === "experts" ? "专家或专家团" : tab === "skills" ? "技能" : "连接器"}`} /></label>
    </header>

    {tab === "experts" && selectedExpert && <ExpertDetail expert={selectedExpert} onBack={() => setSelectedExpert(undefined)} onUse={() => onUseExpert(selectedExpert.id)} />}
    {tab === "experts" && selectedTeam && <TeamDetail team={selectedTeam} onBack={() => setSelectedTeam(undefined)} onUse={() => onUseTeam(selectedTeam.id)} />}
    {tab === "experts" && !selectedExpert && !selectedTeam && <>
      <section className="resource-intro">
        <div><p>按任务选择</p><h1>需要专业分工时，再选择专家</h1><span>不选择时由牛马办公直接完成。选择专家后，只由该专家执行；选择专家团后，由固定成员分工协作。</span></div>
        <div className="resource-intro-icons"><UserFocus size={26} /><UsersThree size={29} /></div>
      </section>
      <div className="resource-kind-tabs" role="tablist" aria-label="专家类型">
        <button role="tab" aria-selected={kind === "single"} className={kind === "single" ? "selected" : ""} onClick={() => setKind("single")}>专家</button>
        <button role="tab" aria-selected={kind === "team"} className={kind === "team" ? "selected" : ""} onClick={() => setKind("team")}>专家团</button>
      </div>
      {kind === "single" && <>
        <div className="section-heading"><div><h2>专家</h2><p>职责、能力与权限范围固定，任务会记录所用版本</p></div></div>
        {filteredExperts.length ? <div className="expert-grid">{filteredExperts.map(expert => <button className="expert-card" key={expert.id} onClick={() => setSelectedExpert(expert)}>
          <span className="expert-avatar" style={{ background: expert.accent }}><UserFocus size={22} /></span>
          <div className="expert-card-copy"><span>{expert.category}</span><h3>{expert.name}</h3><strong>{expert.role}</strong><p>{expert.summary}</p><div className="tag-row">{expert.tags.map(tag => <span key={tag}>{tag}</span>)}</div></div>
        </button>)}</div> : <EmptySearch label="专家" />}
      </>}
      {kind === "team" && <>
        <div className="section-heading"><div><h2>专家团</h2><p>成员身份与职责长期固定，每位成员独立执行后由负责人汇总</p></div></div>
        {filteredTeams.length ? <div className="team-grid">{filteredTeams.map(team => <article className="team-card" key={team.id}>
          <div className="team-card-head"><span className="team-avatar large" style={{ background: team.accent }}><UsersThree size={23} /></span><div><h3>{team.name}</h3><p>{team.members.length} 位固定成员 · 版本 {team.version}</p></div><button onClick={() => setSelectedTeam(team)}>查看详情</button></div>
          <p>{team.summary}</p><div className="tag-row">{team.tags.map(tag => <span key={tag}>{tag}</span>)}</div><div className="member-row">{team.members.map(member => <span key={member.name}><i>{member.name.slice(0, 1)}</i>{member.name} · {member.role}</span>)}</div>
        </article>)}</div> : <EmptySearch label="专家团" />}
      </>}
    </>}

    {tab === "skills" && selectedSkill && <SkillDetail item={selectedSkill} busy={skillAction === selectedSkill.definition.id} error={skillError} onBack={() => { setSelectedSkill(undefined); setSkillError(""); }} onInstall={() => void actOnSkill(() => onInstallSkill(selectedSkill.definition.id), selectedSkill.definition.id)} onToggle={enabled => void actOnSkill(() => onSetSkillEnabled(selectedSkill.definition.id, enabled), selectedSkill.definition.id)} onUse={() => onUseSkill(selectedSkill.definition.id)} />}
    {tab === "skills" && !selectedSkill && <>
      <div className="section-heading"><div><h2>技能</h2><p>安装经过审核的固定版本技能，并在任务中按需启用</p></div></div>
      {filteredSkills.length ? <div className="simple-grid">{filteredSkills.map(item => <button className="skill-card" key={item.definition.id} onClick={() => setSelectedSkill(item)}><span className="simple-icon"><Wrench size={22} /></span><div><span className={`install-status ${item.installation?.status ?? "available"}`}>{item.installation?.status === "active" ? "已安装" : item.installation?.status === "disabled" ? "已停用" : item.installation?.status === "failed" ? "安装失败" : "可安装"}</span><h3>{item.definition.name}</h3><p>{item.definition.summary}</p><small>{item.definition.source} · {item.definition.version}</small></div></button>)}</div> : <EmptySearch label="技能" />}
    </>}
    {tab === "connectors" && selectedConnector && <ConnectorDetail item={selectedConnector} onBack={() => setSelectedConnector(undefined)} onConfigure={onConfigureRemoteConnector} onTest={onTestRemoteConnector} onToggle={onSetConnectorEnabled} />}
    {tab === "connectors" && !selectedConnector && <><div className="section-heading"><div><h2>连接器</h2><p>在明确权限范围内连接本地能力和外部服务</p></div></div>{filteredConnectors.length ? <div className="simple-grid">{filteredConnectors.map(item => <button className="skill-card" key={item.definition.id} onClick={() => setSelectedConnector(item)}><span className="simple-icon"><LinkSimple size={22} /></span><div><span className={`install-status ${item.installation.status}`}>{item.definition.kind === "builtin" ? "内置" : item.installation.status === "active" ? "已连接" : item.installation.status === "failed" ? "连接失败" : item.installation.endpoint ? "已停用" : "未配置"}</span><h3>{item.definition.name}</h3><p>{item.definition.summary}</p><small>{item.definition.source} · {item.definition.version}</small></div></button>)}</div> : <EmptySearch label="连接器" />}</>}
  </main>;
}

function SkillDetail({ item, busy, error, onBack, onInstall, onToggle, onUse }: { item: SkillCatalogItemRecord; busy: boolean; error: string; onBack: () => void; onInstall: () => void; onToggle: (enabled: boolean) => void; onUse: () => void }) {
  const { definition, installation } = item;
  const active = installation?.status === "active";
  return <section className="expert-detail skill-detail"><button className="back-button" onClick={onBack}><ArrowLeft size={17} />返回技能列表</button><header><span className="expert-avatar detail"><Wrench size={30} /></span><div><span>{definition.category} · 版本 {definition.version}</span><h1>{definition.name}</h1><p>{definition.summary}</p></div>{!installation || installation.status === "failed" ? <button className="primary-action" disabled={busy} onClick={onInstall}>{busy ? "正在安装…" : installation?.status === "failed" ? "重试安装" : "安装技能"}</button> : active ? <div className="skill-detail-actions"><button disabled={busy} onClick={() => onToggle(false)}>停用</button><button className="primary-action" disabled={busy} onClick={onUse}>用于新任务</button></div> : <button className="primary-action" disabled={busy} onClick={() => onToggle(true)}>{busy ? "正在启用…" : "重新启用"}</button>}</header>{(error || installation?.error) && <p className="skill-error" role="alert">{error || "上次安装未完成，可以重试。"}</p>}<div className="expert-detail-grid"><article><h2>来源与许可</h2><p>来源：{definition.source}</p><p>License：{definition.license}</p><p>固定版本：{definition.version}</p>{installation?.previousVersion && <p>已从 {installation.previousVersion} 升级</p>}</article><article><h2><CheckCircle size={18} />工作能力</h2><ul>{definition.capabilities.map(item => <li key={item}>{item}</li>)}</ul></article><article><h2><ShieldCheck size={18} />权限与依赖</h2><ul>{definition.permissions.map(item => <li key={item}>{permissionLabel(item)}</li>)}</ul><small>{definition.dependencies.length ? `依赖：${definition.dependencies.join("、")}` : "无额外依赖"}。权限不会超过当前任务选择的权限模式。</small></article></div></section>;
}

function permissionLabel(value: string) { return ({ "workspace.read": "读取当前工作空间", "workspace.write": "在当前工作空间创建文件", "network.public": "访问公开网页", "command.execute": "运行经确认的本地命令", "external.send": "向外部服务发送内容", "workspace.outside": "访问工作空间外路径" } as Record<string, string>)[value] ?? value; }

function ConnectorDetail({ item, onBack, onConfigure, onTest, onToggle }: { item: ConnectorCatalogItemRecord; onBack: () => void; onConfigure: Props["onConfigureRemoteConnector"]; onTest: Props["onTestRemoteConnector"]; onToggle: Props["onSetConnectorEnabled"] }) {
  const [displayName, setDisplayName] = useState(item.installation.displayName);
  const [endpoint, setEndpoint] = useState(item.installation.endpoint || "");
  const [transport, setTransport] = useState<"streamable-http" | "sse">(item.installation.transport || "streamable-http");
  const [credential, setCredential] = useState("");
  const [clearCredential, setClearCredential] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "toggle" | "">("");
  const [message, setMessage] = useState("");
  const [latest, setLatest] = useState(item);
  const configure = async () => { setBusy("save"); setMessage(""); try { const result = await onConfigure({ displayName, endpoint, transport, credential: credential || undefined, clearCredential }); if (result) setLatest(result); setCredential(""); setMessage("配置已安全保存，请进行连接测试。"); } catch (error) { setMessage(userFacingError(error, "配置保存失败，请重试")); } finally { setBusy(""); } };
  const test = async () => { setBusy("test"); setMessage(""); try { const result = await onTest(); if (result) { setLatest(result); setMessage(result.installation.lastTest?.message || "连接测试完成。"); } } catch (error) { setMessage(userFacingError(error, "连接测试失败，请重试")); } finally { setBusy(""); } };
  const toggle = async () => { setBusy("toggle"); setMessage(""); try { await onToggle(latest.definition.id, latest.installation.status !== "active"); onBack(); } catch (error) { setMessage(userFacingError(error, "状态更新失败，请重试")); } finally { setBusy(""); } };
  return <section className="expert-detail connector-detail"><button className="back-button" onClick={onBack}><ArrowLeft size={17} />返回连接器列表</button><header><span className="expert-avatar detail"><LinkSimple size={30} /></span><div><span>{latest.definition.category} · 版本 {latest.definition.version}</span><h1>{latest.definition.name}</h1><p>{latest.definition.summary}</p></div>{latest.definition.kind === "builtin" ? <span className="builtin-state"><CheckCircle size={17} />已就绪</span> : latest.installation.endpoint && <button disabled={Boolean(busy)} onClick={() => void toggle()}>{latest.installation.status === "active" ? "停用" : "重新启用"}</button>}</header>{message && <p className={latest.installation.lastTest?.state === "success" ? "connector-message success" : "connector-message"} role="status">{message}</p>}<div className="expert-detail-grid"><article><h2>来源与许可</h2><p>来源：{latest.definition.source}</p><p>License：{latest.definition.license}</p><p>固定版本：{latest.definition.version}</p></article><article><h2><CheckCircle size={18} />工作能力</h2><ul>{latest.definition.capabilities.map(value => <li key={value}>{value}</li>)}</ul></article><article><h2><ShieldCheck size={18} />权限范围</h2><ul>{latest.definition.permissions.map(value => <li key={value}>{connectorPermissionLabel(value)}</li>)}</ul><small>外部发送、删除、购买和其他不可逆操作不在通用远程 MCP 的开放范围内。</small></article></div>{latest.definition.kind === "remote_mcp" && <section className="connector-form"><h2>连接配置</h2><p>只支持 HTTPS 的 Streamable HTTP 或 SSE 服务。凭证使用 macOS 系统加密能力保存，界面不会再次显示原文。</p><div className="connector-form-grid"><label>显示名称<input value={displayName} onChange={event => setDisplayName(event.target.value)} /></label><label>传输方式<select value={transport} onChange={event => setTransport(event.target.value as typeof transport)}><option value="streamable-http">Streamable HTTP</option><option value="sse">SSE</option></select></label><label className="wide">MCP 地址<input value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="https://example.com/mcp" /></label><label className="wide">访问凭证<input type="password" value={credential} onChange={event => setCredential(event.target.value)} placeholder={latest.installation.hasCredential ? "已保存；留空则保持不变" : "没有凭证可留空"} /></label>{latest.installation.hasCredential && <label className="connector-clear"><input type="checkbox" checked={clearCredential} onChange={event => setClearCredential(event.target.checked)} />删除已保存的凭证</label>}</div><div className="connector-form-actions"><button disabled={Boolean(busy) || !displayName.trim() || !endpoint.trim()} onClick={() => void configure()}>{busy === "save" ? "正在保存…" : "保存配置"}</button><button className="primary-action" disabled={Boolean(busy) || !latest.installation.endpoint && endpoint !== item.installation.endpoint} onClick={() => void test()}>{busy === "test" ? "正在测试…" : "测试连接"}</button></div>{latest.installation.lastTest && <small className={`test-result ${latest.installation.lastTest.state}`}>{latest.installation.lastTest.message} · {new Date(latest.installation.lastTest.testedAt).toLocaleString("zh-CN")}</small>}</section>}</section>;
}

function connectorPermissionLabel(value: string) { return ({ "workspace.read": "读取当前工作空间", "workspace.write": "在当前工作空间创建文件", "network.public": "访问网络", "external.read": "读取外部服务数据", "external.send": "向外部服务发送内容", "external.delete": "删除外部数据", purchase: "发起购买" } as Record<string, string>)[value] ?? value; }

function userFacingError(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "").trim() || fallback;
}

function ExpertDetail({ expert, onBack, onUse }: { expert: ExpertRecord; onBack: () => void; onUse: () => void }) {
  return <section className="expert-detail">
    <button className="back-button" onClick={onBack}><ArrowLeft size={17} />返回专家列表</button>
    <header><span className="expert-avatar detail" style={{ background: expert.accent }}><UserFocus size={30} /></span><div><span>{expert.category} · 版本 {expert.version}</span><h1>{expert.name}</h1><p>{expert.role}</p></div><button className="primary-action" onClick={onUse}>使用此专家</button></header>
    <div className="expert-detail-grid">
      <article><h2>专家说明</h2><p>{expert.summary}</p><p>{expert.instructions}</p></article>
      <article><h2><CheckCircle size={18} />工作能力</h2><ul>{expert.capabilities.map(item => <li key={item}>{item}</li>)}</ul></article>
      <article><h2><ShieldCheck size={18} />权限范围</h2><ul>{expert.permissions.map(item => <li key={item}>{item}</li>)}</ul><small>涉及工作空间外访问、外部发送或不可逆操作时，仍会按任务权限规则请求确认。</small></article>
    </div>
  </section>;
}

function TeamDetail({ team, onBack, onUse }: { team: TeamRecord; onBack: () => void; onUse: () => void }) {
  return <section className="expert-detail team-detail">
    <button className="back-button" onClick={onBack}><ArrowLeft size={17} />返回专家团列表</button>
    <header><span className="expert-avatar detail" style={{ background: team.accent }}><UsersThree size={31} /></span><div><span>固定专家团 · 版本 {team.version}</span><h1>{team.name}</h1><p>{team.summary}</p></div><button className="primary-action" onClick={onUse}>使用此专家团</button></header>
    <div className="team-member-list"><h2>固定成员与职责</h2>{team.members.map((member, index) => <article key={member.id}><i>{index + 1}</i><div><strong>{member.name} · {member.role}</strong><p>{member.responsibility}</p></div></article>)}</div>
    <div className="expert-detail-grid team-boundaries">
      <article><h2><CheckCircle size={18} />协作能力</h2><ul>{team.capabilities.map(item => <li key={item}>{item}</li>)}</ul></article>
      <article><h2><ShieldCheck size={18} />权限范围</h2><ul>{team.permissions.map(item => <li key={item}>{item}</li>)}</ul><small>所有成员共用本任务的权限设置，不会因成员分工扩大授权。</small></article>
    </div>
  </section>;
}

function EmptySearch({ label }: { label: string }) {
  return <div className="resource-empty"><MagnifyingGlass size={24} /><strong>没有找到相关{label}</strong><span>请尝试名称、职责或能力关键词。</span></div>;
}
