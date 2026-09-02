import { createHash, randomUUID } from "node:crypto";
import { channelEnvelopeSchema, type ChannelBinding, type ChannelEnvelope } from "@niuma/contracts";

export interface TelegramUpdate { update_id: number; message?: { message_id: number; date: number; text?: string; chat: { id: number; type: string }; from?: { id: number; is_bot: boolean; first_name?: string; username?: string } } }
export type TelegramAction = { kind: "pair"; token: string; userId: string; chatId: string } | { kind: "task"; providerEventId: string; userId: string; chatId: string; text: string } | { kind: "ignore"; reason: string };

export function parseTelegramUpdate(update: TelegramUpdate): TelegramAction {
  if (!Number.isSafeInteger(update.update_id) || !update.message?.from || update.message.from.is_bot) return { kind: "ignore", reason: "unsupported_update" };
  const message = update.message; const sender = message.from; if (!sender || message.chat.type !== "private") return { kind: "ignore", reason: "private_only" };
  const text = message.text?.trim() ?? ""; const start = text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{32,128})$/);
  if (start?.[1]) return { kind: "pair", token: start[1], userId: String(sender.id), chatId: String(message.chat.id) };
  if (!text || text.startsWith("/")) return { kind: "ignore", reason: "empty_or_command" };
  return { kind: "task", providerEventId: String(update.update_id), userId: String(sender.id), chatId: String(message.chat.id), text: text.slice(0, 20_000) };
}

export function createTelegramEnvelope(action: Extract<TelegramAction, { kind: "task" }>, binding: ChannelBinding, now = new Date()): ChannelEnvelope {
  return channelEnvelopeSchema.parse({ id: randomUUID(), channel: "telegram", providerEventId: action.providerEventId, idempotencyKey: createHash("sha256").update(`telegram:${action.providerEventId}`).digest("hex"), bindingId: binding.id, conversationKey: `telegram:direct:${action.chatId}`, senderId: action.userId, chatId: action.chatId, scope: "direct", kind: "task.create", text: action.text, attachments: [], createdAt: now.toISOString() });
}

export class TelegramClient {
  constructor(private readonly token: string, readonly username: string, private readonly fetcher: typeof fetch = fetch) {}
  deepLink(token: string) { return `https://t.me/${this.username}?start=${encodeURIComponent(token)}`; }
  async sendMessage(chatId: string, text: string) {
    const response = await this.fetcher(`https://api.telegram.org/bot${this.token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096), disable_web_page_preview: true }) });
    if (!response.ok) throw new Error(`Telegram 消息发送失败 (${response.status})`);
  }
}
