import { ArrowClockwise, ArrowLeft, CheckCircle, FolderOpen, Gear, HardDrives, Moon, PaperPlaneTilt, Question, Sun, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { ChannelStatusRecord, TelegramPairingRecord } from "../types";

type Appearance = "system" | "light" | "dark";

export function AccountMenu({ onClose, onSettings, runtimeStatus }: { onClose: () => void; onSettings: () => void; runtimeStatus: NiumaRuntimeStatus }) {
  const available = runtimeStatus.state !== "failed" && runtimeStatus.state !== "unavailable";
  const [appearance, setAppearance] = useState<Appearance>("system");
  const [dataInfo, setDataInfo] = useState<NiumaDataInfo>();
  const [update, setUpdate] = useState<NiumaUpdateStatus>();
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);

  useEffect(() => {
    if (!window.niuma) return;
    void window.niuma.getPreferences().then(value => setAppearance(value.appearance));
    void window.niuma.getDataInfo().then(setDataInfo);
  }, []);

  const chooseAppearance = async (value: Appearance) => {
    setMessage("");
    try {
      const saved = window.niuma ? await window.niuma.saveAppearance(value) : { appearance: value };
      setAppearance(saved.appearance);
      applyAppearance(saved.appearance);
    } catch { setMessage("无法保存外观设置，请稍后重试。"); }
  };
  const openData = async () => { setMessage(""); try { await window.niuma?.openDataDirectory(); } catch (error) { setMessage(error instanceof Error ? error.message : "无法打开本地数据目录"); } };
  const checkUpdate = async () => { if (!window.niuma) return; setChecking(true); setMessage(""); try { setUpdate(await window.niuma.checkUpdate()); } catch { setUpdate({ state: "failed", currentVersion: "0.1.0", message: "暂时无法检查更新，请稍后重试。" }); } finally { setChecking(false); } };

  if (helpOpen) return <><button className="menu-scrim" aria-label="关闭帮助" onClick={onClose} /><aside className="account-menu help-panel" aria-label="帮助与反馈"><header><button onClick={() => { setHelpOpen(false); setMessage(""); }}><ArrowLeft size={17} />返回</button><strong>帮助与反馈</strong></header><section><h3>任务没有继续执行</h3><p>先确认 Mac 已联网且没有休眠，再查看任务页是否正在等待权限确认。可以在任务页重新运行当前轮，历史结果不会被覆盖。</p></section><section><h3>找不到交付文件</h3><p>在任务的交付文件卡片中选择“在访达中显示”。如果工作空间不可访问，请在设置中重新选择目录。</p></section><section><h3>提交问题时提供</h3><p>请提供牛马办公版本、问题发生时间、任务标题和复现步骤。诊断记录默认不包含模型密钥。</p><button onClick={() => void window.niuma?.openDiagnostics().catch(() => setMessage("无法打开诊断记录，请稍后重试。"))}><FolderOpen size={15} />打开诊断记录</button></section>{message && <p className="account-message">{message}</p>}<p className="account-version">牛马办公 0.1.0 内部体验版</p></aside></>;
  if (channelsOpen) return <ChannelPanel onBack={() => { setChannelsOpen(false); setMessage(""); }} onClose={onClose} />;

  return <><button className="menu-scrim" aria-label="关闭个人中心" onClick={onClose} /><aside className="account-menu" aria-label="个人中心">
    <div className="account-head"><img className="account-logo" src="./brand/niuma-mascot-mark-v3.png" alt="" /><div><strong>本地体验用户</strong><small>内部体验版</small></div></div>
    <div className="account-group"><button onClick={onSettings}><Gear size={20} /><span>设置</span><small>模型与工作空间</small></button><button onClick={() => setChannelsOpen(true)}><PaperPlaneTilt size={20} /><span>消息渠道</span><small>Telegram</small></button></div>
    <div className="account-section"><div className="account-section-title"><span><Sun size={18} />外观</span><small>{appearance === "system" ? "跟随系统" : appearance === "light" ? "浅色" : "深色"}</small></div><div className="appearance-control"><button className={appearance === "system" ? "selected" : ""} onClick={() => void chooseAppearance("system")}>自动</button><button className={appearance === "light" ? "selected" : ""} onClick={() => void chooseAppearance("light")}><Sun size={14} />浅色</button><button className={appearance === "dark" ? "selected" : ""} onClick={() => void chooseAppearance("dark")}><Moon size={14} />深色</button></div></div>
    <div className="account-runtime"><span className={available ? "available" : "unavailable"}>{available ? <CheckCircle size={18} weight="fill" /> : <WarningCircle size={18} weight="fill" />}</span><div><strong>本地执行服务</strong><small>{available ? runtimeStatus.message || "可用" : runtimeStatus.message || "暂不可用"}</small></div></div>
    <div className="account-section account-data"><div className="account-section-title"><span><HardDrives size={18} />本地数据</span><small>{dataInfo ? formatSize(dataInfo.size) : "计算中…"}</small></div><p title={dataInfo?.path}>{dataInfo?.path || "正在读取数据目录…"}</p><button disabled={!dataInfo} onClick={() => void openData()}><FolderOpen size={15} />在访达中打开</button></div>
    <div className="account-section update-section"><button className="update-button" disabled={checking} onClick={() => void checkUpdate()}><ArrowClockwise size={17} className={checking ? "spin" : ""} /><span>{checking ? "正在检查更新…" : "检查更新"}</span><small>0.1.0</small></button>{update && <p className={`update-message ${update.state}`}>{update.message}</p>}</div>
    <div className="account-group"><button onClick={() => setHelpOpen(true)}><Question size={20} /><span>帮助与反馈</span><small>排查问题与诊断记录</small></button></div>
    {message && <p className="account-message">{message}</p>}
    <p className="account-version">牛马办公 0.1.0 内部体验版</p>
  </aside></>;
}

