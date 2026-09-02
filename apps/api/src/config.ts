import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_URL_FILE: z.string().min(1).optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(20).optional(),
  TELEGRAM_BOT_USERNAME: z.string().regex(/^[A-Za-z0-9_]{5,64}$/).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(24).optional(),
  PUBLIC_API_URL: z.string().url(),
  NIUMA_ARK_API_KEY: z.string().min(20).optional(),
  NIUMA_ARK_API_KEY_FILE: z.string().min(1).optional(),
  NIUMA_PLATFORM_MODEL_ID: z.string().min(1).optional(),
  NIUMA_ARK_BASE_URL: z.string().url().default("https://ark.cn-beijing.volces.com/api/v3"),
  NIUMA_ADMIN_TOKEN: z.string().min(32).optional(),
  NIUMA_ADMIN_TOKEN_FILE: z.string().min(1).optional(),
}).superRefine((value, context) => {
  const telegram = [value.TELEGRAM_BOT_TOKEN, value.TELEGRAM_BOT_USERNAME, value.TELEGRAM_WEBHOOK_SECRET];
  if (telegram.some(Boolean) && !telegram.every(Boolean)) context.addIssue({ code: "custom", message: "Telegram 配置必须同时提供 Token、用户名和 Webhook Secret" });
  if (Boolean(value.DATABASE_URL) === Boolean(value.DATABASE_URL_FILE)) context.addIssue({ code: "custom", message: "数据库连接必须通过环境变量或 Secret 文件提供一种" });
  if (value.NIUMA_ARK_API_KEY && value.NIUMA_ARK_API_KEY_FILE) context.addIssue({ code: "custom", message: "方舟密钥只能通过环境变量或 Secret 文件提供一种" });
  if ((value.NIUMA_ARK_API_KEY || value.NIUMA_ARK_API_KEY_FILE) && !value.NIUMA_PLATFORM_MODEL_ID) context.addIssue({ code: "custom", message: "启用平台模型时必须配置逻辑模型对应的上游模型 ID" });
  if (value.NIUMA_ADMIN_TOKEN && value.NIUMA_ADMIN_TOKEN_FILE) context.addIssue({ code: "custom", message: "管理凭证只能通过环境变量或 Secret 文件提供一种" });
});
export type ApiConfig = z.infer<typeof configSchema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig { return configSchema.parse(env); }
