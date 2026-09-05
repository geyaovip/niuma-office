import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelRepository } from "./channel-repository.js";

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
});
