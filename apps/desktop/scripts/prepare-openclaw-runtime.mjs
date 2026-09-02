import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const NODE_VERSION = "24.15.0";
const OPENCLAW_VERSION = "2026.8.2";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = join(scriptDirectory, "..");
const runtimeDirectory = join(appDirectory, "runtime");
const nodeDirectory = join(runtimeDirectory, "node");
const openclawDirectory = join(runtimeDirectory, "openclaw");
const architecture = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : undefined;

if (!architecture || process.platform !== "darwin") throw new Error("当前脚本仅用于 macOS arm64/x64 运行时");

const nodeExecutable = join(nodeDirectory, "bin", "node");
try { await access(nodeExecutable); } catch { await installNode(); }

const openclawEntry = join(openclawDirectory, "node_modules", "openclaw", "openclaw.mjs");
let installedOpenClawVersion = "";
try {
  await access(openclawEntry);
  const result = spawnSync(nodeExecutable, [openclawEntry, "--version"], { encoding: "utf8" });
  installedOpenClawVersion = result.status === 0 ? result.stdout.trim() : "";
} catch { /* install below */ }
if (!installedOpenClawVersion.includes(OPENCLAW_VERSION)) installOpenClaw();

const nodeVersion = spawnSync(nodeExecutable, ["--version"], { encoding: "utf8" });
const clawVersion = spawnSync(nodeExecutable, [openclawEntry, "--version"], { encoding: "utf8" });
if (nodeVersion.status !== 0 || clawVersion.status !== 0) throw new Error(`运行时验证失败\n${nodeVersion.stderr}\n${clawVersion.stderr}`);
process.stdout.write(`Runtime ready: Node ${nodeVersion.stdout.trim()}, OpenClaw ${clawVersion.stdout.trim()}\n`);

async function installNode() {
  await mkdir(runtimeDirectory, { recursive: true });
  const archiveName = `node-v${NODE_VERSION}-darwin-${architecture}.tar.gz`;
  const baseUrl = `https://nodejs.org/dist/v${NODE_VERSION}`;
  const archivePath = join(runtimeDirectory, archiveName);
  const temporaryPath = `${archivePath}.download`;
  const [archiveResponse, sumsResponse] = await Promise.all([fetch(`${baseUrl}/${archiveName}`), fetch(`${baseUrl}/SHASUMS256.txt`)]);
  if (!archiveResponse.ok || !archiveResponse.body || !sumsResponse.ok) throw new Error("无法下载已固定的 Node 运行时");
  await pipeline(archiveResponse.body, createWriteStream(temporaryPath, { mode: 0o600 }));
  await rename(temporaryPath, archivePath);
  const expected = (await sumsResponse.text()).split("\n").find(line => line.endsWith(`  ${archiveName}`))?.split(/\s+/)[0];
  const actual = createHash("sha256").update(await readFile(archivePath)).digest("hex");
  if (!expected || expected !== actual) throw new Error("Node 运行时校验失败");
  const extractedName = `node-v${NODE_VERSION}-darwin-${architecture}`;
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", runtimeDirectory], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Node 运行时解压失败");
  await rm(nodeDirectory, { recursive: true, force: true });
  await rename(join(runtimeDirectory, extractedName), nodeDirectory);
  await rm(archivePath, { force: true });
}

function installOpenClaw() {
  const npmCli = join(nodeDirectory, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  const result = spawnSync(nodeExecutable, [npmCli, "install", "--prefix", openclawDirectory, "--omit=dev", "--no-audit", "--no-fund", "--save-exact", `openclaw@${OPENCLAW_VERSION}`], {
    encoding: "utf8",
    stdio: "inherit",
    env: {
      ...process.env,
      PATH: `${join(nodeDirectory, "bin")}:${process.env.PATH ?? ""}`,
      npm_config_update_notifier: "false",
    },
  });
  if (result.status !== 0) throw new Error("OpenClaw 运行时安装失败");
}
