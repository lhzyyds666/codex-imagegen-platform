import { createServer } from "node:http";
import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const requestDir = path.join(dataDir, "requests");
const outputDir = path.join(dataDir, "outputs");
const uploadDir = path.join(dataDir, "uploads");
const gptImageSkillScript = path.join(__dirname, "node_modules", "gpt-image-2-skill", "bin", "gpt-image-2-skill.js");
const port = Number(process.env.PORT || 4937);
const queuedJobs = [];
let queueRunning = false;
const outputImagePattern = /\.(png|jpe?g|webp)$/i;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

const STYLE_PRESETS = {
  photoreal: "photorealistic, natural texture, believable lighting",
  editorial: "editorial campaign image, refined art direction, carefully staged",
  product: "clean product mockup, controlled studio lighting, commercial polish",
  anime: "high-quality anime illustration, expressive shapes, crisp color blocking",
  cinematic: "cinematic still, atmospheric depth, filmic lighting",
  "ui-mockup": "high-fidelity UI mockup, crisp readable interface details",
  diagram: "structured educational infographic, clear hierarchy, accurate labels",
  "vector-friendly": "simple vector-friendly mark, clean silhouette, minimal detail"
};

const USE_CASES = {
  "photorealistic-natural": "photorealistic-natural",
  "product-mockup": "product-mockup",
  "ui-mockup": "ui-mockup",
  "infographic-diagram": "infographic-diagram",
  "scientific-educational": "scientific-educational",
  "ads-marketing": "ads-marketing",
  "productivity-visual": "productivity-visual",
  "logo-brand": "logo-brand",
  "illustration-story": "illustration-story",
  "stylized-concept": "stylized-concept"
};

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate())
  ].join("") + "-" + [
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds())
  ].join("");
}

