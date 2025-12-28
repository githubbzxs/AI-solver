const form = document.getElementById("solve-form");
const promptInput = document.getElementById("prompt");
const imageInput = document.getElementById("image");
const fileName = document.getElementById("fileName");
const dropzone = document.getElementById("dropzone");
const dropzoneEmpty = document.getElementById("dropzoneEmpty");
const dropzonePreview = document.getElementById("dropzonePreview");
const imagePreviewList = document.getElementById("imagePreviewList");
const removeImageBtn = document.getElementById("removeImageBtn");
const statusTag = document.getElementById("status");
const answerBox = document.getElementById("answer");
const errorBox = document.getElementById("error");
const errorToggle = document.getElementById("errorToggle");
const errorDetails = document.getElementById("errorDetails");
const submitBtn = document.getElementById("submitBtn");
const modelBadge = document.getElementById("modelBadge");
const spinner = document.getElementById("spinner");
const copyBtn = document.getElementById("copyBtn");
const pasteBtn = document.getElementById("pasteBtn");
const notice = document.getElementById("notice");
const historyList = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const historyToggle = document.getElementById("historyToggle");
const settingsToggle = document.getElementById("settingsToggle");
const historyModal = document.getElementById("historyModal");
const settingsModal = document.getElementById("settingsModal");

const STORAGE = {
  keys: "gemini_api_keys",
  model: "gemini_model",
  usage: "gemini_usage",
  keyIndex: "gemini_key_index",
  history: "gemini_history",
};

const loadKeys = () => {
  try {
    const raw = localStorage.getItem(STORAGE.keys);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
};

const maskKey = (key) => {
  if (!key) return "****";
  const trimmed = key.trim();
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
};

const getModel = () => localStorage.getItem(STORAGE.model) || "gemini-3-flash-preview";

const updateSettingsSummary = () => {
  const model = getModel();
  if (modelBadge) {
    modelBadge.textContent = `模型：${model}`;
  }
};

const pickKey = (keys) => {
  const currentIndex = Number.parseInt(
    localStorage.getItem(STORAGE.keyIndex) || "0",
    10
  );
  const index = Number.isNaN(currentIndex) ? 0 : currentIndex;
  const selected = keys[index % keys.length];
  localStorage.setItem(STORAGE.keyIndex, String((index + 1) % keys.length));
  return selected;
};

const setStatus = (text, isLoading) => {
  statusTag.textContent = text;
  statusTag.classList.toggle("loading", Boolean(isLoading));
};

const setLoading = (isLoading) => {
  spinner.hidden = !isLoading;
  submitBtn.disabled = isLoading;
};

let noticeTimer = null;

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

const renderMarkdown = (text) => {
  if (window.marked) {
    return window.marked.parse(text, { breaks: true });
  }
  return text.replace(/[&<>"]/g, (ch) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" };
    return map[ch] || ch;
  });
};

const applyImageFile = (file) => {
  if (!file) return false;
  setSelectedImages([file], { replace: false, announce: "已粘贴图片" });
  return true;
};

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

