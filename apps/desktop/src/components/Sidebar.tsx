import { Books, ClockCounterClockwise, FolderSimple, MagnifyingGlass, PlusCircle, UsersThree, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { TaskRecord, ViewKey } from "../types";

const nav = [
  { key: "new-task" as const, label: "新建任务", icon: PlusCircle },
  { key: "projects" as const, label: "项目", icon: FolderSimple },
  { key: "resources" as const, label: "专家 · 技能 · 连接器", icon: UsersThree },
  { key: "automation" as const, label: "自动化", icon: ClockCounterClockwise },
  { key: "knowledge" as const, label: "资料库", icon: Books },
];

interface Props {
  current: ViewKey;
  activeTaskId?: string;
  tasks: TaskRecord[];
  searchRequest: number;
  onSearch: (query: string) => Promise<string[]>;
  onNavigate: (view: ViewKey) => void;
  onTask: (id: string) => void;
  onAccount: () => void;
}

function formatTaskTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

export function Sidebar({ current, activeTaskId, tasks, searchRequest, onSearch, onNavigate, onTask, onAccount }: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [runtimeMatchIds, setRuntimeMatchIds] = useState<string[]>([]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTasks = useMemo(() => {
    if (!normalizedQuery) return tasks;
    const runtimeMatches = new Set(runtimeMatchIds);
    return tasks.filter(task => `${task.title}${task.prompt}`.toLowerCase().includes(normalizedQuery) || runtimeMatches.has(task.id));
  }, [tasks, normalizedQuery, runtimeMatchIds]);
  useEffect(() => { if (searchRequest > 0) setSearchOpen(true); }, [searchRequest]);
  useEffect(() => {
    if (!normalizedQuery) { setRuntimeMatchIds([]); return; }
    let current = true;
    const timer = window.setTimeout(() => {
      void onSearch(query).then(ids => { if (current) setRuntimeMatchIds(ids); }).catch(() => { if (current) setRuntimeMatchIds([]); });
    }, 220);
    return () => { current = false; window.clearTimeout(timer); };
  }, [normalizedQuery, onSearch, query]);
  return <aside className="sidebar">
    <div className="window-grab" />
    <div className="sidebar-tools">{searchOpen ? <label className="sidebar-search"><MagnifyingGlass size={16} /><input autoFocus aria-label="搜索任务" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索任务" /><button aria-label="关闭搜索" onClick={() => { setSearchOpen(false); setQuery(""); }}><X size={15} /></button></label> : <><button aria-label="搜索" onClick={() => setSearchOpen(true)}><MagnifyingGlass size={18} /></button><img src="./brand/niuma-mascot-mark-v3.png" alt="" /><span className="brand-word">牛马办公</span></>}</div>
    <nav className="primary-nav">
      {nav.map(({ key, label, icon: Icon }) => <button key={key} className={current === key ? "nav-item active" : "nav-item"} onClick={() => onNavigate(key)}><Icon size={20} /><span>{label}</span></button>)}
    </nav>
    <div className="sidebar-section-title"><span>最近</span>{tasks.length > 0 && <span>{tasks.length}</span>}</div>
    <div className="task-list">
      {filteredTasks.map(task => <button key={task.id} className={current === "task" && activeTaskId === task.id ? "task-row active" : "task-row"} onClick={() => onTask(task.id)}><span className={`status-dot ${task.status}`} /><span className="task-row-title">{task.title}</span><time dateTime={task.createdAt}>{formatTaskTime(task.createdAt)}</time></button>)}
      {searchOpen && query && filteredTasks.length === 0 && <p className="sidebar-empty">没有找到相关任务</p>}
    </div>
    <button className="profile-entry" onClick={onAccount}>
      <img className="profile-logo" src="./brand/niuma-mascot-mark-v3.png" alt="" /><span><strong>本地体验用户</strong><small>内部体验版</small></span>
    </button>
  </aside>;
}