function safeSlug(input, fallback = "imagegen") {
  const cleaned = String(input || "")
    .normalize("NFKD")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return cleaned || fallback;
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function cleanLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function line(label, value) {
  const v = cleanLine(value);
  return v ? `${label}: ${v}` : "";
}

function trimJobEvents(events) {
  return events.slice(-10);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateOutputFilename(value) {
  const raw = String(value || "").trim();
  const filename = path.basename(raw);
  if (!raw || filename !== raw || !outputImagePattern.test(filename)) {
    const err = new Error("Invalid output filename.");
    err.status = 400;
    throw err;
  }
  return filename;
}

async function unlinkIfExists(filePath) {
  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function metadataNameForOutput(filename) {
  const stem = filename.replace(outputImagePattern, "");
  return `${stem.replace(/-\d+$/, "")}.json`;
}

function publicJob(job) {
  return {
    id: job.id,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    prompt: job.promptSummary,
    status: job.status,
    operation: job.operation,
    progress: job.progress,
    message: job.message,
    images: job.images || [],
    error: job.error || "",
    events: trimJobEvents(job.events || []),
    referenceImage: job.referenceImage ? {
      filename: job.referenceImage.filename,
      url: job.referenceImage.url,
      bytes: job.referenceImage.bytes
    } : null
  };
}

function touchJob(job, patch = {}) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

function buildPrompt(params = {}) {
  const useCase = USE_CASES[params.useCase] || "stylized-concept";
  const preset = STYLE_PRESETS[params.stylePreset] || STYLE_PRESETS.cinematic;
  const transparentNote = params.transparent
    ? "Create the subject on a perfectly flat solid chroma-key background for background removal. The key background must be uniform with no shadows, gradients, texture, reflections, or floor plane. Do not use the key color in the subject."
    : "";
  const exactText = cleanLine(params.exactText)
    ? `If text appears in the image, render this exact text only: "${cleanLine(params.exactText)}".`
    : "";
  const negatives = cleanLine(params.negative)
    ? `Avoid: ${cleanLine(params.negative)}.`
    : "Avoid watermarks, signatures, UI artifacts, distorted hands, and unreadable accidental text.";

  return [
    `Use case: ${useCase}`,
    line("Primary request", params.prompt),
    line("Subject", params.subject),
    line("Scene/backdrop", params.scene),
    line("Style direction", `${preset}${params.styleNotes ? `; ${params.styleNotes}` : ""}`),
    line("Composition", params.composition),
    line("Camera/lens", params.camera),
    line("Lighting", params.lighting),
    line("Mood", params.mood),
    line("Color palette", params.palette),
    exactText,
    transparentNote,
    negatives,
    params.refImageName ? `Input image: Use the uploaded reference image "${cleanLine(params.refImageName)}" as the visual source for structure, identity, composition, or style as implied by the request.` : "",
    line("Output intent", params.assetType),
    line("Aspect and size target", `${params.aspect || "auto"} / ${params.size || "auto"}`),
    "Make the image polished, coherent, and ready to use. Follow the requested composition and constraints closely."
  ].filter(Boolean).join("\n");
}

function buildCodexInstruction(params, prompt) {
  return [
    "# Codex imagegen request",
    "",
    "Use the built-in `image_gen` tool with this prompt. The local platform cannot call Codex built-in tools directly, so this file is the bridge request.",
    "",
    "```text",
    prompt,
    "```",
    "",
    "## Parameters",
    "",
    `- model preference: ${params.model || "codex built-in default"}`,
    `- size: ${params.size || "auto"}`,
    `- quality: ${params.quality || "auto"}`,
    `- output format: ${params.outputFormat || "png"}`,
    `- variations: ${clampInt(params.variations, 1, 4, 1)}`,
    `- transparent requested: ${params.transparent ? "yes" : "no"}`,
    "",
    "## After generation",
    "",
    "Save the selected output into this project's `data/outputs/` folder if it should be used by the platform."
  ].join("\n");
}

function json(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function text(res, status, value) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(value);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function ensureDirs() {
  await mkdir(requestDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(uploadDir, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function codexAuthCandidates() {
  return [
    process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, "auth.json") : "",
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".codex", "auth.json") : "",
    process.env.HOME ? path.join(process.env.HOME, ".codex", "auth.json") : ""
  ].filter(Boolean);
}

async function hasCodexAuth() {
  for (const authPath of codexAuthCandidates()) {
    if (await fileExists(authPath)) return true;
  }
  return false;
}

function extensionFromMime(mimeType, fallbackName = "") {
  const lower = String(mimeType || "").toLowerCase();
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (lower.includes("webp")) return "webp";
  if (lower.includes("png")) return "png";
  const ext = path.extname(fallbackName).replace(/^\./, "").toLowerCase();
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  return "png";
}

async function saveReferenceImage(params, base) {
  const dataUrl = String(params.refImageDataUrl || "");
  if (!dataUrl) return null;

  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([\s\S]+)$/i);
  if (!match) {
    const err = new Error("Reference image must be a PNG, JPEG, or WebP data URL.");
    err.status = 400;
    throw err;
  }

  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) {
    const err = new Error("Reference image must be smaller than 25MB.");
    err.status = 400;
    throw err;
  }

  await ensureDirs();
  const ext = extensionFromMime(match[1], params.refImageName);
  const filename = `${base}-reference.${ext}`;
  const filePath = path.join(uploadDir, filename);
  await writeFile(filePath, bytes);
  return {
    filename,
    path: filePath,
    url: `/uploads/${encodeURIComponent(filename)}`,
    bytes: bytes.length,
    mimeType: match[1]
  };
}

async function listJobs() {
  await ensureDirs();
  const outputs = await readdir(outputDir, { withFileTypes: true });

  const outputItems = await Promise.all(
    outputs
      .filter((entry) => entry.isFile() && outputImagePattern.test(entry.name))
      .map(async (entry) => {
        const filePath = path.join(outputDir, entry.name);
        const info = await stat(filePath);
        return {
          name: entry.name,
          url: `/outputs/${encodeURIComponent(entry.name)}`,
          path: filePath,
          mtimeMs: info.mtimeMs
        };
      })
  );

  return {
    requests: queuedJobs.map(publicJob).reverse().slice(0, 30),
    outputs: outputItems.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 24)
  };
}

async function deleteOutputImage(name) {
  await ensureDirs();
  const filename = validateOutputFilename(name);
  const filePath = path.join(outputDir, filename);
  const deletedImage = await unlinkIfExists(filePath);
  if (!deletedImage) {
    const err = new Error("Output image was not found.");
    err.status = 404;
    throw err;
  }

  for (const job of queuedJobs) {
    if (Array.isArray(job.images)) {
      job.images = job.images.filter((image) => image.filename !== filename);
    }
  }

  const metadataFilename = metadataNameForOutput(filename);
  const metadataBase = metadataFilename.replace(/\.json$/i, "");
  const siblingPattern = new RegExp(`^${escapeRegExp(metadataBase)}-\\d+\\.(png|jpe?g|webp)$`, "i");
  const outputs = await readdir(outputDir, { withFileTypes: true });
  const hasSiblings = outputs.some((entry) => entry.isFile() && siblingPattern.test(entry.name));
  const deleted = [filename];

  if (!hasSiblings) {
    const deletedMetadata = await unlinkIfExists(path.join(outputDir, metadataFilename));
    if (deletedMetadata) deleted.push(metadataFilename);
  }

  return { ok: true, deleted };
}

async function queueRequest(params) {
  await ensureDirs();
  const id = `${nowStamp()}-${safeSlug(params.prompt)}`;
  const prompt = buildPrompt(params);
  const jsonPath = path.join(requestDir, `${id}.json`);
  const mdPath = path.join(requestDir, `${id}.md`);
  const record = {
    id,
    createdAt: new Date().toISOString(),
    params,
    prompt,
    codexInstruction: buildCodexInstruction(params, prompt)
  };
  await Promise.all([
    writeFile(jsonPath, JSON.stringify(record, null, 2), "utf8"),
    writeFile(mdPath, record.codexInstruction, "utf8")
  ]);
  return { id, prompt, requestFile: jsonPath, instructionFile: mdPath };
}

function apiPayload(params, prompt) {
  const model = cleanLine(params.model) || "gpt-image-2";
  const outputFormat = cleanLine(params.outputFormat) || "png";
  const variations = clampInt(params.variations, 1, 4, 1);
  const payload = {
    model,
    prompt,
    n: variations
  };

  if (params.size && params.size !== "auto") payload.size = params.size;
  if (params.quality && params.quality !== "auto") payload.quality = params.quality;
  if (params.moderation && params.moderation !== "auto") payload.moderation = params.moderation;
  if (outputFormat && outputFormat !== "png") payload.output_format = outputFormat;
  if ((outputFormat === "jpeg" || outputFormat === "webp") && params.outputCompression) {
    payload.output_compression = clampInt(params.outputCompression, 0, 100, 85);
  }

  if (params.transparent) {
    if (model === "gpt-image-2") {
      const err = new Error("gpt-image-2 does not support transparent backgrounds. Choose gpt-image-1.5 or turn off transparent output.");
      err.status = 400;
      throw err;
    }
    payload.background = "transparent";
  } else if (params.background && params.background !== "default") {
    payload.background = params.background;
  }

  return { payload, outputFormat };
}

async function generateWithOpenAI(params) {
  if (!process.env.OPENAI_API_KEY) {
    const err = new Error("OPENAI_API_KEY is not set for this server process.");
    err.status = 401;
    throw err;
  }

  await ensureDirs();
  const prompt = buildPrompt(params);
  const { payload, outputFormat } = apiPayload(params, prompt);
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok) {
    const message = body?.error?.message || body?.raw || `OpenAI API request failed with HTTP ${response.status}.`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  const base = `${nowStamp()}-${safeSlug(params.prompt)}`;
  const images = [];
  for (const [index, item] of (body.data || []).entries()) {
    if (!item.b64_json) continue;
    const ext = outputFormat === "jpeg" ? "jpg" : outputFormat;
    const filename = `${base}-${index + 1}.${ext}`;
    const filePath = path.join(outputDir, filename);
    await writeFile(filePath, Buffer.from(item.b64_json, "base64"));
    images.push({
      filename,
      path: filePath,
      url: `/outputs/${encodeURIComponent(filename)}`,
      revisedPrompt: item.revised_prompt || ""
    });
  }

  const metadataPath = path.join(outputDir, `${base}.json`);
  await writeFile(metadataPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    params,
    prompt,
    payload,
    images
  }, null, 2), "utf8");

  return { prompt, payload, images, metadataPath };
}