const loadHistory = () => {
  try {
    const raw = localStorage.getItem(STORAGE.history);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
};

const saveHistory = (items) => {
  localStorage.setItem(STORAGE.history, JSON.stringify(items));
};

let previewUrls = [];
let selectedImages = [];

const clearPreviewUrls = () => {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
};

const syncImageInput = () => {
  try {
    const transfer = new DataTransfer();
    selectedImages.forEach((file) => transfer.items.add(file));
    imageInput.files = transfer.files;
  } catch (error) {
    // Some browsers block programmatic file assignment.
  }
};

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

const removeImageAt = (index) => {
  if (!Number.isFinite(index)) return;
  selectedImages = selectedImages.filter((_, idx) => idx !== index);
  syncImageInput();
  updateDropzone();
};

const updateDropzone = () => {
  const files = selectedImages;
  clearPreviewUrls();

  if (!files.length) {
    dropzoneEmpty.hidden = false;
    dropzonePreview.hidden = true;
    fileName.textContent = "未选择图片";
    if (imagePreviewList) imagePreviewList.innerHTML = "";
    return;
  }

  dropzoneEmpty.hidden = true;
  dropzonePreview.hidden = false;
  fileName.textContent = `已选择 ${files.length} 张图片`;

  if (!imagePreviewList) return;
  imagePreviewList.innerHTML = "";

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

const renderHistory = () => {
  const items = loadHistory();
  historyList.innerHTML = "";
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "暂无记录";
    historyList.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("details");
    card.className = "history-item";

    const summary = document.createElement("summary");
    summary.className = "history-summary";

    const summaryLeft = document.createElement("span");
    summaryLeft.textContent = `${item.time} · ${item.model || "gemini-3-flash-preview"}`;

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

const addHistory = ({ prompt, answer, model, imageName }) => {
  const items = loadHistory();
  const time = new Date().toLocaleString("zh-CN", { hour12: false });
  const entry = {
    id: Date.now(),
    time,
    prompt,
    answer,
    model,
    imageName,
  };
  const updated = [entry, ...items].slice(0, 20);
  saveHistory(updated);
  renderHistory();
};

const recordUsage = (key, usage) => {
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const totalTokens =
    usage?.totalTokenCount ||
    (usage?.promptTokenCount || 0) + (usage?.candidatesTokenCount || 0);

  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(STORAGE.usage) || "{}");
  } catch (error) {
    store = {};
  }

  const today = store[dayKey] || { requests: 0, tokens: 0, perKey: {} };
  today.requests += 1;
  today.tokens += totalTokens || 0;

  const label = maskKey(key);
  const perKey = today.perKey[label] || { requests: 0, tokens: 0 };
  perKey.requests += 1;
  perKey.tokens += totalTokens || 0;
  today.perKey[label] = perKey;

  store[dayKey] = today;
  localStorage.setItem(STORAGE.usage, JSON.stringify(store));
};

imageInput.addEventListener("change", () => {
  setSelectedImages(imageInput.files, { replace: true });
});

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

removeImageBtn.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  selectedImages = [];
  syncImageInput();
  updateDropzone();
});

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

copyBtn.addEventListener("click", async () => {
  const text = answerBox.textContent.trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showNotice("已复制");
  } catch (error) {
    showNotice("复制失败", "error");
  }
});

clearHistoryBtn.addEventListener("click", () => {
  saveHistory([]);
  renderHistory();
});

errorToggle.addEventListener("click", () => {
  const isHidden = errorDetails.hidden;
  errorDetails.hidden = !isHidden;
  errorToggle.textContent = isHidden ? "隐藏详情" : "查看详情";
});

const openModal = (modal) => {
  if (!modal) return;
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
};

const closeModal = (modal) => {
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
};

historyToggle.addEventListener("click", () => {
  openModal(historyModal);
});

settingsToggle.addEventListener("click", () => {
  openModal(settingsModal);
});

document.querySelectorAll("[data-open=\"settings\"]").forEach((btn) => {
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    openModal(settingsModal);
  });
});

document.querySelectorAll("[data-close=\"history\"]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(historyModal));
});

document.querySelectorAll("[data-close=\"settings\"]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(settingsModal));
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeModal(historyModal);
  closeModal(settingsModal);
});

document.addEventListener("DOMContentLoaded", () => {
  updateSettingsSummary();
  renderHistory();
  updateDropzone();
});

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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  errorDetails.textContent = "";
  errorDetails.hidden = true;
  errorToggle.textContent = "查看详情";

  const keys = loadKeys();
  const model = getModel();
  const prompt = promptInput.value.trim();
  const files = selectedImages;

  if (!prompt && files.length === 0) {
    errorDetails.textContent = "请填写题目或上传图片。";
    errorDetails.hidden = true;
    errorToggle.textContent = "查看详情";
    errorBox.hidden = false;
    return;
  }

  if (keys.length === 0) {
    errorDetails.textContent = "未保存 API Key，请先在设置页添加。";
    errorDetails.hidden = true;
    errorToggle.textContent = "查看详情";
    errorBox.hidden = false;
    return;
  }

  const apiKey = pickKey(keys);
  const formData = new FormData();
  formData.append("apiKey", apiKey);
  formData.append("model", model);
  if (prompt) formData.append("prompt", prompt);
  files.forEach((file) => {
    formData.append("image", file);
  });

  setLoading(true);
  answerBox.textContent = "正在解答，请稍候...";
  setStatus("处理中", true);

  try {
    const response = await fetch("/api/solve", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "请求失败。");
    }

    const answerText = data.answer || "暂无返回内容。";
    answerBox.innerHTML = renderMarkdown(answerText);
    renderMath(answerBox);
    recordUsage(apiKey, data.usage);
    addHistory({
      prompt,
      answer: data.answer,
      model: data.model,
      imageName: files.length ? files.map((file) => file.name) : [],
    });
    setStatus("完成", false);
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
