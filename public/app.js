const form = document.getElementById("solve-form");
const promptInput = document.getElementById("prompt");
const imageInput = document.getElementById("image");
const fileName = document.getElementById("fileName");
const statusTag = document.getElementById("status");
const answerBox = document.getElementById("answer");
const errorBox = document.getElementById("error");
const submitBtn = document.getElementById("submitBtn");
const settingsSummary = document.getElementById("settingsSummary");
const settingsHint = document.getElementById("settingsHint");
const spinner = document.getElementById("spinner");
const copyBtn = document.getElementById("copyBtn");
const pasteBtn = document.getElementById("pasteBtn");

const STORAGE = {
  keys: "gemini_api_keys",
  model: "gemini_model",
  usage: "gemini_usage",
  keyIndex: "gemini_key_index",
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
  const keys = loadKeys();
  const model = getModel();
  if (keys.length === 0) {
    settingsSummary.textContent = "No keys saved. Open Settings to add API keys.";
    settingsHint.classList.add("warn");
  } else {
    settingsSummary.textContent = `Keys: ${keys.length} · Model: ${model}`;
    settingsHint.classList.remove("warn");
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
  const file = imageInput.files[0];
  fileName.textContent = file ? file.name : "No image selected.";
});

pasteBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      setStatus("Clipboard empty", false);
      return;
    }
    if (!promptInput.value.trim()) {
      promptInput.value = text;
      promptInput.focus();
      setStatus("Pasted", false);
      return;
    }

    const prefix = promptInput.value.endsWith("\n") || text.startsWith("\n") ? "" : "\n";
    insertAtCursor(promptInput, prefix + text);
    setStatus("Pasted", false);
  } catch (error) {
    setStatus("Paste blocked", false);
    errorBox.textContent = "Clipboard permission denied. Please paste manually.";
    errorBox.hidden = false;
  }
});

copyBtn.addEventListener("click", async () => {
  const text = answerBox.textContent.trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied", false);
  } catch (error) {
    setStatus("Copy failed", false);
  }
});

document.addEventListener("DOMContentLoaded", updateSettingsSummary);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;

  const keys = loadKeys();
  const model = getModel();
  const prompt = promptInput.value.trim();
  const file = imageInput.files[0];

  if (!prompt && !file) {
    errorBox.textContent = "Please type a question or attach an image.";
    errorBox.hidden = false;
    return;
  }

  if (keys.length === 0) {
    errorBox.textContent = "No API keys saved. Open Settings to add keys.";
    errorBox.hidden = false;
    return;
  }

  const apiKey = pickKey(keys);
  const formData = new FormData();
  formData.append("apiKey", apiKey);
  formData.append("model", model);
  if (prompt) formData.append("prompt", prompt);
  if (file) formData.append("image", file);

  setLoading(true);
  answerBox.textContent = "Thinking...";
  setStatus(`Working (${maskKey(apiKey)})`, true);

  try {
    const response = await fetch("/api/solve", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }

    answerBox.textContent = data.answer || "No answer returned.";
    recordUsage(apiKey, data.usage);
    setStatus("Done", false);
  } catch (error) {
    answerBox.textContent = "No answer.";
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    setStatus("Error", false);
  } finally {
    setLoading(false);
  }
});
