(function () {
  // 设置页脚本：管理 API Key、模型与使用次数
  const keysInput = document.getElementById("keysInput");
  const toggleKeysBtn = document.getElementById("toggleKeysBtn");
  const saveKeysBtn = document.getElementById("saveKeysBtn");
  const clearKeysBtn = document.getElementById("clearKeysBtn");
  const keysSummary = document.getElementById("keysSummary");
  const keyList = document.getElementById("keyList");

  const modelInput = document.getElementById("modelInput");
  const saveModelBtn = document.getElementById("saveModelBtn");
  const modelHint = document.getElementById("modelHint");

  const usageTotalSummary = document.getElementById("usageTotalSummary");
  const openUsageBtn = document.getElementById("openUsageBtn");
  const usageModal = document.getElementById("usageModal");
  const usageTodaySummary = document.getElementById("usageTodaySummary");
  const usageTodayList = document.getElementById("usageTodayList");
  const usageHistorySummary = document.getElementById("usageHistorySummary");
  const usageHistoryList = document.getElementById("usageHistoryList");
  const usageTabs = document.querySelectorAll("[data-usage-tab]");
  const usagePanels = document.querySelectorAll("[data-usage-panel]");

  const clearHistoryBtn = document.getElementById("clearHistoryBtn");
  const historySummary = document.getElementById("historySummary");

  const STORAGE = {
    keys: "gemini_api_keys",
    model: "gemini_model",
    usage: "gemini_usage",
    keyIndex: "gemini_key_index",
    keysVisibility: "gemini_keys_visibility",
    history: "gemini_history",
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
    if (!toggleKeysBtn || !keysInput) return;
    keysInput.classList.toggle("masked", !visible);
    toggleKeysBtn.textContent = visible ? "隐藏" : "显示";
    toggleKeysBtn.setAttribute("aria-pressed", visible ? "true" : "false");
    localStorage.setItem(STORAGE.keysVisibility, visible ? "show" : "hide");
  };

  const renderKeys = () => {
    if (!keysInput || !keysSummary || !keyList) return;
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
    if (!modelInput || !modelHint) return;
    const stored = localStorage.getItem(STORAGE.model) || "gemini-3-flash-preview";
    modelInput.value = stored;
    modelHint.textContent = `当前：${stored}`;
  };

  const getDayKey = (date) => date.toISOString().slice(0, 10);

  const loadUsageStore = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE.usage) || "{}");
    } catch (error) {
      return {};
    }
  };

  const sumUsage = (store) => {
    return Object.values(store).reduce(
      (acc, day) => {
        acc.requests += day?.requests || 0;
        acc.tokens += day?.tokens || 0;
        return acc;
      },
      { requests: 0, tokens: 0 }
    );
  };

  const renderUsageTotal = (store) => {
    if (!usageTotalSummary) return;
    const total = sumUsage(store);
    if (total.requests === 0) {
      usageTotalSummary.textContent = "暂无使用记录。";
      return;
    }
    usageTotalSummary.textContent = `累计使用次数：${total.requests}`;
  };

  const renderUsageToday = (store) => {
    if (!usageTodaySummary || !usageTodayList) return;
    usageTodayList.innerHTML = "";
    const dayKey = getDayKey(new Date());
    const today = store[dayKey];
    if (!today) {
      usageTodaySummary.textContent = "今天还没有记录。";
      return;
    }
    usageTodaySummary.textContent = `今天使用次数：${today.requests}`;

    Object.entries(today.perKey || {}).forEach(([key, stats]) => {
      const row = document.createElement("div");
      row.className = "usage-row";
      row.textContent = `${key} · ${stats.requests} 次`;
      usageTodayList.appendChild(row);
    });
  };

  const renderUsageHistory = (store) => {
    if (!usageHistorySummary || !usageHistoryList) return;
    usageHistoryList.innerHTML = "";
    const todayKey = getDayKey(new Date());
    const keys = Object.keys(store)
      .filter((key) => key !== todayKey)
      .sort()
      .reverse();

    if (keys.length === 0) {
      usageHistorySummary.textContent = "暂无历史记录。";
      return;
    }

    usageHistorySummary.textContent = `历史天数：${keys.length}`;
    keys.forEach((key) => {
      const day = store[key] || { requests: 0 };
      const row = document.createElement("div");
      row.className = "usage-row";
      row.textContent = `${key} · ${day.requests} 次`;
      usageHistoryList.appendChild(row);
    });
  };

  const renderUsageAll = () => {
    const store = loadUsageStore();
    renderUsageTotal(store);
    renderUsageToday(store);
    renderUsageHistory(store);
  };

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

  const setActiveUsageTab = (name) => {
    usageTabs.forEach((tab) => {
      const active = tab.dataset.usageTab === name;
      tab.classList.toggle("is-active", active);
    });
    usagePanels.forEach((panel) => {
      panel.hidden = panel.dataset.usagePanel !== name;
    });
  };

  if (saveKeysBtn) {
    saveKeysBtn.addEventListener("click", () => {
      const keys = parseKeys(keysInput.value);
      saveKeys(keys);
      renderKeys();
    });
  }

  if (clearKeysBtn) {
    clearKeysBtn.addEventListener("click", () => {
      if (keysInput) {
        keysInput.value = "";
      }
      saveKeys([]);
      localStorage.setItem(STORAGE.keyIndex, "0");
      renderKeys();
    });
  }

  if (toggleKeysBtn) {
    toggleKeysBtn.addEventListener("click", () => {
      applyKeysVisibility(keysInput.classList.contains("masked"));
    });
  }

  if (saveModelBtn) {
    saveModelBtn.addEventListener("click", () => {
      const model = modelInput.value.trim() || "gemini-3-flash-preview";
      localStorage.setItem(STORAGE.model, model);
      renderModel();
    });
  }

  if (openUsageBtn) {
    openUsageBtn.addEventListener("click", () => {
      openModal(usageModal);
      setActiveUsageTab("today");
      renderUsageAll();
    });
  }

  usageTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setActiveUsageTab(tab.dataset.usageTab);
    });
  });

  document.querySelectorAll('[data-close="usage"]').forEach((btn) => {
    btn.addEventListener("click", () => closeModal(usageModal));
  });

  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener("click", () => {
      localStorage.setItem(STORAGE.history, "[]");
      renderHistorySummary();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (window.GeminiTheme?.setThemePreference) {
      window.GeminiTheme.setThemePreference("system");
    }
    renderKeys();
    renderModel();
    renderUsageAll();
    renderHistorySummary();
    applyKeysVisibility(getKeysVisibility());
  });
})();
