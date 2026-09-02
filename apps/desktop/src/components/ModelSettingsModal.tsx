import { CheckCircle, Cube, FolderOpen, HardDrives, LockKey, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { WorkspaceSettingsRecord } from "../types";

const defaultSettings: NiumaModelSettings = {
  provider: "volcengine",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  modelId: "",
  displayName: "自定义模型",
  hasApiKey: false,
};

export function ModelSettingsModal({ onClose, initialSection = "model", workspaceSettings, onChooseWorkspace }: { onClose: () => void; initialSection?: "model" | "workspace"; workspaceSettings: WorkspaceSettingsRecord; onChooseWorkspace: () => Promise<boolean> }) {
  const [section, setSection] = useState<"model" | "workspace">(initialSection);
  const [settings, setSettings] = useState(defaultSettings);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [choosingWorkspace, setChoosingWorkspace] = useState(false);

  useEffect(() => { if (window.niuma) void window.niuma.getModelSettings().then(setSettings); }, []);

  const save = async () => {
    setSaving(true); setMessage("");
    try {
      if (window.niuma) setSettings(await window.niuma.saveModelSettings({ baseUrl: settings.baseUrl, modelId: settings.modelId, displayName: settings.displayName, apiKey }));
      else setSettings(current => ({ ...current, hasApiKey: Boolean(apiKey) || current.hasApiKey }));
      setApiKey(""); setMessage("自定义模型已保存");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败，请稍后重试"); }
    finally { setSaving(false); }
  };

  const clearKey = async () => {
    if (!window.niuma) return setSettings(current => ({ ...current, hasApiKey: false }));
    setSettings(await window.niuma.saveModelSettings({ baseUrl: settings.baseUrl, modelId: settings.modelId, displayName: settings.displayName, clearApiKey: true }));
    setMessage("自定义模型已停用");
  };

  const chooseWorkspace = async () => { setChoosingWorkspace(true); setMessage(""); try { if (await onChooseWorkspace()) setMessage("默认工作空间已更新，新建任务和项目将使用该目录"); } catch (error) { setMessage(error instanceof Error ? error.message : "无法更新工作空间"); } finally { setChoosingWorkspace(false); } };

  return <><button className="modal-scrim" aria-label="关闭设置" onClick={onClose} /><section className="settings-window" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <nav className="settings-nav"><h2>设置</h2><button className={section === "model" ? "selected" : ""} onClick={() => { setSection("model"); setMessage(""); }}><Cube size={19} /><span>模型</span></button><button className={section === "workspace" ? "selected" : ""} onClick={() => { setSection("workspace"); setMessage(""); }}><HardDrives size={19} /><span>文件与工作空间</span></button></nav>
    {section === "model" ? <main className="settings-content"><header><div><h2 id="settings-title">模型</h2><p>平台模型由牛马办公统一提供，无需配置接入方式。</p></div><button aria-label="关闭" onClick={onClose}><X size={20} /></button></header>
      <section className="platform-model-note"><div><strong>平台模型</strong><p>在任务输入框中使用 Auto，牛马办公会根据任务自动选择。</p></div><span>已托管</span></section>
      <div className="settings-section-title"><div><strong>自定义模型</strong><p>仅在你希望使用自己的模型额度时配置，密钥只保存在本机。</p></div></div>
      <div className="custom-model-form">
        <label><span>提供商</span><input value="火山方舟（自定义）" disabled /></label>
        <label><span>显示名称</span><input value={settings.displayName} onChange={e => setSettings(current => ({ ...current, displayName: e.target.value }))} placeholder="例如：我的办公模型" /></label>
        <label><span>模型 ID / 推理接入点 ID</span><input value={settings.modelId} onChange={e => setSettings(current => ({ ...current, modelId: e.target.value }))} placeholder="请输入控制台中的模型或接入点 ID" /></label>
        <label><span>API Key</span><div className="secret-field"><LockKey size={17} /><input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={settings.hasApiKey ? "已保存；留空则保持不变" : "请输入 API Key"} /></div></label>
        <div className="key-status"><span className={settings.hasApiKey ? "connected" : ""}>{settings.hasApiKey ? <CheckCircle size={17} weight="fill" /> : <LockKey size={17} />}{settings.hasApiKey ? "密钥已由 macOS 安全保存" : "尚未添加自定义模型"}</span>{settings.hasApiKey && <button onClick={clearKey}>停用</button>}</div>
        {message && <p className="settings-message">{message}</p>}
      </div>
      <footer><button onClick={onClose}>取消</button><button className="primary" disabled={saving || !settings.displayName.trim() || !settings.modelId.trim() || (!settings.hasApiKey && !apiKey.trim())} onClick={save}>{saving ? "保存中…" : "保存"}</button></footer>
    </main> : <main className="settings-content"><header><div><h2 id="settings-title">文件与工作空间</h2><p>不选择文件夹也可以直接工作，牛马办公会使用默认目录。</p></div><button aria-label="关闭" onClick={onClose}><X size={20} /></button></header><section className={`workspace-setting-card ${workspaceSettings.status === "needs_reauthorization" ? "warning" : ""}`}><span className="workspace-setting-icon">{workspaceSettings.status === "needs_reauthorization" ? <WarningCircle size={23} /> : <FolderOpen size={23} />}</span><div><strong>默认工作空间</strong><p>{workspaceSettings.defaultRootPath || "正在准备默认目录…"}</p><small>{workspaceSettings.status === "needs_reauthorization" ? "当前目录不可访问，请重新选择。历史任务和项目不会被移动。" : "新建的独立任务和未指定目录的项目会保存在这里。修改后不会移动历史文件。"}</small></div></section>{message && <p className="settings-message workspace-message">{message}</p>}<div className="workspace-setting-actions"><button onClick={() => window.niuma?.openPath(workspaceSettings.defaultRootPath)} disabled={workspaceSettings.status !== "ready" || !workspaceSettings.defaultRootPath}>在访达中打开</button><button className="primary" disabled={choosingWorkspace} onClick={() => void chooseWorkspace()}>{choosingWorkspace ? "等待选择…" : workspaceSettings.status === "needs_reauthorization" ? "重新选择目录" : "更改默认目录"}</button></div></main>}
  </section></>;
}
