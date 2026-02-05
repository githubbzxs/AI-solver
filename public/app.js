/*
  前端主逻辑：
  - 处理文字/图片输入与预览
  - 管理剪贴板粘贴
  - 调用后端 /api/solve-stream 并渲染答案
  - 记录历史与用量统计
*/

// ===== 页面元素引用（集中获取，避免重复查询） =====
const form = document.getElementById("solve-form");
const promptInput = document.getElementById("prompt");
const imageInput = document.getElementById("image");
const fileName = document.getElementById("fileName");
const dropzone = document.getElementById("dropzone");
const dropzoneEmpty = document.getElementById("dropzoneEmpty");
const dropzonePreview = document.getElementById("dropzonePreview");
const imagePreviewList = document.getElementById("imagePreviewList");
const removeImageBtn = document.getElementById("removeImageBtn");
const answerBox = document.getElementById("answer");
const errorBox = document.getElementById("error");
const errorToggle = document.getElementById("errorToggle");
const errorDetails = document.getElementById("errorDetails");
const submitBtn = document.getElementById("submitBtn");
const spinner = document.getElementById("spinner");
const pasteBtn = document.getElementById("pasteBtn");
const notice = document.getElementById("notice");
const historyList = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const historyToggle = document.getElementById("historyToggle");
const settingsToggle = document.getElementById("settingsToggle");
const historyModal = document.getElementById("historyModal");
const settingsModal = document.getElementById("settingsModal");

// localStorage 的字段名集中管理
const STORAGE = {
  keys: "gemini_api_keys",
  usage: "gemini_usage",
  keyIndex: "gemini_key_index",
  invalidKeys: "gemini_invalid_keys",
  history: "gemini_history",
};

// 从 localStorage 读取保存的 API Key 列表（JSON 字符串）
const loadKeys = () => {
  try {
    const raw = localStorage.getItem(STORAGE.keys);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
};

const loadInvalidKeys = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE.invalidKeys) || "{}");
  } catch (error) {
    return {};
  }
};

const saveInvalidKeys = (map) => {
  localStorage.setItem(STORAGE.invalidKeys, JSON.stringify(map));
};

const markInvalidKey = (key, reason) => {
  const trimmed = (key || "").trim();
  if (!trimmed) return;
  const map = loadInvalidKeys();
  map[trimmed] = {
    reason: reason || "不可用",
    time: new Date().toISOString(),
  };
  saveInvalidKeys(map);
  window.dispatchEvent(new Event("keys-status-changed"));
};

const clearInvalidKey = (key) => {
  const trimmed = (key || "").trim();
  if (!trimmed) return;
  const map = loadInvalidKeys();
  if (!map[trimmed]) return;
  delete map[trimmed];
  saveInvalidKeys(map);
  window.dispatchEvent(new Event("keys-status-changed"));
};

// 脱敏展示 Key：只保留前后几位
const maskKey = (key) => {
  if (!key) return "****";
  const trimmed = key.trim();
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
};

const getKeyIndex = (length) => {
  const rawIndex = Number.parseInt(
    localStorage.getItem(STORAGE.keyIndex) || "0",
    10
  );
  if (!Number.isFinite(length) || length <= 0) return 0;
  const safeIndex = Number.isNaN(rawIndex) ? 0 : rawIndex;
  return ((safeIndex % length) + length) % length;
};

const buildKeyQueue = (keys) => {
  const invalidMap = loadInvalidKeys();
  const startIndex = getKeyIndex(keys.length);
  const rotated = keys.slice(startIndex).concat(keys.slice(0, startIndex));
  const validKeys = rotated.filter((key) => !invalidMap[(key || "").trim()]);
  return validKeys.length ? validKeys : rotated;
};

const setNextKeyIndex = (keys, usedKey) => {
  if (!Array.isArray(keys) || keys.length === 0) return;
  const index = keys.findIndex((item) => item === usedKey);
  if (index < 0) return;
  localStorage.setItem(STORAGE.keyIndex, String((index + 1) % keys.length));
};

// 更新状态标签文本，并标记是否在加载中
const setStatus = (_text, _isLoading) => {};

// 控制加载动画与按钮禁用
const setLoading = (isLoading) => {
  spinner.hidden = !isLoading;
  submitBtn.disabled = isLoading;
};

// toast 通知的定时器句柄
let noticeTimer = null;

// 显示短暂提示，并在超时后自动隐藏
const showNotice = (text, tone = "default") => {
  if (!notice) return;
  notice.textContent = text;
  notice.dataset.tone = tone;
  notice.hidden = false;
  notice.classList.add("is-visible");
  if (noticeTimer) window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    notice.classList.remove("is-visible");
    window.setTimeout(() => {
      notice.hidden = true;
    }, 220);
  }, 2000);
};

