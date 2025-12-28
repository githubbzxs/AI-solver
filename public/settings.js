(function () {
// 设置页脚本：管理 API Key、模型、主题与用量统计
// 使用 IIFE 避免变量泄漏到全局作用域
// ===== 页面元素引用（避免重复查询 DOM） =====
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
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const historySummary = document.getElementById("historySummary");

const themeSelect = document.getElementById("themeSelect");

// localStorage 的字段名集中管理，便于维护
const STORAGE = {
  keys: "gemini_api_keys",
  model: "gemini_model",
  usage: "gemini_usage",
  keyIndex: "gemini_key_index",
  keysVisibility: "gemini_keys_visibility",
  history: "gemini_history",
};

// 把 Key 做简单脱敏，避免直接暴露完整内容
const maskKey = (key) => {
  if (!key) return "****";
  const trimmed = key.trim();
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
};

// 从 localStorage 读取保存的 Key 列表（JSON 字符串）
const loadKeys = () => {
  try {
    const raw = localStorage.getItem(STORAGE.keys);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
};

// 保存 Key 列表到 localStorage
const saveKeys = (keys) => {
  localStorage.setItem(STORAGE.keys, JSON.stringify(keys));
};

// 把文本框内容按行拆分、去重、去空白
const parseKeys = (text) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return Array.from(new Set(lines));
};

// 读取“显示/隐藏 Key”偏好
const getKeysVisibility = () =>
  localStorage.getItem(STORAGE.keysVisibility) === "show";

// 切换 Key 显示状态，并持久化选择
const applyKeysVisibility = (visible) => {
  if (!toggleKeysBtn) return;
  keysInput.classList.toggle("masked", !visible);
  toggleKeysBtn.textContent = visible ? "隐藏" : "显示";
  toggleKeysBtn.setAttribute("aria-pressed", visible ? "true" : "false");
  localStorage.setItem(STORAGE.keysVisibility, visible ? "show" : "hide");
};

// 把 Key 列表渲染到页面，并提示“下一个轮询 Key”
const renderKeys = () => {
  const keys = loadKeys();
  keysInput.value = keys.join("\n");

  if (keys.length === 0) {
    keysSummary.textContent = "暂无 Key。";
  } else {
    // 读取当前轮询索引，提示“下一个将使用的 Key”
    const rawIndex = Number.parseInt(
      localStorage.getItem(STORAGE.keyIndex) || "0",
      10
    );
    const nextIndex = Number.isNaN(rawIndex) ? 0 : rawIndex % keys.length;
    keysSummary.textContent = `已保存 ${keys.length} 个 Key，下一个：${maskKey(
      keys[nextIndex]
    )}`;
  }

  // 以“胶囊”形式展示每个 Key 的脱敏信息
  keyList.innerHTML = "";
  keys.forEach((key, index) => {
    const pill = document.createElement("div");
    pill.className = "key-pill";
    pill.textContent = `Key ${index + 1}: ${maskKey(key)}`;
    keyList.appendChild(pill);
  });
};

// 渲染当前模型配置
const renderModel = () => {
  const stored = localStorage.getItem(STORAGE.model) || "gemini-3-flash-preview";
  modelInput.value = stored;
  modelHint.textContent = `当前：${stored}`;
};

// 渲染“今日用量”统计（按天、按 Key 汇总）
const renderUsage = () => {
  usageList.innerHTML = "";
  // 以当天日期作为统计维度
  const dayKey = new Date().toISOString().slice(0, 10);

  // 读取用量数据，解析失败则回退为空
  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(STORAGE.usage) || "{}");
  } catch (error) {
    store = {};
  }

  // 当天没有记录则直接提示
  const today = store[dayKey];
  if (!today) {
    usageSummary.textContent = "今天还没有记录。";
    return;
  }

  // 汇总显示：请求数与 token 数
  usageSummary.textContent = `请求数：${today.requests} · Tokens：${today.tokens}`;

  // 分 Key 统计：展示每个 Key 的使用量
  Object.entries(today.perKey || {}).forEach(([key, stats]) => {
    const row = document.createElement("div");
    row.className = "usage-row";
    row.textContent = `${key} · ${stats.requests} 次 · ${stats.tokens} tokens`;
    usageList.appendChild(row);
  });
};

// 渲染历史记录条数提示（来自主页面保存的历史）
const renderHistorySummary = () => {
  if (!historySummary) return;
  // 读取历史记录数量（由主页面写入）
  let items = [];
  try {
    items = JSON.parse(localStorage.getItem(STORAGE.history) || "[]");
  } catch (error) {
    items = [];
  }
  const count = Array.isArray(items) ? items.length : 0;
  historySummary.textContent = count ? `已保存 ${count} 条历史记录。` : "暂无历史记录。";
};

// ===== 事件绑定：保存/清空/切换 Key =====
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

// 保存模型配置
saveModelBtn.addEventListener("click", () => {
  const model = modelInput.value.trim() || "gemini-3-flash-preview";
  localStorage.setItem(STORAGE.model, model);
  renderModel();
});

// 清空今日用量
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

// 清空主页面保存的历史记录
if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener("click", () => {
    localStorage.setItem(STORAGE.history, "[]");
    renderHistorySummary();
  });
}

// 切换主题（会同步影响所有页面）
themeSelect.addEventListener("change", () => {
  window.GeminiTheme.setThemePreference(themeSelect.value);
});

// 页面加载完后初始化界面
document.addEventListener("DOMContentLoaded", () => {
  renderKeys();
  renderModel();
  renderUsage();
  renderHistorySummary();
  themeSelect.value = window.GeminiTheme.getThemePreference();
  applyKeysVisibility(getKeysVisibility());
});
})();