function ChannelPanel({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [status, setStatus] = useState<ChannelStatusRecord>(); const [pairing, setPairing] = useState<TelegramPairingRecord>(); const [qr, setQr] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const refresh = async () => { if (!window.niuma) return; try { setStatus(await window.niuma.getChannelStatus()); } catch (error) { setMessage(error instanceof Error ? error.message : "无法读取渠道状态"); } };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (!pairing || !["pending", "scanned", "confirmed"].includes(pairing.session.status)) return; const timer = window.setInterval(() => { void window.niuma?.getTelegramPairing(pairing.session.id).then(session => { setPairing(current => current ? { ...current, session } : current); if (session.status === "consumed") { setPairing(undefined); setQr(""); setMessage("Telegram 已连接，可以直接发送工作要求。"); void refresh(); } }).catch(error => setMessage(error instanceof Error ? error.message : "无法刷新扫码状态")); }, 2_000); return () => window.clearInterval(timer); }, [pairing?.session.id, pairing?.session.status]);
  const startPairing = async () => { if (!window.niuma) return; setBusy(true); setMessage(""); try { const created = await window.niuma.createTelegramPairing(); setPairing(created); setQr(await QRCode.toDataURL(created.deepLink, { width: 240, margin: 1, errorCorrectionLevel: "M", color: { dark: "#171717", light: "#ffffff" } })); } catch (error) { setMessage(error instanceof Error ? error.message : "无法创建扫码"); } finally { setBusy(false); } };
  const cancel = async () => { if (!pairing || !window.niuma) return; await window.niuma.cancelTelegramPairing(pairing.session.id).catch(() => undefined); setPairing(undefined); setQr(""); };
  const binding = status?.bindings.find(item => item.channel === "telegram" && item.status === "active");
  const pairingActive = pairing && ["pending", "scanned", "confirmed"].includes(pairing.session.status);
  return <><button className="menu-scrim" aria-label="关闭消息渠道" onClick={onClose} /><aside className="account-menu channel-panel" aria-label="消息渠道"><header><button onClick={onBack}><ArrowLeft size={17} />返回</button><strong>消息渠道</strong></header><section className="channel-intro"><h3>从手机交给 Mac 处理</h3><p>连接后，在 Telegram 私聊发送工作要求，会在这台 Mac 上创建任务。</p></section><section className="channel-card"><div className="channel-card-title"><PaperPlaneTilt size={24} weight="fill" /><div><strong>Telegram</strong><small>{binding ? "已连接" : status?.configured ? "未连接" : "服务尚未配置"}</small></div><span className={binding ? "connected" : ""}>{binding ? "可用" : "未连接"}</span></div>{binding ? <><p>已连接 Telegram 私聊。任务会在本机执行，涉及高风险操作时仍需要你确认。</p><button className="channel-danger" onClick={() => { if (window.confirm("解除 Telegram 连接？之后发送的消息不会再创建任务。")) void window.niuma?.revokeChannelBinding(binding.id).then(() => refresh()); }}>解除连接</button></> : pairingActive && qr ? <div className="pairing-box"><img src={qr} alt="Telegram 连接二维码" /><strong>使用手机扫码</strong><p>二维码 5 分钟内有效。在 Telegram 中打开后点击 Start 完成连接。</p><div><button onClick={() => void window.niuma?.openExternal(pairing.deepLink)}>在 Telegram 打开</button><button onClick={() => void cancel()}><X size={14} />取消</button></div></div> : pairing && ["expired", "failed", "cancelled"].includes(pairing.session.status) ? <div className="pairing-ended"><WarningCircle size={20} /><strong>{pairing.session.status === "expired" ? "二维码已过期" : "本次连接未完成"}</strong><p>请重新生成二维码后再试。</p><button disabled={busy} onClick={() => void startPairing()}>重新生成</button></div> : <><p>二维码只包含一次性连接凭证，不包含 Bot Token 或你的账号密钥。</p><button disabled={busy || !status?.configured} onClick={() => void startPairing()}>{busy ? "正在生成…" : "扫码连接"}</button></>}</section>{message && <p className="account-message">{message}</p>}<p className="account-version">牛马办公 0.1.0 内部体验版</p></aside></>;
}

function applyAppearance(appearance: Appearance) {
  const effective = appearance === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : appearance;
  document.documentElement.dataset.theme = effective;
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
