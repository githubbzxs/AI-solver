(function () {
  // 设置页脚本：历史使用次数与历史记录
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
    usage: "gemini_usage",
    history: "gemini_history",
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
    renderUsageAll();
    renderHistorySummary();
  });
})();
