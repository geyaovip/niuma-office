import { z } from "zod";

export const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
export const modelCapabilitySchema = z.enum(["reasoning", "vision", "tools", "coding", "long-context"]);
export const modelRouteInputSchema = z.object({
  logicalModelId: z.string().regex(/^[a-z0-9-]{2,40}$/),
  displayName: z.string().trim().min(1).max(40),
  provider: z.literal("volcengine-ark"),
  providerModelId: z.string().trim().min(1).max(160),
  endpoint: z.string().url().refine(value => { const url = new URL(value); return url.protocol === "https:" && (url.hostname === "ark.cn-beijing.volces.com" || url.hostname.endsWith(".ark.cn-beijing.volces.com")) && url.pathname.startsWith("/api/v3") && !url.username && !url.password && !url.search && !url.hash; }, "只允许火山方舟 HTTPS API 地址"),
  capabilities: z.array(modelCapabilitySchema).min(1).max(8).transform(values => [...new Set(values)]),
  inputPriceMicrounitsPerMillion: z.number().int().min(0).max(1_000_000_000_000),
  outputPriceMicrounitsPerMillion: z.number().int().min(0).max(1_000_000_000_000),
  cachePriceMicrounitsPerMillion: z.number().int().min(0).max(1_000_000_000_000),
  contextLimit: z.number().int().min(1_024).max(4_000_000),
  outputLimit: z.number().int().min(256).max(1_000_000),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
  health: z.enum(["healthy", "degraded", "disabled"]),
  fallbackPriority: z.number().int().min(0).max(10_000),
  minimumClientVersion: semverSchema,
}).strict().superRefine((value, context) => {
  if (value.outputLimit > value.contextLimit) context.addIssue({ code: "custom", path: ["outputLimit"], message: "输出上限不能大于上下文上限" });
  if (value.enabled && value.health === "disabled") context.addIssue({ code: "custom", path: ["health"], message: "已启用模型不能使用 disabled 健康状态" });
});

export type ModelRouteInput = z.input<typeof modelRouteInputSchema>;
export type ModelRouteValue = z.output<typeof modelRouteInputSchema>;
export interface ModelRoute extends ModelRouteValue { id: string; version: number; createdAt: string; updatedAt: string }

export function compareSemver(left: string, right: string) {
  const a = left.split(".").map(Number); const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) { const difference = (a[index] ?? 0) - (b[index] ?? 0); if (difference) return difference; }
  return 0;
}
