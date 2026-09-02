import { describe, expect, it } from "vitest";
import { OPENCLAW_2_CAPABILITIES, openClawToolPolicy } from "./openclaw-capability-policy";

describe("OpenClaw 2.0 capability policy", () => {
  it("classifies every declared surface exactly once", () => {
    const surfaces = OPENCLAW_2_CAPABILITIES.flatMap(item => item.surfaces);
    expect(new Set(surfaces).size).toBe(surfaces.length);
    expect(OPENCLAW_2_CAPABILITIES.every(item => item.reason.length > 20)).toBe(true);
  });

  it("enables reviewed native capabilities without exposing Niuma-owned surfaces", () => {
    const policy = openClawToolPolicy("default");
    expect(policy.allow).toEqual(expect.arrayContaining(["progress_card", "ask_user", "sessions_search", "sessions_spawn", "web_search"]));
    expect(policy.deny).toEqual(expect.arrayContaining(["automations", "message", "secrets", "dashboard", "nodes"]));
    expect(policy.allow.some(item => policy.deny.includes(item))).toBe(false);
  });

  it("restricted mode removes writes, process execution, research and child agents", () => {
    const policy = openClawToolPolicy("restricted");
    expect(policy.allow).toEqual(expect.arrayContaining(["read", "progress_card", "ask_user", "sessions_search", "session_status", "view_image"]));
    expect(policy.allow).not.toEqual(expect.arrayContaining(["write", "exec", "sessions_spawn", "web_search"]));
    expect(policy.deny).toEqual(expect.arrayContaining(["write", "exec", "sessions_spawn", "web_search"]));
  });
});
