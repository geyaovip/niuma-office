import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { ChannelRepository } from "./channel-repository.js";
import { createApp } from "./app.js";

const config = loadConfig();
const databaseUrl = config.DATABASE_URL_FILE ? (await readFile(config.DATABASE_URL_FILE, "utf8")).trim() : config.DATABASE_URL!;
const pool = new Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 }); const repository = new ChannelRepository(pool);
const arkApiKey = config.NIUMA_ARK_API_KEY_FILE ? (await readFile(config.NIUMA_ARK_API_KEY_FILE, "utf8")).trim() : config.NIUMA_ARK_API_KEY;
const modelGateway = arkApiKey && config.NIUMA_PLATFORM_MODEL_ID ? { apiKey: arkApiKey, modelId: config.NIUMA_PLATFORM_MODEL_ID, baseUrl: config.NIUMA_ARK_BASE_URL } : undefined;
await repository.migrate(); const app = createApp(config, repository, undefined, modelGateway); await app.listen({ host: config.HOST, port: config.PORT });
const shutdown = async () => { await app.close(); await repository.close(); };
process.once("SIGTERM", () => void shutdown()); process.once("SIGINT", () => void shutdown());
