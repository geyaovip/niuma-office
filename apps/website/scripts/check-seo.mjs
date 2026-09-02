import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { publicRoutes } from "../site.routes.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const origin = "https://alipayclaw.cn";
const pages = publicRoutes;
const routePaths = new Set(pages.map(({ path }) => path));
const forbiddenFragments = ["href=\"#\"", "/help/", "niuma-office.pages.dev", "Lorem", "TODO"];

const titles = new Set();
for (const page of pages) {
  const html = await readFile(join(root, page.file), "utf8");
  const expectedUrl = `${origin}${page.path}`;
  const title = capture(html, /<title>([^<]+)<\/title>/i, `${page.file} 缺少标题`);
  if (titles.has(title)) fail(`${page.file} 使用了重复标题：${title}`);
  titles.add(title);
  capture(html, /<meta\s+name="description"\s+content="([^"]+)"/i, `${page.file} 缺少 Meta Description`);
  const canonical = capture(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i, `${page.file} 缺少 Canonical`);
  if (canonical !== expectedUrl) fail(`${page.file} Canonical 应为 ${expectedUrl}`);
  const openGraphUrl = capture(html, /<meta\s+property="og:url"\s+content="([^"]+)"/i, `${page.file} 缺少 og:url`);
  if (openGraphUrl !== expectedUrl) fail(`${page.file} og:url 应为 ${expectedUrl}`);
  if ((html.match(/<h1(?:\s|>)/gi) ?? []).length !== 1) fail(`${page.file} 必须且只能包含一个 H1`);
  capture(html, /<meta\s+property="og:title"\s+content="([^"]+)"/i, `${page.file} 缺少 og:title`);
  capture(html, /<meta\s+property="og:description"\s+content="([^"]+)"/i, `${page.file} 缺少 og:description`);
  capture(html, /<meta\s+name="twitter:card"\s+content="([^"]+)"/i, `${page.file} 缺少 Twitter Card`);
  for (const fragment of forbiddenFragments) {
    if (html.includes(fragment)) fail(`${page.file} 包含禁止发布的内容：${fragment}`);
  }
  for (const href of html.matchAll(/href="([^"]+)"/g)) {
    const target = href[1];
    if (!target.startsWith("/") || target.startsWith("//")) continue;
    const [pathname] = target.split("#");
    if (pathname === "" || pathname.startsWith("/src/") || pathname.startsWith("/brand/") || pathname.startsWith("/screenshots/")) continue;
    if (!routePaths.has(pathname)) fail(`${page.file} 链接到未登记的站内路由：${target}`);
  }
}

const sitemap = await readFile(join(root, "public/sitemap.xml"), "utf8");
for (const page of pages) {
  const expectedUrl = `${origin}${page.path}`;
  if (!sitemap.includes(`<loc>${expectedUrl}</loc>`)) fail(`站点地图缺少 ${expectedUrl}`);
}
if ((sitemap.match(/<url>/g) ?? []).length !== pages.length) fail("站点地图存在未纳入正式路由表的地址");

const robots = await readFile(join(root, "public/robots.txt"), "utf8");
if (!robots.includes(`Sitemap: ${origin}/sitemap.xml`)) fail("robots.txt 未声明正式站点地图");

const notFound = await readFile(join(root, "404.html"), "utf8");
if (!/name="robots"\s+content="noindex,nofollow"/i.test(notFound)) fail("404 页面必须禁止索引");

const edgeWorker = await readFile(join(root, "public/_worker.js"), "utf8");
if (!edgeWorker.includes('url.hostname === "www.alipayclaw.cn"')) fail("边缘入口缺少 www 到根域名跳转");
if (!edgeWorker.includes("Content-Security-Policy")) fail("边缘入口缺少基础安全响应头");

const releaseManifest = JSON.parse(
  await readFile(join(root, "../../deploy/release-manifest.json"), "utf8"),
);
const artifact = releaseManifest.artifacts?.[0];
if (!artifact?.url || !artifact?.sha256 || !artifact?.sizeBytes) fail("版本清单缺少安装包 URL、大小或 SHA-256");
const downloadPage = await readFile(join(root, "download/index.html"), "utf8");
for (const value of [releaseManifest.version, artifact.url, artifact.sha256]) {
  if (!downloadPage.includes(String(value))) fail(`下载页与版本清单不一致：${value}`);
}

console.log(`Website SEO checks passed for ${pages.length} routes.`);

function capture(value, pattern, message) {
  const match = value.match(pattern)?.[1]?.trim();
  if (!match) fail(message);
  return match;
}

function fail(message) {
  throw new Error(message);
}