// 使用 KaTeX 自动渲染公式（支持常见数学分隔符）
const renderMath = (element) => {
  if (!window.renderMathInElement) return;
  window.renderMathInElement(element, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\[", right: "\\]", display: true },
      { left: "$", right: "$", display: false },
      { left: "\\(", right: "\\)", display: false },
    ],
    throwOnError: false,
  });
};

// 使用 marked 渲染 Markdown；无库时回退为安全文本
const renderMarkdown = (text) => {
  if (window.marked) {
    return window.marked.parse(text, { breaks: true });
  }
  return text.replace(/[&<>"]/g, (ch) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" };
    return map[ch] || ch;
  });
};

const parseSseEvent = (block) => {
  const lines = block.split(/\r?\n/);
  let eventType = "message";
  const dataLines = [];
  lines.forEach((line) => {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim() || "message";
      return;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  });
  if (dataLines.length === 0) return null;
  return {
    event: eventType,
    data: dataLines.join("\n"),
  };
};

const streamSolve = async (formData, onChunk) => {
  const response = await fetch("/api/solve-stream", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let errorMessage = "请求失败。";
    let details = null;
    try {
      const data = await response.json();
      details = data;
      if (data?.error) errorMessage = data.error;
    } catch (error) {
      details = null;
    }
    return {
      ok: false,
      status: response.status,
      message: errorMessage,
      details,
    };
  }

  if (!response.body) {
    return { ok: false, status: 0, message: "浏览器不支持流式响应。" };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let usage = null;
  let model = null;
  let streamError = null;

  const handleEvent = (evt) => {
    if (!evt) return;
    if (evt.event === "chunk") {
      let payload = null;
      try {
        payload = JSON.parse(evt.data);
      } catch (error) {
        payload = null;
      }
      const text = payload?.text || "";
      if (!text) return;
      answer += text;
      if (onChunk) onChunk(text, answer);
      return;
    }
    if (evt.event === "done") {
      let payload = null;
      try {
        payload = JSON.parse(evt.data);
      } catch (error) {
        payload = null;
      }
      if (payload?.usage) usage = payload.usage;
      if (payload?.model) model = payload.model;
      return;
    }
    if (evt.event === "error") {
      let payload = null;
      try {
        payload = JSON.parse(evt.data);
      } catch (error) {
        payload = null;
      }
      streamError = {
        status: payload?.status || response.status,
        message: payload?.message || "请求失败。",
        details: payload?.details || null,
      };
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() || "";
    blocks.forEach((block) => handleEvent(parseSseEvent(block)));
    if (streamError) break;
  }

  if (!streamError && buffer.trim()) {
    handleEvent(parseSseEvent(buffer));
  }

  if (streamError) {
    return {
      ok: false,
      status: streamError.status,
      message: streamError.message,
      details: streamError.details,
    };
  }

  return {
    ok: true,
    answer,
    usage,
    model,
  };
};

// 粘贴/选择单张图片时的快捷处理
const applyImageFile = (file) => {
  if (!file) return false;
  setSelectedImages([file], { replace: false, announce: "已粘贴图片" });
  return true;
};

// 在输入框光标位置插入文本，并保持光标位置正确
const insertAtCursor = (el, text) => {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  el.value = before + text + after;
  const next = start + text.length;
  el.selectionStart = next;
  el.selectionEnd = next;
  el.focus();
};

// 处理粘贴文本：若输入框为空则直接填入，否则追加到光标处
const applyPaste = (text) => {
  if (!text) return;
  if (!promptInput.value.trim()) {
    promptInput.value = text;
    promptInput.focus();
    showNotice("已粘贴");
    return;
  }

  const prefix = promptInput.value.endsWith("\n") || text.startsWith("\n") ? "" : "\n";
  insertAtCursor(promptInput, prefix + text);
  showNotice("已粘贴");
};

// 从 localStorage 读取历史记录
const loadHistory = () => {
  try {
    const raw = localStorage.getItem(STORAGE.history);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
};

// 保存历史记录到 localStorage
const saveHistory = (items) => {
  localStorage.setItem(STORAGE.history, JSON.stringify(items));
};

// 当前预览图与已选择图片（仅在内存中维护）
let previewUrls = [];
let selectedImages = [];

// 释放 ObjectURL，避免内存泄露
const clearPreviewUrls = () => {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
};

// 将内存中的图片同步回 <input type="file">（部分浏览器可能受限）
const syncImageInput = () => {
  try {
    const transfer = new DataTransfer();
    selectedImages.forEach((file) => transfer.items.add(file));
    imageInput.files = transfer.files;
  } catch (error) {
    // Some browsers block programmatic file assignment.
  }
};

// 设置/追加图片列表，并刷新预览与提示
const setSelectedImages = (files, { replace = false, announce = "" } = {}) => {
  const images = Array.from(files || []).filter(
    (file) => file && file.type && file.type.startsWith("image/")
  );
  if (images.length === 0) {
    if (announce) showNotice(announce, "error");
    return;
  }
  selectedImages = replace ? images : [...selectedImages, ...images];
  syncImageInput();
  updateDropzone();
  if (announce) showNotice(announce);
};

// 按索引移除图片
const removeImageAt = (index) => {
  if (!Number.isFinite(index)) return;
  selectedImages = selectedImages.filter((_, idx) => idx !== index);
  syncImageInput();
  updateDropzone();
};

// 根据当前图片列表刷新上传区域与缩略图预览
const updateDropzone = () => {
  const files = selectedImages;
  clearPreviewUrls();

  // 没有图片时显示“空状态”
  if (!files.length) {
    dropzoneEmpty.hidden = false;
    dropzonePreview.hidden = true;
    fileName.textContent = "未选择图片";
    if (imagePreviewList) imagePreviewList.innerHTML = "";
    return;
  }

  // 有图片时展示预览列表
  dropzoneEmpty.hidden = true;
  dropzonePreview.hidden = false;
  fileName.textContent = `已选择 ${files.length} 张图片`;

  if (!imagePreviewList) return;
  imagePreviewList.innerHTML = "";

  // 为每张图片创建缩略图与删除按钮
  files.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    previewUrls.push(url);
    const item = document.createElement("div");
    item.className = "preview-item";

    const img = document.createElement("img");
    img.src = url;
    img.alt = `已上传图片：${file.name}`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "preview-remove";
    remove.dataset.index = String(index);
    remove.setAttribute("aria-label", "移除图片");
    remove.textContent = "×";

    item.appendChild(img);
    item.appendChild(remove);
    imagePreviewList.appendChild(item);
  });
};

// 渲染历史记录列表（使用 <details> 展开/折叠）
const renderHistory = () => {
  const items = loadHistory();
  historyList.innerHTML = "";
  // 空列表时给一个占位提示
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "暂无记录";
    historyList.appendChild(empty);
    return;
  }

  // 使用 <details>/<summary> 让每条记录可展开
  items.forEach((item) => {
    const card = document.createElement("details");
    card.className = "history-item";

    const summary = document.createElement("summary");
    summary.className = "history-summary";

    const summaryLeft = document.createElement("span");
    summaryLeft.textContent = item.time;

    const summaryRight = document.createElement("span");
    summaryRight.className = "history-open";
    summaryRight.textContent = "查看详情";

    summary.appendChild(summaryLeft);
    summary.appendChild(summaryRight);

    const prompt = document.createElement("div");
    prompt.className = "history-block";
    prompt.textContent = `题目：${item.prompt || "（无文本）"}`;

    const answer = document.createElement("div");
    answer.className = "history-block";
    answer.textContent = `答案：${item.answer || "（无回答）"}`;

    card.appendChild(summary);
    const imageNames = Array.isArray(item.imageName)
      ? item.imageName
      : item.imageName
      ? [item.imageName]
      : [];
    if (imageNames.length) {
      const img = document.createElement("div");
      img.className = "history-meta";
      img.textContent = `图片：${imageNames.join("、")}`;
      card.appendChild(img);
    }
    card.appendChild(prompt);
    card.appendChild(answer);
    historyList.appendChild(card);
  });

  renderMath(historyList);
};

