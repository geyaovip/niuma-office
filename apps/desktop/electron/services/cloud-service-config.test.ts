import { describe, expect, it } from "vitest";
import { PRODUCTION_API_URL, resolveCloudServiceUrl } from "./cloud-service-config.js";

describe("resolveCloudServiceUrl", () => {
  it("always uses the formal API in packaged builds", () => {
    expect(resolveCloudServiceUrl(true, "http://127.0.0.1:4310")).toBe(PRODUCTION_API_URL);
  });

  it("allows a local override while developing", () => {
    expect(resolveCloudServiceUrl(false, " http://127.0.0.1:4310 ")).toBe("http://127.0.0.1:4310");
  });

  it("defaults development builds to the formal API", () => {
    expect(resolveCloudServiceUrl(false)).toBe(PRODUCTION_API_URL);
  });
});
