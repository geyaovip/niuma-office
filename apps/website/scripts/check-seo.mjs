import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const origin = "https://alipayclaw.cn";
const pages = [
  { path: "/", file: "index.html" },
  { path: "/download/", file: "download/index.html" },
  { path: "/help/", file: "help/index.html" },
  { path: "/privacy/", file: "privacy/index.html" },
  { path: "/terms/", file: "terms/index.html" },
];

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
  if (html.includes("niuma-office.pages.dev")) fail(`${page.file} 仍包含临时 Pages 域名`);
}

const sitemap = await readFile(join(root, "public/sitemap.xml"), "utf8");
for (const page of pages) {
  const expectedUrl = `${origin}${page.path}`;
  if (!sitemap.includes(`<loc>${expectedUrl}</loc>`)) fail(`站点地图缺少 ${expectedUrl}`);
}
if ((sitemap.match(/<url>/g) ?? []).length !== pages.length) fail("站点地图存在未纳入正式路由表的地址");

const robots = await readFile(join(root, "public/robots.txt"), "utf8");
if (!robots.includes(`Sitemap: ${origin}/sitemap.xml`)) fail("robots.txt 未声明正式站点地图");

console.log(`Website SEO checks passed for ${pages.length} routes.`);

function capture(value, pattern, message) {
  const match = value.match(pattern)?.[1]?.trim();
  if (!match) fail(message);
  return match;
}

function fail(message) {
  throw new Error(message);
}
