const fields = [
  "prompt",
  "useCase",
  "stylePreset",
  "model",
  "size",
  "quality",
  "outputFormat",
  "transparent",
  "variations",
  "outputCompression",
  "subject",
  "scene",
  "composition",
  "camera",
  "lighting",
  "mood",
  "palette",
  "exactText",
  "styleNotes",
  "negative",
  "assetType"
];

const $ = (id) => document.getElementById(id);
const state = {
  config: null,
  prompt: "",
  refImage: null,
  generating: false,
  queuePoll: null
};

function getParams() {
  const params = {};
  for (const id of fields) {
    const el = $(id);
    params[id] = el.type === "checkbox" ? el.checked : el.value;
  }
  params.background = document.querySelector("input[name='background']:checked")?.value || "default";
  if (state.refImage) {
    params.refImageName = state.refImage.name;
    params.refImageType = state.refImage.type;
    params.refImageDataUrl = state.refImage.dataUrl;
  }
  return params;
}

function setStatus(message, kind = "") {
  const node = $("statusText");
  node.className = `status-text ${kind}`;
  node.textContent = message;
}

function setProgress(percent) {
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  $("progressFill").style.width = `${safe}%`;
  $("progressPercent").textContent = `${Math.round(safe)}%`;
}

function logEvent(message) {
  if (!message) return;
  const line = document.createElement("div");
  line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  $("eventLog").prepend(line);
  while ($("eventLog").children.length > 8) $("eventLog").lastChild.remove();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function deleteOutput(name, trigger) {
  if (!window.confirm(`\u5220\u9664\u8fd9\u5f20\u56fe\u7247\uff1f\n${name}`)) return;
  if (trigger) trigger.disabled = true;
  try {
    await api("/api/delete-output", {
      method: "POST",
      body: JSON.stringify({ name })
    });
    setStatus("\u56fe\u7247\u5df2\u5220\u9664\u3002", "good");
    await refreshJobs();
  } catch (error) {
    if (trigger) trigger.disabled = false;
    setStatus(`\u5220\u9664\u5931\u8d25\uff1a${error.message}`, "bad");
  }
}

async function refreshPrompt() {
  const body = await api("/api/compose", {
    method: "POST",
    body: JSON.stringify(getParams())
  });
  state.prompt = body.prompt;
  $("promptPreview").textContent = body.prompt;
  $("promptStats").textContent = `${body.prompt.length} 字符`;
}

async function refreshJobs() {
  const jobs = await api("/api/jobs");
  const gallery = $("gallery");
  gallery.innerHTML = "";
  if (!jobs.outputs.length) {
    gallery.innerHTML = "<div class=\"empty\">还没有输出图片</div>";
  } else {
    for (const image of jobs.outputs) {
      const tile = document.createElement("article");
      tile.className = "image-tile";
      tile.innerHTML = `
        <img src="${image.url}" alt="${escapeHtml(image.name)}">
        <div class="image-meta">${escapeHtml(image.name)}</div>
        <div class="image-actions">
          <a href="${image.url}" target="_blank" rel="noreferrer">打开</a>
          <a href="${image.url}" download="${escapeHtml(image.name)}">保存</a>
          <button type="button" class="danger" data-delete>\u5220\u9664</button>
        </div>
      `;
      tile.querySelector("[data-delete]").addEventListener("click", (event) => {
        deleteOutput(image.name, event.currentTarget);
      });
      gallery.append(tile);
    }
  }

  $("requestCount").textContent = String(jobs.requests.length);
  const requests = $("requests");
  requests.innerHTML = "";
  if (!jobs.requests.length) {
    requests.innerHTML = "<div class=\"empty\">还没有自动队列任务</div>";
  } else {
    for (const item of jobs.requests) {
      const node = document.createElement("article");
      node.className = `request-item queue-${item.status}`;
      const statusText = {
        queued: "等待中",
        running: "生成中",
        completed: "已完成",
        failed: "失败"
      }[item.status] || item.status;
      const imageLinks = (item.images || []).map((image) => `
        <a href="${image.url}" target="_blank" rel="noreferrer">打开</a>
        <a href="${image.url}" download="${escapeHtml(image.filename)}">保存</a>
      `).join("");
      const eventLines = (item.events || []).slice(-3).reverse().map((event) => `
        <div>${escapeHtml(event.message || event.phase || "")}</div>
      `).join("");
      node.innerHTML = `
        <div class="queue-title">
          <strong>${escapeHtml(item.prompt || item.id)}</strong>
          <span>${statusText}</span>
        </div>
        <div class="queue-meta">${new Date(item.createdAt).toLocaleString()} · ${item.operation === "edit" ? "图生图" : "文生图"}</div>
        <div class="queue-progress"><div style="width:${Math.max(0, Math.min(100, item.progress || 0))}%"></div></div>
        <div class="queue-message">${escapeHtml(item.error || item.message || "")}</div>
        ${imageLinks ? `<div class="queue-actions">${imageLinks}</div>` : ""}
        ${eventLines ? `<div class="queue-events">${eventLines}</div>` : ""}
      `;
      requests.append(node);
    }
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function validatePrompt() {
  return $("prompt").value.trim() ? "" : "先写主提示词。";
}

function validateApiGenerate(params) {
  if (!params.prompt.trim()) return "先写主提示词。";
  if (params.transparent && params.model === "gpt-image-2") {
    return "gpt-image-2 的 OpenAI API 不支持透明背景；请选择其他模型或关闭透明背景。";
  }
  return "";
}

function setBusy(isBusy) {
  state.generating = isBusy;
  $("codexBtn").disabled = isBusy || !state.config.codexSkillReady;
  $("apiBtn").disabled = isBusy || !state.config.openaiApiReady;
  $("queueBtn").disabled = !state.config.codexSkillReady;
  $("composeBtn").disabled = isBusy;
}

function updateModeBadge() {
  $("modeBadge").textContent = state.refImage ? "图生图" : "文生图";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("读取图片失败。"));
    reader.readAsDataURL(file);
  });
}

