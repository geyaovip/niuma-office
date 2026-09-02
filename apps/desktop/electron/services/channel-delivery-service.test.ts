import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ChannelEnvelope } from "@niuma/contracts";
import { ChannelDeliveryService } from "./channel-delivery-service.js";
import type { StoredTask } from "./workspace-repository.js";

const envelope = (): ChannelEnvelope => ({ id: randomUUID(), channel: "telegram", bindingId: randomUUID(), providerEventId: "100", idempotencyKey: "a".repeat(64), conversationKey: "telegram:7", kind: "task.create", text: "整理今天的会议纪要", receivedAt: new Date().toISOString(), attachments: [] });

describe("ChannelDeliveryService", () => {
  it("creates and executes a real task, then sends completion exactly once", async () => {
    const incoming = envelope(); let stored: StoredTask | undefined;
    const client = { configured: true, pull: vi.fn(async () => [incoming]), acknowledge: vi.fn(async () => undefined) };
    const workspace = { getTask: vi.fn(async () => stored), saveTaskWithEvent: vi.fn(async (task: StoredTask) => { stored = task; return { tasks: [task], executionEvents: [{ id: randomUUID(), taskId: task.id, type: "task.queued", createdAt: new Date().toISOString() }] }; }) };
    const executor = { run: vi.fn(async (task: StoredTask, onTask?: (task: StoredTask) => void) => { const completed = { ...task, status: "completed" as const, output: "会议纪要已整理完成" }; onTask?.(completed); return completed; }) };
    const service = new ChannelDeliveryService(client as never, workspace as never, executor as never);
    await service.tick();
    expect(stored).toMatchObject({ id: `channel-${incoming.id}`, projectId: "default", channelOrigin: { envelopeId: incoming.id } });
    expect(stored?.teamId).toBeUndefined();
    expect(executor.run).toHaveBeenCalledTimes(1);
    expect(client.acknowledge).toHaveBeenCalledWith(incoming.id, expect.objectContaining({ state: "completed", summary: "会议纪要已整理完成" }));
  });

  it("does not execute a duplicate delivery twice", async () => {
    const incoming = envelope(); const existing = { id: `channel-${incoming.id}`, title: "已存在", prompt: incoming.text, status: "completed", output: "已完成", createdAt: new Date().toISOString(), projectId: "default", channelOrigin: { channel: "telegram", envelopeId: incoming.id, bindingId: incoming.bindingId, conversationKey: incoming.conversationKey } } as StoredTask;
    const client = { configured: true, pull: async () => [incoming], acknowledge: vi.fn(async () => undefined) };
    const workspace = { getTask: async () => existing, saveTaskWithEvent: vi.fn() }; const executor = { run: vi.fn() };
    await new ChannelDeliveryService(client as never, workspace as never, executor as never).tick();
    expect(executor.run).not.toHaveBeenCalled(); expect(workspace.saveTaskWithEvent).not.toHaveBeenCalled();
    expect(client.acknowledge).toHaveBeenCalledWith(incoming.id, expect.objectContaining({ state: "completed" }));
  });
});
