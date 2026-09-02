export const PRODUCTION_API_URL = "https://api.alipayclaw.cn";

export function resolveCloudServiceUrl(isPackaged: boolean, developmentOverride?: string) {
  if (isPackaged) return PRODUCTION_API_URL;
  return developmentOverride?.trim() || PRODUCTION_API_URL;
}