async function handleReferenceImage(file) {
  if (!file) {
    state.refImage = null;
    $("refImageName").textContent = "点击选择 PNG、JPG 或 WebP";
    $("refPreview").className = "ref-preview empty-preview";
    $("refPreview").textContent = "未选择参考图";
    updateModeBadge();
    await refreshPrompt();
    return;
  }
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
    setStatus("参考图只支持 PNG、JPG 或 WebP。", "bad");
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    setStatus("参考图不能超过 25MB。", "bad");
    return;
  }
  const dataUrl = await fileToDataUrl(file);
  state.refImage = { name: file.name, type: file.type, size: file.size, dataUrl };
  $("refImageName").textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
  $("refPreview").className = "ref-preview";
  $("refPreview").innerHTML = `<img src="${dataUrl}" alt="参考图预览">`;
  updateModeBadge();
  await refreshPrompt();
  setStatus("参考图已载入，Codex 生成会自动走图生图。", "good");
}

function progressFromPhase(phase, fallback = 0) {
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

async function streamCodexGenerate(params) {
  const response = await fetch("/api/generate-codex-stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params)
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      const data = event.data || {};
      if (event.type === "job_started") {
        setProgress(data.percent || 1);
        setStatus(data.operation === "edit" ? "已进入图生图流程。" : "已进入文生图流程。");
        logEvent(`任务开始：${data.operation === "edit" ? "图生图" : "文生图"}`);
      } else if (event.type === "variant_started") {
        setStatus(`正在生成第 ${data.index}/${data.total} 张。`);
        logEvent(`第 ${data.index}/${data.total} 张开始`);
      } else if (event.type === "tool_event") {
        const phase = data.phase || data.eventType;
        const percent = Number.isFinite(Number(data.percent))
          ? Number(data.percent)
          : progressFromPhase(phase, Number($("progressPercent").textContent.replace("%", "")));
        setProgress(percent);
        if (data.message) setStatus(data.message);
        if (data.message || phase) logEvent(data.message || phase);
      } else if (event.type === "variant_completed") {
        setProgress(data.percent || 100);
        setStatus(`第 ${data.index}/${data.total} 张已保存。`, "good");
        logEvent(`已保存：${data.image?.filename || "输出图片"}`);
      } else if (event.type === "job_completed") {
        completed = data;
        setProgress(100);
        setStatus(`Codex 生成完成：${data.images?.length || 0} 张图片`, "good");
        logEvent("任务完成");
      }
    }
  }

  return completed;
}

