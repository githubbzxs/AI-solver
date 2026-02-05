(function () {
  // 设置页脚本：管理 API Key 与使用次数
  const keysInput = document.getElementById("keysInput");
  const toggleKeysBtn = document.getElementById("toggleKeysBtn");
  const saveKeysBtn = document.getElementById("saveKeysBtn");
  const clearKeysBtn = document.getElementById("clearKeysBtn");
  const keysSummary = document.getElementById("keysSummary");
  const keyList = document.getElementById("keyList");

  const usageTotalSummary = document.getElementById("usageTotalSummary");
  const openUsageBtn = document.getElementById("openUsageBtn");
  const usageModal = document.getElementById("usageModal");
  const usageTodaySummary = document.getElementById("usageTodaySummary");
  const usageTodayList = document.getElementById("usageTodayList");
  const usageHistorySummary = document.getElementById("usageHistorySummary");
  const usageHistoryList = document.getElementById("usageHistoryList");
  const usageChart = document.getElementById("usageChart");
  const chartZoomInBtn = document.getElementById("chartZoomIn");
  const chartZoomOutBtn = document.getElementById("chartZoomOut");
  const chartRangeLabel = document.getElementById("chartRangeLabel");
  const usageTabs = document.querySelectorAll("[data-usage-tab]");
  const usagePanels = document.querySelectorAll("[data-usage-panel]");

  const clearHistoryBtn = document.getElementById("clearHistoryBtn");
  const historySummary = document.getElementById("historySummary");

  const STORAGE = {
    keys: "gemini_api_keys",
    usage: "gemini_usage",
    keyIndex: "gemini_key_index",
    invalidKeys: "gemini_invalid_keys",
    chartZoom: "gemini_usage_zoom_hours",
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

  const syncInvalidKeys = (keys) => {
    const map = loadInvalidKeys();
    const normalized = new Set(keys.map((key) => key.trim()));
    const next = {};
    Object.entries(map).forEach(([key, value]) => {
      if (normalized.has(key)) {
        next[key] = value;
      }
    });
    if (Object.keys(next).length !== Object.keys(map).length) {
      saveInvalidKeys(next);
    }
    return next;
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

  const buildKeyQueue = (keys, invalidMap) => {
    const startIndex = getKeyIndex(keys.length);
    const rotated = keys.slice(startIndex).concat(keys.slice(0, startIndex));
    const validKeys = rotated.filter((key) => !invalidMap[key.trim()]);
    return validKeys.length ? validKeys : rotated;
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
    const invalidMap = syncInvalidKeys(keys);
    const invalidCount = Object.keys(invalidMap).length;
    keysInput.value = keys.join("\n");

    if (keys.length === 0) {
      keysSummary.textContent = "暂无 Key。";
    } else {
      const queue = buildKeyQueue(keys, invalidMap);
      const nextKey = queue[0] || keys[0];
      const invalidText = invalidCount ? `，失效 ${invalidCount} 个` : "";
      const nextText = nextKey ? `，下一个：${maskKey(nextKey)}` : "";
      keysSummary.textContent = `已保存 ${keys.length} 个 Key${invalidText}${nextText}`;
    }

    keyList.innerHTML = "";
    keys.forEach((key, index) => {
      const invalidInfo = invalidMap[key.trim()];
      const pill = document.createElement("div");
      pill.className = "key-pill";
      if (invalidInfo) {
        pill.classList.add("invalid");
        const reason = invalidInfo.reason ? `（${invalidInfo.reason}）` : "（失效）";
        pill.textContent = `Key ${index + 1}: ${maskKey(key)}${reason}`;
      } else {
        pill.textContent = `Key ${index + 1}: ${maskKey(key)}`;
      }
      keyList.appendChild(pill);
    });
  };

  const getDayKey = (date) => date.toISOString().slice(0, 10);

  const ZOOM_STEPS = [6, 12, 24, 48, 72, 168];

  const normalizeZoomHours = (value) => {
    if (ZOOM_STEPS.includes(value)) return value;
    if (!Number.isFinite(value)) return 24;
    let closest = ZOOM_STEPS[0];
    let minDiff = Math.abs(value - closest);
    ZOOM_STEPS.forEach((step) => {
      const diff = Math.abs(value - step);
      if (diff < minDiff) {
        minDiff = diff;
        closest = step;
      }
    });
    return closest;
  };

  const loadChartWindow = () => {
    const raw = Number.parseInt(localStorage.getItem(STORAGE.chartZoom) || "", 10);
    return normalizeZoomHours(raw);
  };

  let chartWindowHours = loadChartWindow();

  const updateChartControls = () => {
    if (chartRangeLabel) {
      chartRangeLabel.textContent = `近${chartWindowHours}小时`;
    }
    const minStep = ZOOM_STEPS[0];
    const maxStep = ZOOM_STEPS[ZOOM_STEPS.length - 1];
    if (chartZoomInBtn) chartZoomInBtn.disabled = chartWindowHours <= minStep;
    if (chartZoomOutBtn) chartZoomOutBtn.disabled = chartWindowHours >= maxStep;
  };

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
    const hasToday = Boolean(store[todayKey]);
    const listKeys = keys.length ? keys : hasToday ? [todayKey] : [];

    if (listKeys.length === 0) {
      usageHistorySummary.textContent = "暂无历史记录。";
      drawUsageChart(store);
      return;
    }

    if (keys.length === 0 && hasToday) {
      usageHistorySummary.textContent = "仅有今天记录。";
    } else {
      usageHistorySummary.textContent = `历史天数：${keys.length}`;
    }
    listKeys.forEach((key) => {
      const day = store[key] || { requests: 0 };
      const row = document.createElement("div");
      row.className = "usage-row";
      const suffix = key === todayKey ? "（今天）" : "";
      row.textContent = `${key} · ${day.requests} 次${suffix}`;
      usageHistoryList.appendChild(row);
    });

    drawUsageChart(store);
  };

  const getChartColors = () => {
    const styles = getComputedStyle(document.body);
    return {
      ink: styles.getPropertyValue("--ink").trim() || "#101113",
      line: styles.getPropertyValue("--line").trim() || "rgba(16,17,19,0.12)",
      accent: styles.getPropertyValue("--accent-2").trim() || "#d4d4d8",
    };
  };

  const resolveChartSize = () => {
    const rect = usageChart.getBoundingClientRect();
    const cssWidth = rect.width || usageChart.clientWidth || 640;
    const cssHeight = rect.height || usageChart.clientHeight || 160;
    return {
      width: cssWidth > 0 ? cssWidth : 640,
      height: cssHeight > 0 ? cssHeight : 160,
    };
  };

  const buildHourlySeries = (store, hours) => {
    const now = new Date();
    const totalHours = Math.max(1, hours);
    const points = [];
    for (let i = totalHours - 1; i >= 0; i -= 1) {
      const time = new Date(now.getTime() - i * 60 * 60 * 1000);
      const dayKey = getDayKey(time);
      const hourKey = String(time.getHours()).padStart(2, "0");
      const value = store?.[dayKey]?.perHour?.[hourKey] || 0;
      points.push({
        label: `${hourKey}:00`,
        value,
      });
    }
    return points;
  };

  const drawUsageChart = (store) => {
    if (!usageChart || !usageChart.getContext) return;
    const ctx = usageChart.getContext("2d");
    if (!ctx) return;

    const points = buildHourlySeries(store, chartWindowHours);

    const { width, height } = resolveChartSize();
    const dpr = window.devicePixelRatio || 1;
    usageChart.width = Math.max(1, Math.floor(width * dpr));
    usageChart.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (points.length === 0) return;
    usageChart.hidden = false;
    const colors = getChartColors();
    const padding = 16;
    const maxValue = Math.max(...points.map((p) => p.value), 1);
    const minValue = 0;
    const xStep = points.length > 1
      ? (width - padding * 2) / (points.length - 1)
      : 0;
    const yScale = (height - padding * 2) / (maxValue - minValue || 1);

    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = padding + index * xStep;
      const y = height - padding - (point.value - minValue) * yScale;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    ctx.fillStyle = colors.ink;
    points.forEach((point, index) => {
      const x = padding + index * xStep;
      const y = height - padding - (point.value - minValue) * yScale;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  const setChartWindow = (hours) => {
    chartWindowHours = normalizeZoomHours(hours);
    localStorage.setItem(STORAGE.chartZoom, String(chartWindowHours));
    updateChartControls();
    refreshUsageChart();
  };

  const getZoomIndex = () => ZOOM_STEPS.indexOf(chartWindowHours);

  const zoomIn = () => {
    const idx = getZoomIndex();
    if (idx > 0) {
      setChartWindow(ZOOM_STEPS[idx - 1]);
    }
  };

  const zoomOut = () => {
    const idx = getZoomIndex();
    if (idx >= 0 && idx < ZOOM_STEPS.length - 1) {
      setChartWindow(ZOOM_STEPS[idx + 1]);
    }
  };

  const renderUsageAll = () => {
    const store = loadUsageStore();
    renderUsageTotal(store);
    renderUsageToday(store);
    renderUsageHistory(store);
  };

  const refreshUsageChart = () => {
    if (!usageChart) return;
    updateChartControls();
    const store = loadUsageStore();
    drawUsageChart(store);
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
    if (name === "history") {
      window.requestAnimationFrame(() => {
        refreshUsageChart();
      });
    }
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
      saveInvalidKeys({});
      renderKeys();
    });
  }

  if (toggleKeysBtn) {
    toggleKeysBtn.addEventListener("click", () => {
      applyKeysVisibility(keysInput.classList.contains("masked"));
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

  if (chartZoomInBtn) {
    chartZoomInBtn.addEventListener("click", () => {
      zoomIn();
    });
  }

  if (chartZoomOutBtn) {
    chartZoomOutBtn.addEventListener("click", () => {
      zoomOut();
    });
  }

  if (usageChart) {
    usageChart.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        if (event.deltaY < 0) {
          zoomIn();
        } else {
          zoomOut();
        }
      },
      { passive: false }
    );
  }

  document.querySelectorAll('[data-close="usage"]').forEach((btn) => {
    btn.addEventListener("click", () => closeModal(usageModal));
  });

  window.addEventListener("keys-status-changed", () => {
    renderKeys();
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
    renderUsageAll();
    updateChartControls();
    renderHistorySummary();
    applyKeysVisibility(getKeysVisibility());
  });
})();
