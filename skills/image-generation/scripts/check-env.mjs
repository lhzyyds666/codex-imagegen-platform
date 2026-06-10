#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const strictMode = args.includes("--strict");
const helpMode = args.includes("--help") || args.includes("-h");
const positional = args.filter((arg) => !arg.startsWith("--"));
const projectDir = path.resolve(positional[0] || process.cwd());

if (helpMode) {
  console.log(`Usage: node scripts/check-env.mjs [project-dir] [--json] [--strict]

Checks whether a project is ready for the image-generation skill's direct
gpt-image-2-skill route. No secrets are printed and no files are modified.`);
  process.exit(0);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function findOnPath(command) {
  const rawPath = process.env.PATH || "";
  const dirs = rawPath.split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return "";
}

function nodeMajor(version) {
  const match = String(version || "").match(/^v?(\d+)/);
  return match ? Number(match[1]) : 0;
}

function check(status, name, detail, action = "") {
  return { status, name, detail, action };
}

const packagePath = path.join(projectDir, "package.json");
const pkg = readJson(packagePath);
const deps = {
  ...(pkg?.dependencies || {}),
  ...(pkg?.devDependencies || {})
};
const declaredGptImageVersion = deps["gpt-image-2-skill"] || "";

const localScript = path.join(projectDir, "node_modules", "gpt-image-2-skill", "bin", "gpt-image-2-skill.js");
const localBin = process.platform === "win32"
  ? path.join(projectDir, "node_modules", ".bin", "gpt-image-2-skill.cmd")
  : path.join(projectDir, "node_modules", ".bin", "gpt-image-2-skill");
const pathBin = findOnPath("gpt-image-2-skill");
const npmBin = findOnPath("npm");
const npxBin = findOnPath("npx");

const codexHome = process.env.CODEX_HOME || path.join(homedir(), ".codex");
const codexAuth = path.join(codexHome, ["auth", "json"].join("."));
const hasCodexAuth = existsSync(codexAuth);
const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);

const isPlatformProject = Boolean(
  pkg?.name === "codex-imagegen-platform" &&
  existsSync(path.join(projectDir, "server.mjs")) &&
  existsSync(path.join(projectDir, "public", "app.js"))
);

const checks = [];
const nodeOk = nodeMajor(process.version) >= 18;
checks.push(check(
  nodeOk ? "ok" : "fail",
  "Node.js",
  `${process.version} at ${process.execPath}`,
  nodeOk ? "" : "Install Node.js 18+; Node.js 20+ is recommended."
));

checks.push(check(
  pkg ? "ok" : "info",
  "package.json",
  pkg ? `${pkg.name || "(unnamed)"}${declaredGptImageVersion ? ` declares gpt-image-2-skill ${declaredGptImageVersion}` : ""}` : "No package.json in target project.",
  pkg && declaredGptImageVersion && !existsSync(localScript) ? "Run npm install in the target project." : ""
));

let cliStatus = "fail";
let cliDetail = "No local or PATH gpt-image-2-skill command found.";
let cliAction = "Install project dependencies or use npx --yes gpt-image-2-skill.";
if (existsSync(localScript)) {
  cliStatus = "ok";
  cliDetail = `local script: ${localScript}`;
  cliAction = `Use: node "${localScript}"`;
} else if (existsSync(localBin)) {
  cliStatus = "ok";
  cliDetail = `local binary: ${localBin}`;
  cliAction = `Use: "${localBin}"`;
} else if (pathBin) {
  cliStatus = "ok";
  cliDetail = `PATH binary: ${pathBin}`;
  cliAction = "Use: gpt-image-2-skill";
} else if (npxBin) {
  cliStatus = "warn";
  cliDetail = `npx is available: ${npxBin}`;
  cliAction = "Use: npx --yes gpt-image-2-skill";
}
checks.push(check(cliStatus, "gpt-image-2-skill CLI", cliDetail, cliAction));

checks.push(check(
  hasCodexAuth || hasOpenAIKey ? "ok" : "fail",
  "Image auth",
  hasCodexAuth
    ? `Codex auth found: ${codexAuth}`
    : hasOpenAIKey
      ? "OPENAI_API_KEY is set."
      : "No Codex auth file or OPENAI_API_KEY detected.",
  hasCodexAuth || hasOpenAIKey ? "" : "Sign in to Codex or set OPENAI_API_KEY before using direct generation."
));

checks.push(check(
  npmBin ? "ok" : "warn",
  "npm",
  npmBin || "npm was not found on PATH.",
  npmBin ? "" : "Install npm if the target project needs dependency installation."
));

checks.push(check(
  isPlatformProject ? "ok" : "info",
  "codex-imagegen-platform",
  isPlatformProject ? "Target project matches the local imagegen platform shape." : "Target project is not the codex-imagegen-platform app shape.",
  isPlatformProject ? "Use npm run check before changing platform code." : ""
));

const ready = nodeOk && (cliStatus === "ok" || cliStatus === "warn") && (hasCodexAuth || hasOpenAIKey);
const result = {
  ready,
  projectDir,
  checks
};

if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log("Image Generation Skill Environment Check");
  console.log(`Project: ${projectDir}`);
  console.log(`Ready: ${ready ? "yes" : "no"}`);
  console.log("");
  for (const item of checks) {
    const label = item.status.toUpperCase().padEnd(5);
    console.log(`[${label}] ${item.name}: ${item.detail}`);
    if (item.action) console.log(`       next: ${item.action}`);
  }
}

if (strictMode && !ready) process.exit(1);
