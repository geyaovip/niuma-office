export type OpenClawCapabilityDisposition = "native" | "adapted" | "niuma_owned" | "disabled_by_scope";

export interface OpenClawCapabilityPolicy {
  id: string;
  disposition: OpenClawCapabilityDisposition;
  surfaces: string[];
  reason: string;
}
/** Code-level coverage ledger for the pinned OpenClaw 2026.8.x runtime. */
export const OPENCLAW_2_CAPABILITIES: readonly OpenClawCapabilityPolicy[] = [
  { id: "sessions", disposition: "native", surfaces: ["sessions_search", "session_status"], reason: "Gateway sessions remain internal and are mapped back to Niuma Tasks." },
  { id: "progress-and-questions", disposition: "native", surfaces: ["progress_card", "ask_user"], reason: "Durable progress and structured questions are normalized into Task state." },
  { id: "workspace-files", disposition: "adapted", surfaces: ["read", "write", "edit", "apply_patch"], reason: "Native file tools run only inside the selected or managed Workspace." },
  { id: "local-process", disposition: "adapted", surfaces: ["exec", "process"], reason: "Native execution is guarded by Niuma permissions and workspace-only policy." },
  { id: "research", disposition: "native", surfaces: ["web_search", "web_fetch", "view_image"], reason: "Native research and media reading fit the current product scope." },
  { id: "subagents", disposition: "adapted", surfaces: ["sessions_spawn", "agents_wait", "subagents"], reason: "Native child agents are available while fixed expert identities remain Niuma-owned." },
  { id: "automation", disposition: "niuma_owned", surfaces: ["automations"], reason: "Niuma owns scheduling, offline recovery, permission scope and run history." },
  { id: "channels", disposition: "niuma_owned", surfaces: ["message", "conversations_send", "conversations_turn"], reason: "Feishu and Telegram use Niuma pairing, identity, idempotency and audit contracts." },
  { id: "credentials", disposition: "niuma_owned", surfaces: ["secrets"], reason: "Customer credentials stay inside the Niuma local credential boundary." },
  { id: "interactive-boards", disposition: "disabled_by_scope", surfaces: ["dashboard", "show_widget"], reason: "Runtime boards would bypass the Niuma result container and are not exposed yet." },
  { id: "browser-and-terminal-ui", disposition: "disabled_by_scope", surfaces: ["browser", "screen", "terminal", "portal"], reason: "Raw browser, terminal, portal and control surfaces are not customer-facing." },
  { id: "remote-devices", disposition: "disabled_by_scope", surfaces: ["nodes", "computer", "mobile_ui"], reason: "Remote devices and cloud workers are outside the macOS internal release scope." },
  { id: "external-publishing", disposition: "disabled_by_scope", surfaces: ["github_publish"], reason: "Publishing is an irreversible external write without a reviewed customer workflow." },
] as const;

const alwaysDenied = OPENCLAW_2_CAPABILITIES
  .filter(item => item.disposition === "niuma_owned" || item.disposition === "disabled_by_scope")
  .flatMap(item => item.surfaces);

export function openClawToolPolicy(permissionMode: "restricted" | "default" | "full") {
  const restricted = permissionMode === "restricted";
  const nativeAndAdapted = OPENCLAW_2_CAPABILITIES
    .filter(item => item.disposition === "native" || item.disposition === "adapted")
    .flatMap(item => item.surfaces);
  const restrictedDenied = ["write", "edit", "apply_patch", "exec", "process", "sessions_spawn", "agents_wait", "subagents", "web_search", "web_fetch"];
  return {
    allow: [...new Set(nativeAndAdapted.filter(surface => !restricted || !restrictedDenied.includes(surface)))],
    deny: [...new Set([...alwaysDenied, ...(restricted ? restrictedDenied : [])])],
  };
}