// 新增一条历史记录，并限制总数量
const addHistory = ({ prompt, answer, imageName }) => {
  const items = loadHistory();
  // 使用本地时间字符串便于用户阅读
  const time = new Date().toLocaleString("zh-CN", { hour12: false });
  const entry = {
    id: Date.now(),
    time,
    prompt,
    answer,
    imageName,
  };
  // 最新的放在最前，最多保留 20 条
  const updated = [entry, ...items].slice(0, 20);
  saveHistory(updated);
  renderHistory();
};

// 记录用量：按天、按 Key 汇总，便于设置页展示
const recordUsage = (key, usage) => {
  const now = new Date();
  // 以日期（YYYY-MM-DD）作为存储 key，便于按天统计
  const dayKey = now.toISOString().slice(0, 10);
  const hourKey = String(now.getHours()).padStart(2, "0");
  // API 返回结构可能不同，这里兼容总 token 或拆分 token
  const totalTokens =
    usage?.totalTokenCount ||
    (usage?.promptTokenCount || 0) + (usage?.candidatesTokenCount || 0);

  // 读取已有用量数据（坏数据则回退为空对象）
  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(STORAGE.usage) || "{}");
  } catch (error) {
    store = {};
  }

  // 初始化当天统计结构
  const today = store[dayKey] || { requests: 0, tokens: 0, perKey: {} };
  today.requests += 1;
  today.tokens += totalTokens || 0;
  if (!today.perHour) {
    today.perHour = {};
  }
  today.perHour[hourKey] = (today.perHour[hourKey] || 0) + 1;

  // 按 Key 再细分统计（Key 使用脱敏形式）
  const label = maskKey(key);
  const perKey = today.perKey[label] || { requests: 0, tokens: 0 };
  perKey.requests += 1;
  perKey.tokens += totalTokens || 0;
  today.perKey[label] = perKey;

  // 写回 localStorage
  store[dayKey] = today;
  localStorage.setItem(STORAGE.usage, JSON.stringify(store));
};

