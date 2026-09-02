import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTelegramEnvelope, parseTelegramUpdate, TelegramClient } from "./telegram.js";

describe("Telegram adapter", () => {
  it("parses private pairing and tasks, and ignores groups", () => {
    expect(parseTelegramUpdate({ update_id: 1, message: { message_id: 1, date: 1, text: `/start ${"a".repeat(43)}`, chat: { id: 7, type: "private" }, from: { id: 9, is_bot: false } } })).toMatchObject({ kind: "pair", userId: "9", chatId: "7" });
    expect(parseTelegramUpdate({ update_id: 2, message: { message_id: 2, date: 1, text: "整理今天的会议纪要", chat: { id: 7, type: "private" }, from: { id: 9, is_bot: false } } })).toMatchObject({ kind: "task", providerEventId: "2" });
    expect(parseTelegramUpdate({ update_id: 3, message: { message_id: 3, date: 1, text: "hello", chat: { id: -7, type: "group" }, from: { id: 9, is_bot: false } } })).toMatchObject({ kind: "ignore", reason: "private_only" });
  });
  it("creates a provider-neutral idempotent envelope", () => { const binding = { id: randomUUID(), channel: "telegram" as const, channelUserId: "9", chatId: "7", deviceInstallationId: randomUUID(), scope: "direct" as const, status: "active" as const, createdAt: new Date().toISOString(), lastVerifiedAt: new Date().toISOString() }; const envelope = createTelegramEnvelope({ kind: "task", providerEventId: "42", userId: "9", chatId: "7", text: "写周报" }, binding); expect(envelope).toMatchObject({ channel: "telegram", kind: "task.create", text: "写周报", bindingId: binding.id }); expect(envelope.idempotencyKey).toHaveLength(64); });
  it("uses the official deep link and reports API failures without leaking the token", async () => { const requests: string[] = []; const client = new TelegramClient("secret-token-value-123456", "NiumaOfficeBot", async input => { requests.push(String(input)); return new Response("{}", { status: 500 }); }); expect(client.deepLink("pair_abc")).toBe("https://t.me/NiumaOfficeBot?start=pair_abc"); await expect(client.sendMessage("7", "hello")).rejects.toThrow("Telegram 消息发送失败 (500)"); expect(requests[0]).toContain("secret-token-value"); });
});
