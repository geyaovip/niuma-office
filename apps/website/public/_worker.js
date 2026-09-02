const legacyRoutes = new Map([
  ["/help", "/guide/"],
  ["/privacy", "/security/"],
  ["/terms", "/"],
  ["/feedback", "/guide/"],
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "www.alipayclaw.cn") {
      url.hostname = "alipayclaw.cn";
      url.protocol = "https:";
      return Response.redirect(url.toString(), 308);
    }

    const normalizedPath = url.pathname.replace(/\/$/, "") || "/";
    const legacyTarget = legacyRoutes.get(normalizedPath);
    if (legacyTarget) {
      return Response.redirect(new URL(legacyTarget, "https://alipayclaw.cn").toString(), 308);
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