// 选择文件后，刷新图片列表
imageInput.addEventListener("change", () => {
  setSelectedImages(imageInput.files, { replace: true });
});

// 点击/键盘触发上传（可访问性：Enter/空格）
dropzone.addEventListener("click", (event) => {
  if (event.target.closest("#removeImageBtn")) return;
  if (event.target.closest(".preview-remove")) return;
  imageInput.click();
});

dropzone.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  imageInput.click();
});

// 清空所有已选图片
removeImageBtn.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  selectedImages = [];
  syncImageInput();
  updateDropzone();
});

// 缩略图上的“×”使用事件委托
if (imagePreviewList) {
  imagePreviewList.addEventListener("click", (event) => {
    const button = event.target.closest(".preview-remove");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number.parseInt(button.dataset.index || "", 10);
    if (Number.isNaN(index)) return;
    removeImageAt(index);
  });
}

// 一键粘贴：优先读取图片，其次读取文本
pasteBtn.addEventListener("click", async () => {
  let handledImage = false;
  if (navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      const imageFiles = [];
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        imageFiles.push(new File([blob], "clipboard-image.png", { type: blob.type }));
      }
      if (imageFiles.length) {
        setSelectedImages(imageFiles, {
          replace: false,
          announce: `已粘贴 ${imageFiles.length} 张图片`,
        });
        handledImage = true;
      }
    } catch (error) {
      handledImage = false;
    }
  }

  if (handledImage) return;

  if (!navigator.clipboard?.readText) {
    showNotice("浏览器不支持一键粘贴，请长按输入框粘贴", "error");
    promptInput.focus();
    return;
  }

  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      promptInput.focus();
      return;
    }
    applyPaste(text);
  } catch (error) {
    promptInput.focus();
    showNotice("无法读取剪贴板，请长按输入框粘贴", "error");
  }
});

// 清空历史记录
clearHistoryBtn.addEventListener("click", () => {
  saveHistory([]);
  renderHistory();
});

// 展开/收起错误详情
errorToggle.addEventListener("click", () => {
  const isHidden = errorDetails.hidden;
  errorDetails.hidden = !isHidden;
  errorToggle.textContent = isHidden ? "隐藏详情" : "查看详情";
});

// 打开弹窗：禁用页面滚动
const openModal = (modal) => {
  if (!modal) return;
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
};

// 关闭弹窗：恢复页面滚动
const closeModal = (modal) => {
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
};

// 顶部按钮打开弹窗
if (historyToggle) {
  historyToggle.addEventListener("click", () => {
    openModal(historyModal);
  });
}

if (settingsToggle) {
  settingsToggle.addEventListener("click", () => {
    openModal(settingsModal);
  });
}

// 允许其他入口打开设置弹窗（例如提示按钮）
document.querySelectorAll("[data-open=\"settings\"]").forEach((btn) => {
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    openModal(settingsModal);
  });
});

// 点击遮罩或关闭按钮关闭弹窗
document.querySelectorAll("[data-close=\"history\"]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(historyModal));
});

document.querySelectorAll("[data-close=\"settings\"]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(settingsModal));
});

// ESC 快捷键关闭弹窗
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeModal(historyModal);
  closeModal(settingsModal);
});

// 页面初始化：更新模型提示/历史/上传区
document.addEventListener("DOMContentLoaded", () => {
  if (window.GeminiTheme?.setThemePreference) {
    window.GeminiTheme.setThemePreference("system");
  }
  renderHistory();
  updateDropzone();
});