function extractJsonObject(text) {
  const source = String(text || "").trim();
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {
    // The CLI can emit structured progress events around the final JSON. Pull
    // out the first complete JSON object so callers still get a useful error.
  }

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (start === -1) {
      if (ch === "{") {
        start = i;
        depth = 1;
      }
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) {
      try {
        return JSON.parse(source.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function runSkill(args, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [gptImageSkillScript, ...args], {
      cwd: __dirname,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("gpt-image-2-skill timed out while waiting for Codex image generation."));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const parsed = extractJsonObject(stdout) || extractJsonObject(stderr);
      if (code !== 0) {
        const message = parsed?.error?.message || stderr.trim() || stdout.trim() || `gpt-image-2-skill exited with code ${code}.`;
        const err = new Error(message);
        err.status = 502;
        err.details = parsed;
        reject(err);
        return;
      }
      resolve({
        json: parsed,
        stderr
      });
    });
  });
}

function writeNdjson(res, value) {
  res.write(`${JSON.stringify(value)}\n`);
}

function runSkillStreaming(args, onEvent, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [gptImageSkillScript, ...args], {
      cwd: __dirname,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let stdoutLineBuffer = "";
    let stderrLineBuffer = "";
    const parseLines = (text, source) => {
      const combined = (source === "stdout" ? stdoutLineBuffer : stderrLineBuffer) + String(text);
      const lines = combined.split(/\r?\n/);
      const tail = lines.pop() || "";
      if (source === "stdout") stdoutLineBuffer = tail;
      else stderrLineBuffer = tail;
      for (const raw of lines) {
        if (!raw.trim()) continue;
        try {
          const event = JSON.parse(raw);
          if (event?.type || event?.ok !== undefined) onEvent(event);
        } catch {
          // Pretty-printed final JSON is handled on process close.
        }
      }
    };
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("gpt-image-2-skill timed out while waiting for Codex image generation."));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const textChunk = chunk.toString("utf8");
      stdout += textChunk;
      parseLines(textChunk, "stdout");
    });
    child.stderr.on("data", (chunk) => {
      const textChunk = chunk.toString("utf8");
      stderr += textChunk;
      parseLines(textChunk, "stderr");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const parsed = extractJsonObject(stdout) || extractJsonObject(stderr);
      if (code !== 0) {
        const message = parsed?.error?.message || stderr.trim() || stdout.trim() || `gpt-image-2-skill exited with code ${code}.`;
        const err = new Error(message);
        err.status = 502;
        err.details = parsed;
        reject(err);
        return;
      }
      resolve({ json: parsed, stderr });
    });
  });
}