async function init() {
  state.config = await api("/api/config");
  $("apiBadge").textContent = state.config.codexSkillReady
    ? "Codex 可用"
    : state.config.openaiApiReady
      ? "API 已启用"
      : "未配置";
  $("codexBtn").disabled = !state.config.codexSkillReady;
  $("queueBtn").disabled = !state.config.codexSkillReady;
  if (!state.config.codexSkillReady) {
    $("codexBtn").title = state.config.codexSkillInstalled
      ? "没有找到 Codex 登录态 auth.json。"
      : "没有找到 gpt-image-2-skill 本地依赖。";
  }
  $("apiBtn").disabled = !state.config.openaiApiReady;
  if (!state.config.openaiApiReady) {
    $("apiBtn").title = "启动服务前设置 OPENAI_API_KEY 后可直接生成。";
  }

  for (const id of fields) {
    $(id).addEventListener("input", debounce(async () => {
      await refreshPrompt().catch((error) => setStatus(error.message, "bad"));
    }, 180));
  }
  for (const bg of document.querySelectorAll("input[name='background']")) {
    bg.addEventListener("change", refreshPrompt);
  }
  $("refImage").addEventListener("change", async (event) => {
    await handleReferenceImage(event.target.files?.[0]);
  });

  $("composeBtn").addEventListener("click", async () => {
    await refreshPrompt();
    setStatus("提示词已更新。", "good");
  });

  $("queueBtn").addEventListener("click", async () => {
    const params = getParams();
    const warning = validatePrompt();
    if (warning) return setStatus(warning, "bad");
    const result = await api("/api/queue", {
      method: "POST",
      body: JSON.stringify(params)
    });
    await refreshJobs();
    setStatus(`已加入自动队列：${result.prompt}`, "good");
  });

  $("codexBtn").addEventListener("click", async () => {
    const params = getParams();
    const warning = validatePrompt();
    if (warning) return setStatus(warning, "bad");
    setBusy(true);
    setProgress(0);
    $("eventLog").innerHTML = "";
    setStatus("正在连接 Codex 生成服务。");
    try {
      await streamCodexGenerate(params);
      await refreshJobs();
    } catch (error) {
      setStatus(error.message, "bad");
      logEvent(`失败：${error.message}`);
    } finally {
      setBusy(false);
    }
  });

  $("apiBtn").addEventListener("click", async () => {
    const params = getParams();
    const warning = validateApiGenerate(params);
    if (warning) return setStatus(warning, "bad");
    setBusy(true);
    setProgress(8);
    setStatus("正在调用 OpenAI Images API，复杂图可能需要一两分钟。");
    try {
      const result = await api("/api/generate", {
        method: "POST",
        body: JSON.stringify(params)
      });
      setProgress(100);
      await refreshJobs();
      setStatus(`生成完成：${result.images.length} 张图片`, "good");
    } catch (error) {
      setStatus(error.message, "bad");
    } finally {
      setBusy(false);
    }
  });

  $("copyBtn").addEventListener("click", async () => {
    await refreshPrompt();
    await navigator.clipboard.writeText(state.prompt);
    setStatus("提示词已复制。", "good");
  });

  $("manualBtn").addEventListener("click", () => {
    const dialog = $("manualDialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  });

  $("manualClose").addEventListener("click", () => {
    $("manualDialog").close();
  });

  $("manualDialog").addEventListener("click", (event) => {
    if (event.target === $("manualDialog")) $("manualDialog").close();
  });

  $("refreshBtn").addEventListener("click", refreshJobs);

  await refreshPrompt();
  await refreshJobs();
  state.queuePoll = setInterval(() => {
    refreshJobs().catch(() => {});
  }, 1500);
  updateModeBadge();
  setStatus(
    state.config.codexSkillReady
      ? "Codex 生成可用；上传参考图后自动切到图生图。"
      : state.config.openaiApiReady
        ? "API 模式可用；Codex 生成需要 gpt-image-2-skill 和 auth.json。"
        : "自动队列需要 Codex 登录态或 OPENAI_API_KEY。",
    "good"
  );
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

init().catch((error) => setStatus(error.message, "bad"));