// 监听系统粘贴事件：若是图片则直接加入预览
document.addEventListener("paste", (event) => {
  const clipboard = event.clipboardData;
  if (!clipboard) return;
  const items = Array.from(clipboard.items || []);
  const imageItems = items
    .filter((item) => item.type && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (imageItems.length) {
    event.preventDefault();
    setSelectedImages(imageItems, {
      replace: false,
      announce: `已粘贴 ${imageItems.length} 张图片`,
    });
    return;
  }
  const files = Array.from(clipboard.files || []).filter(
    (file) => file.type && file.type.startsWith("image/")
  );
  if (!files.length) return;
  event.preventDefault();
  setSelectedImages(files, {
    replace: false,
    announce: `已粘贴 ${files.length} 张图片`,
  });
});

// 主流程：提交题目 -> 请求后端 -> 渲染答案/记录历史
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  errorDetails.textContent = "";
  errorDetails.hidden = true;
  errorToggle.textContent = "查看详情";

  const keys = loadKeys();
  const prompt = promptInput.value.trim();
  const files = selectedImages;

  // 校验：至少有文字或图片
  if (!prompt && files.length === 0) {
    errorDetails.textContent = "请填写题目或上传图片。";
    errorDetails.hidden = true;
    errorToggle.textContent = "查看详情";
    errorBox.hidden = false;
    return;
  }

  // 校验：必须先保存 API Key
  if (keys.length === 0) {
    errorDetails.textContent = "未保存 API Key，请先在设置页添加。";
    errorDetails.hidden = true;
    errorToggle.textContent = "查看详情";
    errorBox.hidden = false;
    return;
  }

  // UI 进入加载状态
  setLoading(true);
  answerBox.textContent = "正在解答，请稍候...";
  setStatus("处理中", true);

  try {
    const queue = buildKeyQueue(keys);
    let lastError = "";
    let solved = false;

    const isKeyError = (status, message) => {
      const text = (message || "").toLowerCase();
      if (status === 401 || status === 403 || status === 429) return true;
      if (text.includes("api key") || text.includes("apikey")) return true;
      if (text.includes("key") && (text.includes("invalid") || text.includes("expired"))) {
        return true;
      }
      if (text.includes("quota") || text.includes("resource exhausted")) return true;
      if (text.includes("permission") || text.includes("unauthorized")) return true;
      return false;
    };

    const getInvalidReason = (status, message) => {
      const text = (message || "").toLowerCase();
      if (text.includes("quota") || text.includes("resource exhausted")) return "配额不足";
      if (text.includes("expired")) return "已过期";
      if (text.includes("not valid") || text.includes("invalid")) return "无效";
      if (text.includes("permission") || text.includes("unauthorized")) return "无权限";
      if (status === 429) return "配额不足";
      if (status === 401 || status === 403) return "无效";
      return "不可用";
    };

    for (const apiKey of queue) {
      const formData = new FormData();
      formData.append("apiKey", apiKey);
      if (prompt) formData.append("prompt", prompt);
      files.forEach((file) => {
        formData.append("image", file);
      });

      try {
        let started = false;
        const result = await streamSolve(formData, (_delta, fullText) => {
          if (!started) {
            answerBox.textContent = "";
            started = true;
          }
          answerBox.textContent = fullText;
        });

        if (!result.ok) {
          const message = result.message || "请求失败。";
          lastError = message;
          if (isKeyError(result.status, message)) {
            markInvalidKey(apiKey, getInvalidReason(result.status, message));
          }
          continue;
        }

        clearInvalidKey(apiKey);
        setNextKeyIndex(keys, apiKey);

        const finalAnswer = result.answer || "暂无返回内容。";
        answerBox.innerHTML = renderMarkdown(finalAnswer);
        renderMath(answerBox);
        recordUsage(apiKey, result.usage);
        addHistory({
          prompt,
          answer: finalAnswer,
          imageName: files.length ? files.map((file) => file.name) : [],
        });
        setStatus("完成", false);
        solved = true;
        break;
      } catch (error) {
        lastError = error.message || "请求失败。";
        continue;
      }
    }

    if (!solved) {
      throw new Error(lastError || "请求失败。");
    }
  } catch (error) {
    answerBox.textContent = "暂无答案。";
    errorDetails.textContent = error.message;
    errorDetails.hidden = true;
    errorToggle.textContent = "查看详情";
    errorBox.hidden = false;
    setStatus("错误", false);
  } finally {
    setLoading(false);
  }
});