function skillOutputExt(format) {
  if (format === "jpeg") return "jpg";
  if (format === "webp") return "webp";
  return "png";
}

function buildCodexSkillArgs(params, prompt, outPath, refImagePath = "") {
  const format = cleanLine(params.outputFormat) || "png";
  const operation = refImagePath ? "edit" : "generate";
  const args = [
    "--json",
    "--json-events",
    "--provider",
    "codex",
    "images",
    operation,
    "--prompt",
    prompt,
    "--out",
    outPath,
    "--format",
    format
  ];

  if (refImagePath) args.push("--ref-image", refImagePath);
  if (params.size && params.size !== "auto") args.push("--size", params.size);
  if (params.quality && params.quality !== "auto") args.push("--quality", params.quality);
  if (params.transparent) {
    args.push("--background", "transparent");
  } else if (params.background && params.background !== "default") {
    args.push("--background", params.background);
  }
  if ((format === "jpeg" || format === "webp") && params.outputCompression) {
    args.push("--compression", String(clampInt(params.outputCompression, 0, 100, 85)));
  }
  return args;
}

function sanitizeSkillResult(result) {
  return {
    provider: result?.provider,
    request: result?.request ? {
      operation: result.request.operation,
      provider: result.request.provider,
      model: result.request.model,
      delegated_image_model: result.request.delegated_image_model,
      background: result.request.background,
      size: result.request.size,
      quality: result.request.quality,
      format: result.request.format
    } : null,
    response: result?.response ? {
      model: result.response.model,
      status: result.response.status,
      image_count: result.response.image_count,
      revised_prompts: result.response.revised_prompts || []
    } : null,
    output: result?.output,
    retry: result?.retry ? {
      count: result.retry.count,
      max_retries: result.retry.max_retries
    } : null
  };
}

