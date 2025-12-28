(function () {
const keysInput = document.getElementById("keysInput");
const toggleKeysBtn = document.getElementById("toggleKeysBtn");
const saveKeysBtn = document.getElementById("saveKeysBtn");
const clearKeysBtn = document.getElementById("clearKeysBtn");
const keysSummary = document.getElementById("keysSummary");
const keyList = document.getElementById("keyList");

const modelInput = document.getElementById("modelInput");
const saveModelBtn = document.getElementById("saveModelBtn");
const modelHint = document.getElementById("modelHint");

const usageSummary = document.getElementById("usageSummary");
const usageList = document.getElementById("usageList");
const resetUsageBtn = document.getElementById("resetUsageBtn");

const themeSelect = document.getElementById("themeSelect");

const STORAGE = {
  keys: "gemini_api_keys",
  model: "gemini_model",
  usage: "gemini_usage",
  keyIndex: "gemini_key_index",
  keysVisibility: "gemini_keys_visibility",
};

const maskKey = (key) => {
  if (!key) return "****";
  const trimmed = key.trim();
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
};

const loadKeys = () => {
  try {
    const raw = localStorage.getItem(STORAGE.keys);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
};

const saveKeys = (keys) => {
  localStorage.setItem(STORAGE.keys, JSON.stringify(keys));
};

const parseKeys = (text) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return Array.from(new Set(lines));
};

const getKeysVisibility = () =>
  localStorage.getItem(STORAGE.keysVisibility) === "show";

const applyKeysVisibility = (visible) => {
  if (!toggleKeysBtn) return;
  keysInput.classList.toggle("masked", !visible);
  toggleKeysBtn.textContent = visible ? "隐藏" : "显示";
  toggleKeysBtn.setAttribute("aria-pressed", visible ? "true" : "false");
  localStorage.setItem(STORAGE.keysVisibility, visible ? "show" : "hide");
};

const renderKeys = () => {
  const keys = loadKeys();
  keysInput.value = keys.join("\n");

  if (keys.length === 0) {
    keysSummary.textContent = "暂无 Key。";
  } else {
    const rawIndex = Number.parseInt(
      localStorage.getItem(STORAGE.keyIndex) || "0",
      10
    );
    const nextIndex = Number.isNaN(rawIndex) ? 0 : rawIndex % keys.length;
    keysSummary.textContent = `已保存 ${keys.length} 个 Key，下一个：${maskKey(
      keys[nextIndex]
    )}`;
  }

  keyList.innerHTML = "";
  keys.forEach((key, index) => {
    const pill = document.createElement("div");
    pill.className = "key-pill";
    pill.textContent = `Key ${index + 1}: ${maskKey(key)}`;
    keyList.appendChild(pill);
  });
};

const renderModel = () => {
  const stored = localStorage.getItem(STORAGE.model) || "gemini-3-flash-preview";
  modelInput.value = stored;
  modelHint.textContent = `当前：${stored}`;
};

const renderUsage = () => {
  usageList.innerHTML = "";
  const dayKey = new Date().toISOString().slice(0, 10);

  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(STORAGE.usage) || "{}");
  } catch (error) {
    store = {};
  }

  const today = store[dayKey];
  if (!today) {
    usageSummary.textContent = "今天还没有记录。";
    return;
  }

  usageSummary.textContent = `请求数：${today.requests} · Tokens：${today.tokens}`;

  Object.entries(today.perKey || {}).forEach(([key, stats]) => {
    const row = document.createElement("div");
    row.className = "usage-row";
    row.textContent = `${key} · ${stats.requests} 次 · ${stats.tokens} tokens`;
    usageList.appendChild(row);
  });
};

saveKeysBtn.addEventListener("click", () => {
  const keys = parseKeys(keysInput.value);
  saveKeys(keys);
  renderKeys();
});

clearKeysBtn.addEventListener("click", () => {
  keysInput.value = "";
  saveKeys([]);
  localStorage.setItem(STORAGE.keyIndex, "0");
  renderKeys();
});

toggleKeysBtn.addEventListener("click", () => {
  applyKeysVisibility(keysInput.classList.contains("masked"));
});

saveModelBtn.addEventListener("click", () => {
  const model = modelInput.value.trim() || "gemini-3-flash-preview";
  localStorage.setItem(STORAGE.model, model);
  renderModel();
});

resetUsageBtn.addEventListener("click", () => {
  const dayKey = new Date().toISOString().slice(0, 10);
  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(STORAGE.usage) || "{}");
  } catch (error) {
    store = {};
  }
  delete store[dayKey];
  localStorage.setItem(STORAGE.usage, JSON.stringify(store));
  renderUsage();
});

themeSelect.addEventListener("change", () => {
  window.GeminiTheme.setThemePreference(themeSelect.value);
});

document.addEventListener("DOMContentLoaded", () => {
  renderKeys();
  renderModel();
  renderUsage();
  themeSelect.value = window.GeminiTheme.getThemePreference();
  applyKeysVisibility(getKeysVisibility());
});
})();
