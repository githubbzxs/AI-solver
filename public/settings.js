(function () {
  // 设置页脚本：仅保留用量、历史与主题
  const usageSummary = document.getElementById("usageSummary");
  const usageList = document.getElementById("usageList");
  const resetUsageBtn = document.getElementById("resetUsageBtn");
  const clearHistoryBtn = document.getElementById("clearHistoryBtn");
  const historySummary = document.getElementById("historySummary");
  const themeSelect = document.getElementById("themeSelect");

  const STORAGE = {
    usage: "gemini_usage",
    history: "gemini_history",
  };

  // 渲染今日用量统计
  const renderUsage = () => {
    if (!usageSummary || !usageList) return;
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

  // 渲染历史记录数量提示
  const renderHistorySummary = () => {
    if (!historySummary) return;
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem(STORAGE.history) || "[]");
    } catch (error) {
      items = [];
    }
    const count = Array.isArray(items) ? items.length : 0;
    historySummary.textContent = count
      ? `已保存 ${count} 条历史记录。`
      : "暂无历史记录。";
  };

  // 清空今日用量
  if (resetUsageBtn) {
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
  }

  // 清空历史记录
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener("click", () => {
      localStorage.setItem(STORAGE.history, "[]");
      renderHistorySummary();
    });
  }

  // 切换主题
  if (themeSelect) {
    themeSelect.addEventListener("change", () => {
      window.GeminiTheme.setThemePreference(themeSelect.value);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderUsage();
    renderHistorySummary();
    if (themeSelect) {
      themeSelect.value = window.GeminiTheme.getThemePreference();
    }
  });
})();