function skillPhasePercent(phase, fallback = 0) {
  const map = {
    request_started: 5,
    response_created: 15,
    output_item_done: 85,
    response_completed: 95,
    request_completed: 97,
    output_saved: 100
  };
  return map[phase] || fallback;
}

async function generateWithCodexSkill(params) {
  if (!(await fileExists(gptImageSkillScript))) {
    const err = new Error("gpt-image-2-skill is not installed. Run npm install in this project first.");
    err.status = 503;
    throw err;
  }

  await ensureDirs();
  const prompt = buildPrompt(params);
  const format = cleanLine(params.outputFormat) || "png";
  const variations = clampInt(params.variations, 1, 4, 1);
  const base = `${nowStamp()}-${safeSlug(params.prompt)}`;
  const referenceImage = await saveReferenceImage(params, base);
  const images = [];
  const runs = [];

  for (let index = 0; index < variations; index += 1) {
    const filename = `${base}-${index + 1}.${skillOutputExt(format)}`;
    const outPath = path.join(outputDir, filename);
    const args = buildCodexSkillArgs(params, prompt, outPath, referenceImage?.path);

    const run = await runSkill(args);
    const info = await stat(outPath);
    const safeResult = sanitizeSkillResult(run.json);
    runs.push(safeResult);
    images.push({
      filename,
      path: outPath,
      url: `/outputs/${encodeURIComponent(filename)}`,
      bytes: info.size,
      revisedPrompt: safeResult.response?.revised_prompts?.[0] || ""
    });
  }

  const metadataPath = path.join(outputDir, `${base}.json`);
  await writeFile(metadataPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    provider: "codex",
    tool: "gpt-image-2-skill",
    params,
    prompt,
    referenceImage,
    runs,
    images
  }, null, 2), "utf8");

  return { prompt, provider: "codex", tool: "gpt-image-2-skill", referenceImage, images, metadataPath };
}

async function enqueueCodexJob(params) {
  if (!(await fileExists(gptImageSkillScript))) {
    const err = new Error("gpt-image-2-skill is not installed. Run npm install in this project first.");
    err.status = 503;
    throw err;
  }

  await ensureDirs();
  const base = `${nowStamp()}-${safeSlug(params.prompt)}`;
  const prompt = buildPrompt(params);
  const referenceImage = await saveReferenceImage(params, base);
  const safeParams = { ...params };
  delete safeParams.refImageDataUrl;

  const job = {
    id: `job-${base}-${Math.random().toString(16).slice(2, 8)}`,
    base,
    params: safeParams,
    prompt,
    promptSummary: cleanLine(params.prompt) || "未命名任务",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "queued",
    operation: referenceImage ? "edit" : "generate",
    progress: 0,
    message: "等待 Codex 生成队列处理",
    images: [],
    referenceImage,
    events: []
  };
  queuedJobs.push(job);
  while (queuedJobs.length > 50) {
    const removable = queuedJobs.findIndex((item) => ["completed", "failed"].includes(item.status));
    if (removable === -1) break;
    queuedJobs.splice(removable, 1);
  }
  processQueue();
  return publicJob(job);
}

function addJobEvent(job, event) {
  job.events.push({
    at: new Date().toISOString(),
    ...event
  });
  job.events = trimJobEvents(job.events);
}

