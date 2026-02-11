(function () {
  "use strict";

  // 设置页逻辑：认证、声纹、Key、统计、管理员
  const q = (id) => document.getElementById(id);
  const e = {
    authEmail: q("authEmail"),
    authPassword: q("authPassword"),
    authStatus: q("authStatus"),
    authMessage: q("authMessage"),
    loginBtn: q("loginBtn"),
    registerBtn: q("registerBtn"),
    logoutBtn: q("logoutBtn"),
    voiceBadge: q("voiceprintBadge"),
    voiceStatus: q("voiceprintStatus"),
    voiceRecordBtn: q("recordVoiceprintBtn"),
    voiceLoginBtn: q("voiceLoginBtn"),
    voiceSaveBtn: q("saveVoiceprintBtn"),
    voiceClearBtn: q("clearVoiceprintBtn"),
    keysInput: q("keysInput"),
    toggleKeysBtn: q("toggleKeysBtn"),
    saveKeysBtn: q("saveKeysBtn"),
    clearKeysBtn: q("clearKeysBtn"),
    keysSummary: q("keysSummary"),
    keyList: q("keyList"),
    usageTotalSummary: q("usageTotalSummary"),
    usageTodaySummary: q("usageTodaySummary"),
    usageTodayList: q("usageTodayList"),
    usageHistorySummary: q("usageHistorySummary"),
    usageHistoryList: q("usageHistoryList"),
    openUsageBtn: q("openUsageBtn"),
    usageModal: q("usageModal"),
    usageTabs: Array.from(document.querySelectorAll("[data-usage-tab]")),
    usagePanels: Array.from(document.querySelectorAll("[data-usage-panel]")),
    historySummary: q("historySummary"),
    clearHistoryBtn: q("clearHistoryBtn"),
    adminConsole: q("adminConsole"),
    adminConsoleStatus: q("adminConsoleStatus"),
    unifiedApiStatus: q("unifiedApiStatus"),
    unifiedApiKeyInput: q("unifiedApiKeyInput"),
    saveUnifiedApiBtn: q("saveUnifiedApiBtn"),
    clearUnifiedApiBtn: q("clearUnifiedApiBtn"),
    refreshAdminUsersBtn: q("refreshAdminUsersBtn"),
    adminUsersStatus: q("adminUsersStatus"),
    adminUsersList: q("adminUsersList"),
  };

  const S = {
    keys: "gemini_api_keys",
    usage: "gemini_usage",
    keyIndex: "gemini_key_index",
    invalidKeys: "gemini_invalid_keys",
    keysVisibility: "gemini_keys_visibility",
  };

  const state = {
    user: null,
    voice: {
      local: null,
      recording: false,
      enrolled: false,
      apiOk: true,
      supported:
        typeof navigator !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia) &&
        Boolean(window.AudioContext || window.webkitAudioContext),
    },
  };
  const PAGE_MODE = String(document.body?.dataset?.page || "").trim().toLowerCase();
  const IS_LOGIN_PAGE = PAGE_MODE === "login";
  const redirectToHome = () => {
    if (typeof window === "undefined") return;
    window.location.replace("/");
  };

  const sleep = (ms) => new Promise((r) => window.setTimeout(r, ms));
  const isAdmin = () => state.user?.role === "admin";
  const resolveAccount = (user) => {
    const account = String(user?.account || "").trim();
    if (account) return account;
    return String(user?.email || "").trim();
  };
  const isApiUnavailable = (status) => status === 404 || status === 405 || status === 501;
  const load = (k, d) => {
    try {
      const raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : d;
    } catch (_e) {
      return d;
    }
  };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const tone = (node, text, k = "") => {
    if (!node) return;
    node.textContent = text || "";
    if (k) node.dataset.tone = k;
    else node.removeAttribute("data-tone");
  };
  const setAuthMessage = (text, toneKey = "") => tone(e.authMessage, text, toneKey);
  const mask = (key) => {
    const v = String(key || "").trim();
    if (!v) return "****";
    if (v.length <= 8) return v;
    return `${v.slice(0, 4)}...${v.slice(-4)}`;
  };
  const escapeHtml = (t) =>
    String(t || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));
  const fmt = (v) => {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString("zh-CN", { hour12: false });
  };

  const fetchJson = async (url, options = {}) => {
    let r;
    try {
      r = await fetch(url, { credentials: "same-origin", ...options });
    } catch (_e) {
      return { ok: false, status: 0, message: "网络请求失败。", data: null };
    }
    let data = null;
    try {
      data = await r.json();
    } catch (_e) {
      data = null;
    }
    if (!r.ok) return { ok: false, status: r.status, message: data?.error || "请求失败。", data };
    return { ok: true, status: r.status, data };
  };

  const getSavedKeys = () => {
    const keys = load(S.keys, []);
    return Array.isArray(keys) ? keys : [];
  };
  const getInvalidMap = () => {
    const map = load(S.invalidKeys, {});
    return map && typeof map === "object" ? map : {};
  };
  const getKeysVisibility = () => load(S.keysVisibility, true) !== false;
  const setKeysVisibility = (masked) => {
    if (e.keysInput) e.keysInput.classList.toggle("masked", Boolean(masked));
    if (e.toggleKeysBtn) e.toggleKeysBtn.textContent = masked ? "显示" : "隐藏";
    save(S.keysVisibility, Boolean(masked));
  };

  const renderKeys = () => {
    if (!e.keysInput || !e.keysSummary || !e.keyList) return;
    const keys = getSavedKeys();
    const invalid = getInvalidMap();
    e.keysInput.value = keys.join("\n");
    e.keyList.innerHTML = "";
    if (!keys.length) {
      e.keysSummary.textContent = "暂无 Key。";
      return;
    }
    const bad = Object.keys(invalid).length;
    e.keysSummary.textContent = `已保存 ${keys.length} 个 Key${bad ? `，失效 ${bad} 个` : ""}`;
    keys.forEach((key, i) => {
      const row = document.createElement("div");
      row.className = "key-pill";
      const info = invalid[(key || "").trim()];
      if (info) row.classList.add("invalid");
      row.textContent = `Key ${i + 1}: ${mask(key)}${info?.reason ? `（${info.reason}）` : ""}`;
      e.keyList.appendChild(row);
    });
  };

  const renderUsage = () => {
    const store = load(S.usage, {});
    const today = new Date().toISOString().slice(0, 10);
    const total = Object.values(store).reduce((sum, day) => sum + Number(day?.requests || 0), 0);
    if (e.usageTotalSummary) e.usageTotalSummary.textContent = total ? `累计使用次数：${total}` : "暂无使用记录。";
    if (e.usageTodaySummary && e.usageTodayList) {
      e.usageTodayList.innerHTML = "";
      const item = store[today];
      if (!item) {
        e.usageTodaySummary.textContent = "今天还没有记录。";
      } else {
        e.usageTodaySummary.textContent = `今天使用次数：${item.requests || 0}`;
        const entries = Object.entries(item.perKey || {});
        if (!entries.length) {
          const row = document.createElement("div");
          row.className = "usage-row";
          row.textContent = "暂无 Key 维度数据。";
          e.usageTodayList.appendChild(row);
        } else {
          entries.forEach(([k, v]) => {
            const row = document.createElement("div");
            row.className = "usage-row";
            row.textContent = `${k} · ${v?.requests || 0} 次`;
            e.usageTodayList.appendChild(row);
          });
        }
      }
    }
    if (e.usageHistorySummary && e.usageHistoryList) {
      e.usageHistoryList.innerHTML = "";
      const days = Object.keys(store).sort().reverse();
      e.usageHistorySummary.textContent = days.length ? `历史天数：${days.length}` : "暂无历史记录。";
      days.forEach((day) => {
        const row = document.createElement("div");
        row.className = "usage-row";
        row.textContent = `${day} · ${store[day]?.requests || 0} 次`;
        e.usageHistoryList.appendChild(row);
      });
    }
  };

  const setUsageTab = (name) => {
    e.usageTabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.usageTab === name));
    e.usagePanels.forEach((panel) => {
      panel.hidden = panel.dataset.usagePanel !== name;
    });
  };
  const openUsage = () => {
    if (!e.usageModal) return;
    e.usageModal.classList.add("is-open");
    e.usageModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    setUsageTab("today");
    renderUsage();
  };
  const closeUsage = () => {
    if (!e.usageModal) return;
    e.usageModal.classList.remove("is-open");
    e.usageModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  };

  const renderAuth = () => {
    if (!e.authStatus) return;
    if (!state.user) {
      e.authStatus.textContent = "未登录";
      if (e.loginBtn) e.loginBtn.hidden = false;
      if (e.registerBtn) e.registerBtn.hidden = false;
      if (e.logoutBtn) e.logoutBtn.hidden = true;
      if (e.authEmail) e.authEmail.disabled = false;
      if (e.authPassword) e.authPassword.disabled = false;
      return;
    }
    const accountLabel = resolveAccount(state.user);
    e.authStatus.textContent = `已登录：${accountLabel}（${state.user.role || "user"}）`;
    if (e.loginBtn) e.loginBtn.hidden = true;
    if (e.registerBtn) e.registerBtn.hidden = true;
    if (e.logoutBtn) e.logoutBtn.hidden = false;
    if (e.authEmail) {
      e.authEmail.value = accountLabel;
      e.authEmail.disabled = true;
    }
    if (e.authPassword) {
      e.authPassword.value = "";
      e.authPassword.disabled = true;
    }
  };

  const MIN_VOICE_NORM = 1e-6;
  const calcVoiceNorm = (vector) =>
    Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  const normalizeDb = (value) => {
    const safeValue = Number.isFinite(value) ? value : -120;
    return (Math.max(-120, Math.min(0, safeValue)) + 120) / 120;
  };
  const buildVoiceVector = (frames) => {
    if (!frames.length) return [];
    const bands = 16;
    const mean = new Array(bands).fill(0);
    const dev = new Array(bands).fill(0);
    frames.forEach((frame) => {
      const step = Math.max(1, Math.floor(frame.length / bands));
      for (let b = 0; b < bands; b += 1) {
        const st = b * step;
        const ed = b === bands - 1 ? frame.length : Math.min(frame.length, (b + 1) * step);
        let acc = 0;
        for (let i = st; i < ed; i += 1) acc += normalizeDb(frame[i]);
        mean[b] += acc / Math.max(1, ed - st);
      }
    });
    for (let i = 0; i < bands; i += 1) mean[i] /= frames.length;
    frames.forEach((frame) => {
      const step = Math.max(1, Math.floor(frame.length / bands));
      for (let b = 0; b < bands; b += 1) {
        const st = b * step;
        const ed = b === bands - 1 ? frame.length : Math.min(frame.length, (b + 1) * step);
        let acc = 0;
        for (let i = st; i < ed; i += 1) acc += normalizeDb(frame[i]);
        const avg = acc / Math.max(1, ed - st);
        dev[b] += (avg - mean[b]) * (avg - mean[b]);
      }
    });
    for (let i = 0; i < bands; i += 1) dev[i] = Math.sqrt(dev[i] / Math.max(1, frames.length - 1));
    const vec = [...mean, ...dev];
    const norm = calcVoiceNorm(vec);
    if (!Number.isFinite(norm) || norm < MIN_VOICE_NORM) return [];
    return vec.map((x) => Number((x / norm).toFixed(6)));
  };
  const hasValidVoiceVector = (vector) => {
    if (!Array.isArray(vector) || vector.length === 0) return false;
    if (vector.some((value) => !Number.isFinite(value))) return false;
    return calcVoiceNorm(vector) >= MIN_VOICE_NORM;
  };
  const getVoicePayload = () => {
    const vector = state.voice.local?.vector;
    if (!hasValidVoiceVector(vector)) return null;
    return {
      algorithm: "webaudio-v1",
      vector,
      sampleRate: state.voice.local.sampleRate,
      frameCount: state.voice.local.frameCount,
      capturedAt: state.voice.local.capturedAt,
    };
  };
  const getVoiceLoginErrorText = (response) => {
    const code = response?.data?.code;
    if (code === "VOICEPRINT_REQUIRED") return "请先录制有效声纹后再尝试。";
    if (code === "VOICEPRINT_MISMATCH") return "声纹验证失败，请重试或改用账号密码登录。";
    if (code === "VOICEPRINT_AMBIGUOUS") return "声纹匹配到多个账户，请改用账号密码登录。";
    if (code === "VOICEPRINT_UNAVAILABLE") return "当前没有可用声纹账户，请先用账号密码登录。";
    if (code === "VOICEPRINT_UNKNOWN") return "未找到匹配账户，请改用账号密码登录。";
    return response?.message || "声纹登录失败，请稍后重试。";
  };

  const renderVoice = () => {
    const loggedIn = Boolean(state.user);
    const hasLocalVoice = hasValidVoiceVector(state.voice.local?.vector);
    if (e.voiceRecordBtn) {
      e.voiceRecordBtn.disabled = state.voice.recording || !state.voice.supported;
      e.voiceRecordBtn.textContent = state.voice.recording
        ? "录制中..."
        : hasLocalVoice
          ? "重新录制声纹"
          : "录制声纹";
    }
    if (e.voiceSaveBtn) {
      e.voiceSaveBtn.hidden = !loggedIn || !state.voice.apiOk;
      e.voiceSaveBtn.disabled = state.voice.recording || !hasLocalVoice;
    }
    if (e.voiceLoginBtn) {
      const showVoiceLogin = IS_LOGIN_PAGE && !loggedIn;
      e.voiceLoginBtn.hidden = !showVoiceLogin;
      e.voiceLoginBtn.disabled =
        state.voice.recording || !state.voice.supported || !hasLocalVoice;
    }
    if (e.voiceClearBtn) {
      e.voiceClearBtn.hidden = !loggedIn || !state.voice.apiOk;
      e.voiceClearBtn.disabled = state.voice.recording;
    }
    if (e.voiceBadge) {
      e.voiceBadge.textContent = state.voice.recording
        ? "录制中"
        : hasLocalVoice
          ? "已录制"
          : state.voice.enrolled
            ? "已保存"
            : "未录制";
    }
  };

  const attemptVoiceLogin = async () => {
    if (!IS_LOGIN_PAGE) return;
    if (!state.voice.supported) {
      setAuthMessage("当前浏览器不支持声纹登录，请改用账号密码登录。", "error");
      return;
    }
    const voice = getVoicePayload();
    if (!voice) {
      setAuthMessage("请先录制有效声纹。", "error");
      return;
    }
    setAuthMessage("正在进行声纹登录...");
    const r = await fetchJson("/api/auth/login/voiceprint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voiceprint: voice }),
    });
    if (!r.ok) {
      setAuthMessage(getVoiceLoginErrorText(r), "error");
      return;
    }
    if (e.authPassword) e.authPassword.value = "";
    setAuthMessage("声纹登录成功。", "success");
    setUser(r.data?.user || null);
    refreshVoiceStatus();
  };

  const renderAdmin = () => {
    if (!e.adminConsole) return;
    if (!isAdmin()) {
      e.adminConsole.hidden = true;
      tone(e.adminConsoleStatus, "仅管理员可见。");
      return;
    }
    e.adminConsole.hidden = false;
    tone(e.adminConsoleStatus, "你当前是管理员，可管理全局 API 与用户。", "success");
  };

  const renderHistorySummary = async () => {
    if (!e.historySummary) return;
    if (!state.user) {
      e.historySummary.textContent = "请先登录后查看历史记录。";
      return;
    }
    const r = await fetchJson("/api/history/summary");
    if (!r.ok) {
      if (r.status === 401) setUser(null);
      e.historySummary.textContent = r.message || "读取历史统计失败。";
      return;
    }
    const count = Number(r.data?.count || 0);
    e.historySummary.textContent = count ? `当前账号共有 ${count} 条历史记录。` : "暂无历史记录。";
  };

  const setUser = (u) => {
    state.user = u || null;
    renderAuth();
    renderVoice();
    renderAdmin();
    renderHistorySummary();
    if (isAdmin()) {
      refreshUnified();
      refreshAdminUsers();
    }
    if (IS_LOGIN_PAGE && state.user) {
      redirectToHome();
      return;
    }
    window.dispatchEvent(new CustomEvent("auth-changed", { detail: state.user }));
  };

  const refreshAuth = async () => {
    const r = await fetchJson("/api/auth/me");
    if (!r.ok) {
      setUser(null);
      return null;
    }
    const user = r.data?.user || null;
    setUser(user);
    return user;
  };

  const refreshVoiceStatus = async () => {
    if (!e.voiceStatus) return;
    if (!state.voice.supported) {
      state.voice.apiOk = false;
      state.voice.enrolled = false;
      tone(e.voiceStatus, "当前浏览器不支持声纹录制。", "warn");
      renderVoice();
      return;
    }
    if (!state.user) {
      state.voice.apiOk = true;
      state.voice.enrolled = false;
      tone(
        e.voiceStatus,
        hasValidVoiceVector(state.voice.local?.vector)
          ? "已录制本地声纹，登录/注册会自动附带。"
          : "可选录制声纹，登录/注册会自动附带。"
      );
      renderVoice();
      return;
    }
    const r = await fetchJson("/api/auth/voiceprint/status");
    if (!r.ok) {
      if (isApiUnavailable(r.status)) {
        state.voice.apiOk = false;
        state.voice.enrolled = false;
        tone(e.voiceStatus, "后端未开启账号声纹管理接口，仅支持登录/注册时附带声纹。", "warn");
      } else {
        state.voice.apiOk = true;
        tone(e.voiceStatus, r.message || "读取声纹状态失败。", "warn");
      }
      renderVoice();
      return;
    }
    state.voice.apiOk = true;
    state.voice.enrolled = Boolean(r.data?.enrolled || r.data?.enabled || r.data?.hasVoiceprint);
    tone(e.voiceStatus, state.voice.enrolled ? "当前账号已启用声纹。" : "当前账号尚未启用声纹。", state.voice.enrolled ? "success" : "");
    renderVoice();
  };

  const recordVoice = async () => {
    if (state.voice.recording || !state.voice.supported) return;
    state.voice.recording = true;
    renderVoice();
    tone(e.voiceStatus, "正在录制声纹，请持续说话约 3 秒...");
    let stream = null;
    let ctx = null;
    let src = null;
    let an = null;
    let mute = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      if (ctx.state === "suspended") await ctx.resume();
      src = ctx.createMediaStreamSource(stream);
      an = ctx.createAnalyser();
      an.fftSize = 2048;
      an.smoothingTimeConstant = 0.82;
      src.connect(an);
      // 将分析节点接到静音输出，确保部分浏览器也会持续更新频谱数据。
      mute = ctx.createGain();
      mute.gain.value = 0;
      an.connect(mute);
      mute.connect(ctx.destination);
      const data = new Float32Array(an.frequencyBinCount);
      const frames = [];
      const begin = performance.now();
      while (performance.now() - begin < 2600) {
        an.getFloatFrequencyData(data);
        frames.push(data.slice(6, 220));
        await sleep(60);
      }
      const vector = buildVoiceVector(frames);
      if (!vector.length) {
        throw new Error("未检测到有效语音，请靠近麦克风并持续说话后重试。");
      }
      state.voice.local = { vector, sampleRate: ctx.sampleRate, frameCount: frames.length, capturedAt: new Date().toISOString() };
      tone(e.voiceStatus, "声纹录制完成。", "success");
    } catch (err) {
      tone(e.voiceStatus, err?.message || "录制失败，请检查麦克风权限。", "error");
    } finally {
      if (src) src.disconnect();
      if (an) an.disconnect();
      if (mute) mute.disconnect();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (ctx) await ctx.close().catch(() => {});
      state.voice.recording = false;
      renderVoice();
    }
  };

  const renderAdminUsers = (items) => {
    if (!e.adminUsersList) return;
    e.adminUsersList.innerHTML = "";
    if (!items.length) {
      e.adminUsersList.innerHTML = '<div class="history-empty">暂无用户数据</div>';
      return;
    }
    items.forEach((u) => {
      const card = document.createElement("div");
      card.className = "admin-user-card";
      card.dataset.userId = String(u.id);
      card.innerHTML = `
        <div class="admin-user-header"><strong>ID ${u.id} · ${escapeHtml(resolveAccount(u))}</strong><span class="pill subtle">${u.role === "admin" ? "管理员" : "普通用户"}</span></div>
        <div class="hint">历史 ${Number(u.historyCount || 0)} 条 · 声纹 ${u.voiceprintEnabled ? "已启用" : "未启用"} · 创建时间 ${escapeHtml(fmt(u.createdAt))}</div>
        <label class="field"><span>账户</span><input class="admin-user-email" value="${escapeHtml(resolveAccount(u))}" /></label>
        <label class="field"><span>角色</span><select class="admin-user-role"><option value="user"${u.role === "user" ? " selected" : ""}>普通用户</option><option value="admin"${u.role === "admin" ? " selected" : ""}>管理员</option></select></label>
        <label class="field"><span>重置密码（可选）</span><input class="admin-user-password" type="password" placeholder="不填则不改" /></label>
        <div class="panel-actions admin-user-actions"><button type="button" class="admin-user-save">保存修改</button><button type="button" class="ghost admin-user-clear-history">清空历史</button><button type="button" class="ghost admin-user-clear-voice">清除声纹</button><button type="button" class="ghost admin-user-view-history">查看历史</button></div>
        <div class="hint admin-user-status">可编辑该用户信息。</div><pre class="admin-user-history" hidden></pre>`;
      e.adminUsersList.appendChild(card);
    });
  };

  const refreshUnified = async () => {
    if (!isAdmin()) return;
    tone(e.unifiedApiStatus, "正在读取统一 API 状态...");
    const r = await fetchJson("/api/admin/unified-api");
    if (!r.ok) {
      tone(e.unifiedApiStatus, r.message || "读取失败。", "error");
      return;
    }
    if (r.data?.hasKey) tone(e.unifiedApiStatus, `已配置：${r.data?.masked || "已配置"}`, "success");
    else tone(e.unifiedApiStatus, "当前未配置统一 API Key。");
  };

  const refreshAdminUsers = async () => {
    if (!isAdmin()) return;
    tone(e.adminUsersStatus, "正在读取用户列表...");
    const r = await fetchJson("/api/admin/users");
    if (!r.ok) {
      tone(e.adminUsersStatus, r.message || "读取失败。", "error");
      return;
    }
    const items = Array.isArray(r.data?.items) ? r.data.items : [];
    renderAdminUsers(items);
    tone(e.adminUsersStatus, `共 ${items.length} 个账号。`, "success");
  };

  if (e.loginBtn) e.loginBtn.addEventListener("click", async () => {
    const account = (e.authEmail?.value || "").trim();
    const password = (e.authPassword?.value || "").trim();
    if (!account || !password) return setAuthMessage("请输入账户和密码。", "error");
    const body = { account, email: account, password };
    const voice = getVoicePayload();
    if (voice) body.voiceprint = voice;
    setAuthMessage("正在登录...");
    const r = await fetchJson("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return setAuthMessage(r.message || "登录失败。", "error");
    if (e.authPassword) e.authPassword.value = "";
    setAuthMessage("登录成功。", "success");
    setUser(r.data?.user || null);
    refreshVoiceStatus();
  });

  if (e.registerBtn) e.registerBtn.addEventListener("click", async () => {
    const account = (e.authEmail?.value || "").trim();
    const password = (e.authPassword?.value || "").trim();
    if (!account || !password) return setAuthMessage("请输入账户和密码。", "error");
    const body = { account, email: account, password };
    const voice = getVoicePayload();
    if (voice) body.voiceprint = voice;
    setAuthMessage("正在注册...");
    const r = await fetchJson("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return setAuthMessage(r.message || "注册失败。", "error");
    if (e.authPassword) e.authPassword.value = "";
    setAuthMessage("注册成功，已自动登录。", "success");
    setUser(r.data?.user || null);
    refreshVoiceStatus();
  });

  if (e.authPassword) e.authPassword.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && e.loginBtn && !e.loginBtn.hidden) e.loginBtn.click();
  });

  if (e.logoutBtn) e.logoutBtn.addEventListener("click", async () => {
    const r = await fetchJson("/api/auth/logout", { method: "POST" });
    if (!r.ok) return setAuthMessage(r.message || "退出失败。", "error");
    setAuthMessage("已退出登录。");
    setUser(null);
    window.dispatchEvent(new Event("history-updated"));
  });

  if (e.voiceRecordBtn) e.voiceRecordBtn.addEventListener("click", recordVoice);
  if (e.voiceLoginBtn) e.voiceLoginBtn.addEventListener("click", attemptVoiceLogin);
  if (e.voiceSaveBtn) e.voiceSaveBtn.addEventListener("click", async () => {
    if (!state.user) return;
    if (!state.voice.apiOk) return tone(e.voiceStatus, "当前后端未开启声纹保存接口。", "warn");
    const voice = getVoicePayload();
    if (!voice) return tone(e.voiceStatus, "请先录制有效声纹。", "error");
    const r = await fetchJson("/api/auth/voiceprint/enroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voiceprint: voice }) });
    if (!r.ok) return tone(e.voiceStatus, r.message || "保存失败。", "error");
    state.voice.enrolled = true;
    tone(e.voiceStatus, "声纹已保存。", "success");
    renderVoice();
  });
  if (e.voiceClearBtn) e.voiceClearBtn.addEventListener("click", async () => {
    state.voice.local = null;
    if (!state.user || !state.voice.apiOk) {
      state.voice.enrolled = false;
      tone(e.voiceStatus, "本地声纹已清除。", "success");
      renderVoice();
      return;
    }
    const r = await fetchJson("/api/auth/voiceprint", { method: "DELETE" });
    if (!r.ok) return tone(e.voiceStatus, r.message || "清除失败。", "error");
    state.voice.enrolled = false;
    tone(e.voiceStatus, "声纹已清除。", "success");
    renderVoice();
  });

  if (e.saveKeysBtn) e.saveKeysBtn.addEventListener("click", () => {
    const keys = String(e.keysInput?.value || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    save(S.keys, keys);
    const invalid = getInvalidMap();
    const nextInvalid = {};
    keys.forEach((k) => {
      if (invalid[k]) nextInvalid[k] = invalid[k];
    });
    save(S.invalidKeys, nextInvalid);
    const idx = Number.parseInt(localStorage.getItem(S.keyIndex) || "0", 10);
    if (!keys.length || idx >= keys.length || idx < 0 || !Number.isInteger(idx)) localStorage.setItem(S.keyIndex, "0");
    renderKeys();
    setAuthMessage("Key 已保存。");
  });

  if (e.clearKeysBtn) e.clearKeysBtn.addEventListener("click", () => {
    save(S.keys, []);
    save(S.invalidKeys, {});
    localStorage.setItem(S.keyIndex, "0");
    if (e.keysInput) e.keysInput.value = "";
    renderKeys();
    setAuthMessage("Key 已清空。");
    window.dispatchEvent(new Event("keys-status-changed"));
  });

  if (e.toggleKeysBtn) e.toggleKeysBtn.addEventListener("click", () => {
    setKeysVisibility(!(e.keysInput?.classList.contains("masked")));
  });

  if (e.openUsageBtn) e.openUsageBtn.addEventListener("click", openUsage);
  document.querySelectorAll('[data-close="usage"]').forEach((btn) => btn.addEventListener("click", closeUsage));
  e.usageTabs.forEach((tab) =>
    tab.addEventListener("click", () => {
      setUsageTab(tab.dataset.usageTab || "today");
    })
  );

  if (e.clearHistoryBtn) e.clearHistoryBtn.addEventListener("click", async () => {
    if (!state.user) {
      setAuthMessage("请先登录后再清空历史记录。", "error");
      window.dispatchEvent(new CustomEvent("auth-required", { detail: { message: "请先登录后使用。" } }));
      return;
    }
    const r = await fetchJson("/api/history", { method: "DELETE" });
    if (!r.ok) return setAuthMessage(r.message || "清空失败。", "error");
    setAuthMessage("历史记录已清空。", "success");
    renderHistorySummary();
    window.dispatchEvent(new Event("history-updated"));
  });

  if (e.saveUnifiedApiBtn) e.saveUnifiedApiBtn.addEventListener("click", async () => {
    if (!isAdmin()) return;
    const apiKey = (e.unifiedApiKeyInput?.value || "").trim();
    if (!apiKey) return tone(e.unifiedApiStatus, "请输入统一 API Key。", "error");
    const r = await fetchJson("/api/admin/unified-api", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) });
    if (!r.ok) return tone(e.unifiedApiStatus, r.message || "保存失败。", "error");
    if (e.unifiedApiKeyInput) e.unifiedApiKeyInput.value = "";
    tone(e.unifiedApiStatus, "统一 API Key 已保存。", "success");
    refreshUnified();
  });

  if (e.clearUnifiedApiBtn) e.clearUnifiedApiBtn.addEventListener("click", async () => {
    if (!isAdmin()) return;
    const r = await fetchJson("/api/admin/unified-api", { method: "DELETE" });
    if (!r.ok) return tone(e.unifiedApiStatus, r.message || "清空失败。", "error");
    tone(e.unifiedApiStatus, "统一 API Key 已清空。", "success");
    refreshUnified();
  });

  if (e.refreshAdminUsersBtn) e.refreshAdminUsersBtn.addEventListener("click", refreshAdminUsers);

  if (e.adminUsersList) e.adminUsersList.addEventListener("click", async (ev) => {
    const card = ev.target.closest(".admin-user-card");
    if (!card) return;
    const userId = Number.parseInt(card.dataset.userId || "", 10);
    if (!Number.isInteger(userId) || userId <= 0) return;
    const status = card.querySelector(".admin-user-status");

    if (ev.target.closest(".admin-user-save")) {
      const account = (card.querySelector(".admin-user-email")?.value || "").trim();
      const role = card.querySelector(".admin-user-role")?.value || "user";
      const password = (card.querySelector(".admin-user-password")?.value || "").trim();
      const body = { account, email: account, role };
      if (password) body.password = password;
      tone(status, "正在保存...");
      const r = await fetchJson(`/api/admin/users/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) return tone(status, r.message || "保存失败。", "error");
      if (card.querySelector(".admin-user-password")) card.querySelector(".admin-user-password").value = "";
      tone(status, "保存成功。", "success");
      await refreshAdminUsers();
      if (state.user?.id === userId) await refreshAuth();
      return;
    }

    if (ev.target.closest(".admin-user-clear-history")) {
      tone(status, "正在清空该用户历史...");
      const r = await fetchJson(`/api/admin/users/${userId}/history`, { method: "DELETE" });
      if (!r.ok) return tone(status, r.message || "清空失败。", "error");
      tone(status, "历史记录已清空。", "success");
      await refreshAdminUsers();
      return;
    }

    if (ev.target.closest(".admin-user-clear-voice")) {
      tone(status, "正在清除该用户声纹...");
      const r = await fetchJson(`/api/admin/users/${userId}/voiceprint`, { method: "DELETE" });
      if (!r.ok) return tone(status, r.message || "清除声纹失败。", "error");
      tone(status, "该用户声纹已清除。", "success");
      await refreshAdminUsers();
      return;
    }

    if (ev.target.closest(".admin-user-view-history")) {
      const box = card.querySelector(".admin-user-history");
      if (!box) return;
      if (!box.hidden) {
        box.hidden = true;
        return;
      }
      tone(status, "正在读取历史...");
      const r = await fetchJson(`/api/admin/users/${userId}/history`);
      if (!r.ok) return tone(status, r.message || "读取失败。", "error");
      const items = Array.isArray(r.data?.items) ? r.data.items : [];
      box.textContent = items.length
        ? items.slice(0, 20).map((x, i) => `${i + 1}. [${fmt(x.time)}] ${String(x.prompt || "（无文本）").replace(/\s+/g, " ").slice(0, 120)}`).join("\n")
        : "该用户暂无历史记录。";
      box.hidden = false;
      tone(status, `已加载 ${items.length} 条历史。`, "success");
    }
  });

  window.addEventListener("history-updated", () => {
    renderHistorySummary();
    renderUsage();
  });
  window.addEventListener("keys-status-changed", renderKeys);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && e.usageModal?.classList.contains("is-open")) closeUsage();
  });

  document.addEventListener("DOMContentLoaded", () => {
    if (window.GeminiTheme?.setThemePreference) window.GeminiTheme.setThemePreference("system");
    setKeysVisibility(getKeysVisibility());
    renderKeys();
    renderUsage();
    renderVoice();
    renderAdmin();
    if (IS_LOGIN_PAGE) {
      const message = new URLSearchParams(window.location.search).get("message");
      if (message) {
        setAuthMessage(message, "error");
      }
    }
    refreshAuth().then(refreshVoiceStatus).catch(() => setUser(null));
  });

  window.AISolverAuth = {
    getUser: () => state.user,
    refresh: refreshAuth,
    isAdmin,
  };
})();
