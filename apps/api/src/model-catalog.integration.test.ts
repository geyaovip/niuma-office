import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelRepository } from "./channel-repository.js";
import { estimateCostMicrounits } from "./model-catalog.js";

const databaseUrl = process.env.NIUMA_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const baseRoute = { logicalModelId: "auto", displayName: "Auto", provider: "volcengine-ark" as const, providerModelId: "ep-primary", endpoint: "https://ark.cn-beijing.volces.com/api/v3", capabilities: ["reasoning", "tools"] as Array<"reasoning" | "tools">, inputPriceMicrounitsPerMillion: 1_000_000, outputPriceMicrounitsPerMillion: 2_000_000, cachePriceMicrounitsPerMillion: 500_000, contextLimit: 128_000, outputLimit: 16_000, enabled: true, sortOrder: 10, health: "healthy" as const, fallbackPriority: 10, minimumClientVersion: "0.1.0" };

integration("model catalog repository", () => {
  const pool = new Pool({ connectionString: databaseUrl }); const repository = new ChannelRepository(pool);
  beforeAll(async () => { await repository.migrate(); });
  afterAll(async () => { await repository.close(); });

  it("persists idempotent writes and resolves the best eligible route", async () => {
    const suffix = Date.now().toString(36); const firstKey = `integration-model-primary-${suffix}`;
    const first = await repository.createModelRoute({ ...baseRoute, providerModelId: `ep-primary-${suffix}` }, "integration-test", firstKey);
    const repeated = await repository.createModelRoute({ ...baseRoute, providerModelId: `ep-primary-${suffix}` }, "integration-test", firstKey);
    expect(repeated).toMatchObject({ repeated: true, route: { id: first.route.id, version: 1 } });

    await repository.createModelRoute({ ...baseRoute, providerModelId: `ep-future-${suffix}`, sortOrder: 0, fallbackPriority: 0, minimumClientVersion: "0.2.0" }, "integration-test", `integration-model-future-${suffix}`);
    expect((await repository.resolveModelRoute("auto", "0.1.0"))?.id).toBe(first.route.id);
    expect((await repository.resolveModelRoute("auto", "0.2.0"))?.providerModelId).toBe(`ep-future-${suffix}`);

    const updated = await repository.updateModelRoute(first.route.id, { ...baseRoute, providerModelId: `ep-primary-${suffix}`, enabled: false, health: "disabled" }, "integration-test", `integration-model-disable-${suffix}`);
    expect(updated.route).toMatchObject({ enabled: false, health: "disabled", version: 2 });
    const publicModels = await repository.publicModelCatalog("0.1.0"); expect(publicModels.find(model => model.id === "auto")).toBeUndefined();
  });

  it("opens and recovers a shared circuit and persists a content-free usage ledger", async () => {
    const suffix = Date.now().toString(36); const logicalModelId = `fallback-${suffix}`; const now = new Date("2026-09-05T00:00:00.000Z");
    const primary = (await repository.createModelRoute({ ...baseRoute, logicalModelId, providerModelId: `ep-circuit-primary-${suffix}`, sortOrder: 0 }, "integration-test", `integration-circuit-primary-${suffix}`)).route;
    const fallback = (await repository.createModelRoute({ ...baseRoute, logicalModelId, providerModelId: `ep-circuit-fallback-${suffix}`, sortOrder: 10 }, "integration-test", `integration-circuit-fallback-${suffix}`)).route;
    await repository.recordModelRouteFailure(primary.id, now); await repository.recordModelRouteFailure(primary.id, now); const opened = await repository.recordModelRouteFailure(primary.id, now);
    expect(opened.consecutiveFailures).toBe(3); expect(opened.circuitOpenUntil).toBeTruthy();
    expect((await repository.resolveModelRoutes(logicalModelId, "0.1.0", now))[0]?.id).toBe(fallback.id);
    const afterCooldown = new Date(now.getTime() + 61_000); expect((await repository.resolveModelRoutes(logicalModelId, "0.1.0", afterCooldown))[0]?.id).toBe(primary.id);
    await repository.recordModelRouteSuccess(primary.id, afterCooldown); expect((await repository.resolveModelRoutes(logicalModelId, "0.1.0", afterCooldown))[0]?.id).toBe(primary.id);

    const deviceId = randomUUID(); await repository.registerDevice(deviceId, "integration-public-key-not-a-secret"); const requestId = randomUUID();
    expect(await repository.startModelUsage(requestId, deviceId, logicalModelId, now)).toBe(true); expect(await repository.startModelUsage(requestId, deviceId, logicalModelId, now)).toBe(false);
    const usage = { inputTokens: 100, outputTokens: 30, cachedInputTokens: 20 }; const estimatedCostMicrounits = estimateCostMicrounits(primary, usage);
    expect(await repository.completeModelUsage({ requestId, status: "succeeded", route: primary, usage, estimatedCostMicrounits, attemptCount: 2, durationMs: 420, upstreamRequestId: "upstream-safe" }, afterCooldown)).toBe(true);
    const ledger = (await pool.query("SELECT status,input_tokens,output_tokens,cached_input_tokens,estimated_cost_microunits,usage_known,attempt_count,upstream_request_id FROM model_usage_ledger WHERE request_id=$1", [requestId])).rows[0];
    expect(ledger).toMatchObject({ status: "succeeded", input_tokens: 100, output_tokens: 30, cached_input_tokens: 20, usage_known: true, attempt_count: 2, upstream_request_id: "upstream-safe" }); expect(Number(ledger.estimated_cost_microunits)).toBe(150);
    const contentColumns = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='model_usage_ledger' AND column_name IN ('prompt','messages','response','content')")).rows; expect(contentColumns).toEqual([]);
  });
});