async function runQueuedJob(job) {
  touchJob(job, {
    status: "running",
    progress: 1,
    message: job.operation === "edit" ? "开始图生图任务" : "开始文生图任务"
  });
  addJobEvent(job, { message: job.message, percent: job.progress });

  const format = cleanLine(job.params.outputFormat) || "png";
  const variations = clampInt(job.params.variations, 1, 4, 1);
  const runs = [];

  for (let index = 0; index < variations; index += 1) {
    const filename = `${job.base}-${index + 1}.${skillOutputExt(format)}`;
    const outPath = path.join(outputDir, filename);
    const args = buildCodexSkillArgs(job.params, job.prompt, outPath, job.referenceImage?.path);
    touchJob(job, {
      progress: Math.round((index / variations) * 100),
      message: `正在生成第 ${index + 1}/${variations} 张`
    });
    addJobEvent(job, { message: job.message, percent: job.progress });

    const run = await runSkillStreaming(args, (event) => {
      const eventData = event.data || {};
      const phase = eventData.phase || event.type;
      const rawPercent = Number.isFinite(Number(eventData.percent))
        ? Number(eventData.percent)
        : skillPhasePercent(phase, 0);
      const overall = Math.round(((index + rawPercent / 100) / variations) * 100);
      const message = eventData.message || phase;
      touchJob(job, {
        progress: Math.max(job.progress, overall),
        message
      });
      addJobEvent(job, { message, phase, percent: job.progress });
    });

    const info = await stat(outPath);
    const safeResult = sanitizeSkillResult(run.json);
    runs.push(safeResult);
    job.images.push({
      filename,
      path: outPath,
      url: `/outputs/${encodeURIComponent(filename)}`,
      bytes: info.size,
      revisedPrompt: safeResult.response?.revised_prompts?.[0] || ""
    });
    touchJob(job, {
      progress: Math.round(((index + 1) / variations) * 100),
      message: `第 ${index + 1}/${variations} 张已保存`
    });
    addJobEvent(job, { message: job.message, percent: job.progress });
  }

  const metadataPath = path.join(outputDir, `${job.base}.json`);
  await writeFile(metadataPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    provider: "codex",
    tool: "gpt-image-2-skill",
    params: job.params,
    prompt: job.prompt,
    referenceImage: job.referenceImage,
    runs,
    images: job.images
  }, null, 2), "utf8");

  touchJob(job, {
    status: "completed",
    progress: 100,
    message: `完成：${job.images.length} 张图片`,
    metadataPath
  });
  addJobEvent(job, { message: job.message, percent: 100 });
}

async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (true) {
      const job = queuedJobs.find((item) => item.status === "queued");
      if (!job) break;
      try {
        await runQueuedJob(job);
      } catch (error) {
        touchJob(job, {
          status: "failed",
          message: error.message || String(error),
          error: error.message || String(error)
        });
        addJobEvent(job, { message: job.message, percent: job.progress });
      }
    }
  } finally {
    queueRunning = false;
  }
}

async function streamCodexSkill(params, res) {
  if (!(await fileExists(gptImageSkillScript))) {
    const err = new Error("gpt-image-2-skill is not installed. Run npm install in this project first.");
    err.status = 503;
    throw err;
  }

  await ensureDirs();
  const prompt = buildPrompt(params);
  const format = cleanLine(params.outputFormat) || "png";
  const variations = clampInt(params.variations, 1, 4, 1);
  const base = `${nowStamp()}-${safeSlug(params.prompt)}`;
  const referenceImage = await saveReferenceImage(params, base);
  const images = [];
  const runs = [];

  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no"
  });

  writeNdjson(res, {
    type: "job_started",
    data: {
      provider: "codex",
      operation: referenceImage ? "edit" : "generate",
      variations,
      referenceImage,
      percent: 1
    }
  });

  for (let index = 0; index < variations; index += 1) {
    const filename = `${base}-${index + 1}.${skillOutputExt(format)}`;
    const outPath = path.join(outputDir, filename);
    const args = buildCodexSkillArgs(params, prompt, outPath, referenceImage?.path);
    writeNdjson(res, {
      type: "variant_started",
      data: {
        index: index + 1,
        total: variations,
        path: outPath,
        percent: Math.round((index / variations) * 100)
      }
    });

    const run = await runSkillStreaming(args, (event) => {
      const eventData = event.data || {};
      writeNdjson(res, {
        type: "tool_event",
        data: {
          index: index + 1,
          total: variations,
          eventType: event.type,
          phase: eventData.phase || event.type,
          status: eventData.status,
          message: eventData.message,
          percent: eventData.percent,
          image_count: eventData.image_count
        }
      });
    });

    const info = await stat(outPath);
    const safeResult = sanitizeSkillResult(run.json);
    runs.push(safeResult);
    images.push({
      filename,
      path: outPath,
      url: `/outputs/${encodeURIComponent(filename)}`,
      bytes: info.size,
      revisedPrompt: safeResult.response?.revised_prompts?.[0] || ""
    });
    writeNdjson(res, {
      type: "variant_completed",
      data: {
        index: index + 1,
        total: variations,
        image: images.at(-1),
        percent: Math.round(((index + 1) / variations) * 100)
      }
    });
  }

  const metadataPath = path.join(outputDir, `${base}.json`);
  await writeFile(metadataPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    provider: "codex",
    tool: "gpt-image-2-skill",
    params,
    prompt,
    referenceImage,
    runs,
    images
  }, null, 2), "utf8");

  writeNdjson(res, {
    type: "job_completed",
    data: {
      prompt,
      provider: "codex",
      tool: "gpt-image-2-skill",
      referenceImage,
      images,
      metadataPath,
      percent: 100
    }
  });
  res.end();
}

function safeStaticPath(baseDir, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(baseDir, normalized);
  const relative = path.relative(baseDir, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return fullPath;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath;
  if (url.pathname.startsWith("/outputs/")) {
    filePath = safeStaticPath(outputDir, url.pathname.replace(/^\/outputs\//, ""));
  } else if (url.pathname.startsWith("/uploads/")) {
    filePath = safeStaticPath(uploadDir, url.pathname.replace(/^\/uploads\//, ""));
  } else {
    filePath = safeStaticPath(publicDir, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  }

  if (!filePath) return text(res, 403, "Forbidden");
  try {
    const file = await readFile(filePath);
    const type = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(file);
  } catch {
    text(res, 404, "Not found");
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === "/api/config") {
    const codexSkillInstalled = await fileExists(gptImageSkillScript);
    const codexAuthReady = await hasCodexAuth();
    return json(res, 200, {
      openaiApiReady: Boolean(process.env.OPENAI_API_KEY),
      codexSkillReady: codexSkillInstalled && codexAuthReady,
      codexSkillInstalled,
      codexAuthReady,
      codexQueueAuto: true,
      codexBuiltInDirect: false,
      codexBridgeReady: true,
      projectDir: __dirname,
      requestDir,
      outputDir,
      uploadDir
    });
  }

  if (req.method === "GET" && url.pathname === "/api/jobs") {
    return json(res, 200, await listJobs());
  }

  if (req.method === "POST" && url.pathname === "/api/delete-output") {
    const params = await readJson(req);
    return json(res, 200, await deleteOutputImage(params.name));
  }

  if (req.method === "POST" && url.pathname === "/api/compose") {
    const params = await readJson(req);
    return json(res, 200, { prompt: buildPrompt(params) });
  }

  if (req.method === "POST" && url.pathname === "/api/queue") {
    const params = await readJson(req);
    return json(res, 200, await enqueueCodexJob(params));
  }

  if (req.method === "POST" && url.pathname === "/api/generate") {
    const params = await readJson(req);
    return json(res, 200, await generateWithOpenAI(params));
  }

  if (req.method === "POST" && url.pathname === "/api/generate-codex") {
    const params = await readJson(req);
    return json(res, 200, await generateWithCodexSkill(params));
  }

  if (req.method === "POST" && url.pathname === "/api/generate-codex-stream") {
    const params = await readJson(req);
    return await streamCodexSkill(params, res);
  }

  return json(res, 404, { error: "Unknown API route." });
}

async function main() {
  await ensureDirs();
  const server = createServer(async (req, res) => {
    try {
      if (req.url?.startsWith("/api/")) return await handleApi(req, res);
      return await serveStatic(req, res);
    } catch (error) {
      json(res, error.status || 500, { error: error.message || String(error) });
    }
  });

  server.listen(port, () => {
    console.log(`Codex Imagegen Platform: http://localhost:${port}`);
    console.log(`Project: ${__dirname}`);
    console.log(`OpenAI API mode: ${process.env.OPENAI_API_KEY ? "enabled" : "disabled (set OPENAI_API_KEY to enable)"}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
