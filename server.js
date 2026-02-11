// 服务入口：
// 1) 提供静态页面（public/）
// 2) 接收前端表单/图片并转发给 Gemini
// 3) 提供用户认证、管理员能力与历史记录能力

// Node.js 内置模块与第三方依赖
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const bcrypt = require("bcryptjs");

const {
  createUser,
  getUserByAccount,
  getUserById,
  setUserRoleByAccount,
  updateUserById,
  listUsersForAdmin,
  getSessionByToken,
  deleteSessionByToken,
  createSession,
  createHistory,
  addHistoryImages,
  listHistory,
  countHistory,
  deleteHistoryByUser,
  getHistoryImage,
  getHistoryImageById,
  setVoiceprintForUser,
  clearVoiceprintForUser,
  getVoiceprintByUserId,
  getUnifiedApiSetting,
  upsertUnifiedApiSetting,
} = require("./db");

// Node 18+ 自带 fetch；旧版本用 node-fetch 兼容
const fetch = globalThis.fetch || require("node-fetch");

// Express 应用与上传限制
const app = express();
const MAX_IMAGES = 6;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DEFAULT_MODEL = "gemini-3-flash-preview";
const API_VERSION = "v1beta";
const GEMINI_BASE_URL = (
  process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com"
).replace(/\/+$/, "");
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_ROOT = path.join(DATA_DIR, "uploads");
if (!fs.existsSync(UPLOAD_ROOT)) {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

const SESSION_COOKIE = "ai_solver_session";
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 6;
const ACCOUNT_MIN_LENGTH = 3;
const ACCOUNT_MAX_LENGTH = 64;
const VALID_ROLES = new Set(["user", "admin"]);
const ADMIN_ACCOUNT = ((process.env.ADMIN_ACCOUNT || process.env.ADMIN_EMAIL || "admin") || "")
  .trim()
  .toLowerCase();
const VOICEPRINT_SIMILARITY_THRESHOLD = (() => {
  const raw = Number.parseFloat(process.env.VOICEPRINT_SIMILARITY_THRESHOLD || "0.82");
  if (Number.isFinite(raw) && raw > 0 && raw < 1) return raw;
  return 0.82;
})();
const VOICEPRINT_MIN_DIMENSIONS = (() => {
  const raw = Number.parseInt(process.env.VOICEPRINT_MIN_DIMENSIONS || "16", 10);
  return Number.isInteger(raw) && raw > 0 ? raw : 16;
})();
const VOICEPRINT_MAX_DIMENSIONS = (() => {
  const raw = Number.parseInt(process.env.VOICEPRINT_MAX_DIMENSIONS || "4096", 10);
  return Number.isInteger(raw) && raw >= VOICEPRINT_MIN_DIMENSIONS ? raw : 4096;
})();

// multer 解析 multipart/form-data，内存存储便于直接转 base64
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const parseCookies = (header) => {
  if (!header) return {};
  return header.split(";").reduce((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join("=") || "");
    return acc;
  }, {});
};

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

// 统一“账户”入参：优先 account，兼容旧请求的 email
const normalizeAccount = (input) => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const hasAccount = Object.prototype.hasOwnProperty.call(input, "account");
    const rawValue = hasAccount ? input.account : input.email;
    return String(rawValue || "").trim().toLowerCase();
  }
  return String(input || "").trim().toLowerCase();
};

const validateAccount = (account) => {
  if (!account) return "账户不能为空。";
  if (account.length < ACCOUNT_MIN_LENGTH || account.length > ACCOUNT_MAX_LENGTH) {
    return `账户长度需在 ${ACCOUNT_MIN_LENGTH}-${ACCOUNT_MAX_LENGTH} 个字符之间。`;
  }
  if (/\s/.test(account)) {
    return "账户不能包含空白字符。";
  }
  return null;
};

const parseIntegerId = (value) => {
  const id = Number.parseInt(value, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
};

const shouldUseSecureCookie = (req) => {
  const forceSecure = (process.env.SESSION_COOKIE_SECURE || "").trim().toLowerCase();
  if (forceSecure === "true" || forceSecure === "1") return true;
  if (forceSecure === "false" || forceSecure === "0") return false;

  const forwardedProto = (req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  return req.secure || forwardedProto === "https";
};

const buildSessionCookie = (token, secure) => {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
};

const buildLogoutCookie = (secure) => {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
};

const attachUser = (req, _res, next) => {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE];
  if (!token) return next();

  const tokenHash = hashToken(token);
  const session = getSessionByToken(tokenHash);
  if (!session) return next();

  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    deleteSessionByToken(tokenHash);
    return next();
  }

  req.user = {
    id: session.user_id,
    account: normalizeAccount(session.email),
    email: session.email,
    role: session.role || "user",
  };
  req.sessionToken = token;
  return next();
};

const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "请先登录。" });
  }
  return next();
};

const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "请先登录。" });
  }
  if ((req.user.role || "user") !== "admin") {
    return res.status(403).json({ error: "需要管理员权限。" });
  }
  return next();
};

const issueSession = (req, res, userId) => {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  createSession(userId, tokenHash, expiresAt);
  res.setHeader("Set-Cookie", buildSessionCookie(token, shouldUseSecureCookie(req)));
};

const clearSession = (req, res, token) => {
  if (token) {
    deleteSessionByToken(hashToken(token));
  }
  res.setHeader("Set-Cookie", buildLogoutCookie(shouldUseSecureCookie(req)));
};

const sanitizeBaseName = (name) =>
  (name || "image").replace(/[^\w.-]+/g, "_").slice(0, 80);

const EXT_BY_MIME = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

const toPublicUser = (user) => {
  if (!user) return null;
  const account = normalizeAccount(user.email);
  return {
    id: user.id,
    account,
    email: user.email,
    role: user.role || "user",
    voiceprintEnabled: Boolean(user.voiceprint_enabled),
  };
};

const toHistoryItems = (records, options = {}) => {
  const imageBase = options.imageBase || "/api/history/image";
  return records.map((item) => ({
    id: item.id,
    time: item.created_at,
    prompt: item.prompt,
    answer: item.answer,
    images: (item.images || []).map((image) => ({
      id: image.id,
      name: image.filename,
      url: `${imageBase}/${image.id}`,
      mimeType: image.mime_type,
      size: image.size,
    })),
  }));
};

const safeJsonParse = (text) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
};

const normalizeVoiceprintVector = (rawVoiceprint, options = {}) => {
  const required = Boolean(options.required);
  if (typeof rawVoiceprint === "undefined" || rawVoiceprint === null || rawVoiceprint === "") {
    if (required) {
      return { error: "请提供声纹向量。" };
    }
    return { provided: false, vector: null };
  }

  let candidate = rawVoiceprint;
  if (typeof candidate === "object" && candidate && !Array.isArray(candidate)) {
    if (Array.isArray(candidate.vector)) {
      candidate = candidate.vector;
    }
  } else if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (!trimmed) {
      if (required) return { error: "请提供声纹向量。" };
      return { provided: false, vector: null };
    }
    if (trimmed.startsWith("[")) {
      const parsed = safeJsonParse(trimmed);
      if (!Array.isArray(parsed)) {
        return { error: "声纹向量 JSON 格式不正确。" };
      }
      candidate = parsed;
    } else {
      candidate = trimmed.split(/[\s,]+/).filter(Boolean);
    }
  }

  if (!Array.isArray(candidate)) {
    return { error: "声纹向量必须是数组或可解析的数字序列。" };
  }
  if (candidate.length < VOICEPRINT_MIN_DIMENSIONS) {
    return { error: `声纹向量维度过小，至少需要 ${VOICEPRINT_MIN_DIMENSIONS} 维。` };
  }
  if (candidate.length > VOICEPRINT_MAX_DIMENSIONS) {
    return { error: `声纹向量维度过大，最多允许 ${VOICEPRINT_MAX_DIMENSIONS} 维。` };
  }

  const vector = [];
  for (let i = 0; i < candidate.length; i += 1) {
    const value = Number(candidate[i]);
    if (!Number.isFinite(value)) {
      return { error: `声纹向量第 ${i + 1} 维不是有效数字。` };
    }
    vector.push(value);
  }

  const squareSum = vector.reduce((sum, item) => sum + item * item, 0);
  const norm = Math.sqrt(squareSum);
  if (!Number.isFinite(norm) || norm <= 0) {
    return { error: "声纹向量范数无效（不能全为 0）。" };
  }

  const normalized = vector.map((value) => Number((value / norm).toFixed(12)));
  return { provided: true, vector: normalized };
};

const parseStoredVoiceprint = (text) => {
  if (!text || typeof text !== "string") return null;
  const parsed = safeJsonParse(text);
  if (!Array.isArray(parsed)) return null;
  const normalized = normalizeVoiceprintVector(parsed, { required: true });
  if (normalized.error) return null;
  return normalized.vector;
};

const cosineSimilarity = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right)) return null;
  if (left.length === 0 || left.length !== right.length) return null;
  let dot = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
  }
  if (!Number.isFinite(dot)) return null;
  if (dot > 1) return 1;
  if (dot < -1) return -1;
  return dot;
};

const verifyVoiceprintForLogin = (user, rawVoiceprint) => {
  if (!Boolean(user?.voiceprint_enabled)) {
    return { ok: true };
  }

  const incoming = normalizeVoiceprintVector(rawVoiceprint, { required: true });
  if (incoming.error) {
    return {
      ok: false,
      status: 400,
      error: `该账号已启用声纹识别。${incoming.error}`,
      code: "VOICEPRINT_REQUIRED",
    };
  }

  const stored = parseStoredVoiceprint(user.voiceprint_vector);
  if (!stored) {
    return {
      ok: false,
      status: 500,
      error: "账号声纹数据异常，请联系管理员或重新录入声纹。",
      code: "VOICEPRINT_CORRUPTED",
    };
  }

  const similarity = cosineSimilarity(incoming.vector, stored);
  if (similarity === null) {
    return {
      ok: false,
      status: 401,
      error: "声纹维度不匹配或数据异常。",
      code: "VOICEPRINT_MISMATCH",
    };
  }

  if (similarity < VOICEPRINT_SIMILARITY_THRESHOLD) {
    return {
      ok: false,
      status: 401,
      error: "声纹验证失败。",
      code: "VOICEPRINT_MISMATCH",
      similarity: Number(similarity.toFixed(4)),
      threshold: VOICEPRINT_SIMILARITY_THRESHOLD,
    };
  }

  return {
    ok: true,
    similarity: Number(similarity.toFixed(4)),
  };
};

const saveHistoryForUser = (user, prompt, answer, files) => {
  if (!user) return null;

  const historyId = createHistory(user.id, prompt, answer);
  if (!files || files.length === 0) return historyId;

  const historyDir = path.join(UPLOAD_ROOT, String(user.id), String(historyId));
  fs.mkdirSync(historyDir, { recursive: true });

  const imagesMeta = [];
  files.forEach((file) => {
    const baseName = sanitizeBaseName(path.parse(file.originalname || "").name);
    const ext = EXT_BY_MIME[file.mimetype] || path.extname(file.originalname || "");
    const storedName = `${baseName}-${crypto.randomUUID()}${ext}`;
    const filePath = path.join(historyDir, storedName);
    fs.writeFileSync(filePath, file.buffer);
    imagesMeta.push({
      filename: file.originalname || storedName,
      mimeType: file.mimetype,
      path: filePath,
      size: file.size || file.buffer.length || 0,
    });
  });

  addHistoryImages(historyId, imagesMeta);
  return historyId;
};

const deleteFilesSafely = (paths) => {
  (paths || []).forEach((filePath) => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      // 忽略单个文件删除失败，避免阻塞整体清理
    }
  });
};

const normalizeModelName = (model) => {
  const value = (model || DEFAULT_MODEL).trim();
  const normalized = (value || DEFAULT_MODEL).replace(/^models\//, "");
  return normalized || DEFAULT_MODEL;
};

const maskApiKey = (apiKey) => {
  if (!apiKey) return null;
  if (apiKey.length <= 8) {
    return `${apiKey.slice(0, 2)}****`;
  }
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
};

const getUnifiedApiView = () => {
  const setting = getUnifiedApiSetting();
  const value = (setting?.setting_value || "").trim();
  return {
    hasKey: Boolean(value),
    masked: value ? maskApiKey(value) : null,
    updatedAt: setting?.updated_at || null,
    updatedBy: setting?.updated_by_email || null,
  };
};

const resolveApiKeyForSolve = (req) => {
  const bodyApiKey = (req.body?.apiKey || "").trim();
  const setting = getUnifiedApiSetting();
  const unifiedApiKey = (setting?.setting_value || "").trim();
  const envApiKey = (process.env.GEMINI_API_KEY || "").trim();
  const defaultApiKey = unifiedApiKey || envApiKey;
  const isAdmin = (req.user?.role || "user") === "admin";

  if (isAdmin && bodyApiKey) {
    return { apiKey: bodyApiKey, source: "admin_override" };
  }

  if (defaultApiKey) {
    return {
      apiKey: defaultApiKey,
      source: unifiedApiKey ? "unified" : "env",
    };
  }

  if (isAdmin) {
    return {
      error: {
        status: 400,
        message: "未提供 API Key，且系统未配置统一 API Key。",
      },
    };
  }

  return {
    error: {
      status: 400,
      message: "系统未配置统一 API Key，请联系管理员。",
    },
  };
};

// 统一构建解题请求入参，供普通/流式接口复用
const buildSolvePayload = (req) => {
  const auth = resolveApiKeyForSolve(req);
  if (auth.error) {
    return { error: auth.error };
  }

  const normalizedModel = normalizeModelName(req.body?.model || DEFAULT_MODEL);
  const prompt = (req.body?.prompt || "").trim();
  const files = Array.isArray(req.files) ? req.files : [];

  if (!prompt && files.length === 0) {
    return { error: { status: 400, message: "请填写题目或上传图片。" } };
  }

  if (files.some((file) => !ALLOWED_IMAGE_TYPES.has(file.mimetype))) {
    return { error: { status: 400, message: "仅支持 PNG/JPEG/WebP 图片。" } };
  }

  const parts = [];
  if (prompt) {
    parts.push({ text: prompt });
  }
  files.forEach((file) => {
    parts.push({
      inline_data: {
        mime_type: file.mimetype,
        data: file.buffer.toString("base64"),
      },
    });
  });

  return {
    apiKey: auth.apiKey,
    parts,
    normalizedModel,
    prompt,
    files,
    apiKeySource: auth.source,
  };
};

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

// 兼容 Gemini/OpenAI 风格响应，尽可能稳健地提取文本
const extractTextFromResponse = (payload) => {
  const rootList = asArray(payload);
  const texts = [];

  const pushText = (value) => {
    if (typeof value !== "string") return;
    if (!value) return;
    texts.push(value);
  };

  const extractFromParts = (parts) => {
    asArray(parts).forEach((part) => {
      pushText(part?.text);
      pushText(part?.inlineText);
    });
  };

  const extractFromCandidates = (candidates) => {
    asArray(candidates).forEach((candidate) => {
      extractFromParts(candidate?.content?.parts);
      extractFromParts(candidate?.parts);
      pushText(candidate?.text);
      pushText(candidate?.outputText);
    });
  };

  rootList.forEach((item) => {
    if (!item) return;

    extractFromCandidates(item?.candidates);
    extractFromCandidates(item?.response?.candidates);
    extractFromCandidates(item?.data?.candidates);

    asArray(item?.choices).forEach((choice) => {
      pushText(choice?.delta?.content);
      pushText(choice?.message?.content);
      asArray(choice?.delta?.content).forEach((chunk) => pushText(chunk?.text));
      asArray(choice?.message?.content).forEach((chunk) => pushText(chunk?.text));
    });

    pushText(item?.text);
    pushText(item?.response?.text);
    pushText(item?.output_text);
  });

  return texts.join("");
};

// 兼容 SSE 的两种 data 形态：
// 1) 单行完整 JSON；2) 多行 data 共同组成一个 JSON 文本
const parseSsePayloads = (rawBlock) => {
  const lines = rawBlock.split(/\r?\n/);
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) return [];

  const merged = dataLines.join("\n").trim();
  if (!merged || merged === "[DONE]") return [];

  const mergedParsed = safeJsonParse(merged);
  if (mergedParsed !== null) return [mergedParsed];

  return dataLines
    .map((line) => line.trim())
    .filter((line) => line && line !== "[DONE]")
    .map((line) => safeJsonParse(line))
    .filter((item) => item !== null);
};

const buildGeminiUrl = ({ normalizedModel, action, apiKey, alt }) => {
  const endpointPath = `${API_VERSION}/models/${encodeURIComponent(normalizedModel)}:${action}`;
  const url = new URL(endpointPath, `${GEMINI_BASE_URL}/`);
  if (alt) {
    url.searchParams.set("alt", alt);
  }
  url.searchParams.set("key", apiKey);
  return url.toString();
};

const callGenerateContent = async ({ apiKey, normalizedModel, parts, signal }) => {
  const url = buildGeminiUrl({
    normalizedModel,
    action: "generateContent",
    apiKey,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
    }),
    signal,
  });

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error?.message || "Gemini API error.";
    return { ok: false, status: response.status, message, data };
  }

  return { ok: true, status: response.status, data };
};

const ensureAdminRoleOnStartup = () => {
  if (!ADMIN_ACCOUNT) return;
  try {
    const adminUser = getUserByAccount(ADMIN_ACCOUNT);
    if (!adminUser) return;
    if ((adminUser.role || "user") === "admin") return;
    setUserRoleByAccount(ADMIN_ACCOUNT, "admin");
    console.log(`[auth] 已将 ${ADMIN_ACCOUNT} 设置为管理员。`);
  } catch (error) {
    console.error("[auth] 管理员角色初始化失败：", error);
  }
};

ensureAdminRoleOnStartup();

app.use(express.json({ limit: "1mb" }));
app.use(attachUser);
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/auth/register", async (req, res) => {
  try {
    const account = normalizeAccount(req.body || {});
    const password = (req.body?.password || "").trim();
    const voiceprintInput = req.body?.voiceprint;

    const accountError = validateAccount(account);
    if (accountError) {
      return res.status(400).json({ error: accountError });
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      return res
        .status(400)
        .json({ error: `密码至少 ${PASSWORD_MIN_LENGTH} 位。` });
    }
    if (getUserByAccount(account)) {
      return res.status(409).json({ error: "该账户已注册。" });
    }

    const voiceprint = normalizeVoiceprintVector(voiceprintInput, { required: false });
    if (voiceprint.error) {
      return res.status(400).json({ error: voiceprint.error });
    }

    const hash = await bcrypt.hash(password, 10);
    const role = account === ADMIN_ACCOUNT ? "admin" : "user";
    let user = createUser(
      account,
      hash,
      role,
      voiceprint.provided ? JSON.stringify(voiceprint.vector) : null,
      voiceprint.provided
    );

    // 兜底保证管理员账户始终是 admin
    if (account === ADMIN_ACCOUNT && user.role !== "admin") {
      setUserRoleByAccount(account, "admin");
      user = getUserByAccount(account);
    }

    issueSession(req, res, user.id);
    return res.json({ user: toPublicUser(user) });
  } catch (err) {
    return res.status(500).json({ error: "注册失败。", details: String(err) });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const account = normalizeAccount(req.body || {});
    const password = (req.body?.password || "").trim();

    const accountError = validateAccount(account);
    if (accountError) {
      return res.status(400).json({ error: accountError });
    }
    if (!password) {
      return res.status(400).json({ error: "请输入密码。" });
    }

    let user = getUserByAccount(account);
    if (!user) {
      return res.status(401).json({ error: "账号或密码错误。" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "账号或密码错误。" });
    }

    // 若管理员账户因旧数据异常被降权，这里再兜底拉回 admin
    if (account === ADMIN_ACCOUNT && (user.role || "user") !== "admin") {
      setUserRoleByAccount(account, "admin");
      user = getUserByAccount(account);
    }

    const voiceprintCheck = verifyVoiceprintForLogin(user, req.body?.voiceprint);
    if (!voiceprintCheck.ok) {
      return res.status(voiceprintCheck.status).json({
        error: voiceprintCheck.error,
        code: voiceprintCheck.code,
        similarity: voiceprintCheck.similarity ?? null,
        threshold: voiceprintCheck.threshold ?? VOICEPRINT_SIMILARITY_THRESHOLD,
      });
    }

    issueSession(req, res, user.id);
    return res.json({
      user: toPublicUser(user),
      voiceprint: {
        required: Boolean(user.voiceprint_enabled),
        verified: Boolean(user.voiceprint_enabled),
        similarity: voiceprintCheck.similarity ?? null,
        threshold: VOICEPRINT_SIMILARITY_THRESHOLD,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: "登录失败。", details: String(err) });
  }
});

app.post("/api/auth/logout", (req, res) => {
  clearSession(req, res, req.sessionToken);
  return res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.user) {
    return res.json({ user: null });
  }
  const latestUser = getUserById(req.user.id);
  if (!latestUser) {
    return res.json({ user: null });
  }
  return res.json({ user: toPublicUser(latestUser) });
});

app.get("/api/auth/voiceprint/status", requireAuth, (req, res) => {
  const voiceprint = getVoiceprintByUserId(req.user.id);
  const enabled = Boolean(voiceprint?.voiceprint_enabled);
  const hasVoiceprint = Boolean(voiceprint?.voiceprint_vector);
  return res.json({
    enabled,
    enrolled: enabled,
    hasVoiceprint,
    threshold: VOICEPRINT_SIMILARITY_THRESHOLD,
  });
});

app.post("/api/auth/voiceprint/enroll", requireAuth, (req, res) => {
  const voiceprint = normalizeVoiceprintVector(req.body?.voiceprint, { required: true });
  if (voiceprint.error) {
    return res.status(400).json({ error: voiceprint.error });
  }

  setVoiceprintForUser(req.user.id, JSON.stringify(voiceprint.vector));
  return res.json({
    ok: true,
    enabled: true,
    enrolled: true,
    hasVoiceprint: true,
    dimensions: voiceprint.vector.length,
    threshold: VOICEPRINT_SIMILARITY_THRESHOLD,
    updatedAt: new Date().toISOString(),
  });
});

app.delete("/api/auth/voiceprint", requireAuth, (req, res) => {
  clearVoiceprintForUser(req.user.id);
  return res.json({ ok: true, enabled: false, enrolled: false, hasVoiceprint: false });
});

app.get("/api/history", requireAuth, (req, res) => {
  const items = toHistoryItems(listHistory(req.user.id));
  return res.json({ items });
});

app.get("/api/history/summary", requireAuth, (req, res) => {
  const count = countHistory(req.user.id);
  return res.json({ count });
});

app.delete("/api/history", requireAuth, (req, res) => {
  const paths = deleteHistoryByUser(req.user.id);
  deleteFilesSafely(paths);
  return res.json({ ok: true });
});

app.get("/api/history/image/:imageId", requireAuth, (req, res) => {
  const imageId = parseIntegerId(req.params.imageId);
  if (!imageId) {
    return res.status(400).json({ error: "图片不存在。" });
  }
  const image = getHistoryImage(req.user.id, imageId);
  if (!image || !image.path) {
    return res.status(404).json({ error: "图片不存在。" });
  }
  if (!fs.existsSync(image.path)) {
    return res.status(404).json({ error: "图片文件不存在。" });
  }
  res.setHeader("Content-Type", image.mime_type);
  return res.sendFile(path.resolve(image.path));
});

app.get("/api/admin/users", requireAuth, requireAdmin, (_req, res) => {
  const items = listUsersForAdmin().map((item) => ({
    id: item.id,
    account: normalizeAccount(item.email),
    email: item.email,
    role: item.role || "user",
    createdAt: item.created_at,
    historyCount: item.history_count || 0,
    voiceprintEnabled: Boolean(item.voiceprint_enabled),
  }));
  return res.json({ items });
});

app.get("/api/admin/users/:userId", requireAuth, requireAdmin, (req, res) => {
  const userId = parseIntegerId(req.params.userId);
  if (!userId) {
    return res.status(400).json({ error: "用户 ID 不合法。" });
  }
  const targetUser = getUserById(userId);
  if (!targetUser) {
    return res.status(404).json({ error: "用户不存在。" });
  }
  return res.json({
    user: {
      id: targetUser.id,
      account: normalizeAccount(targetUser.email),
      email: targetUser.email,
      role: targetUser.role || "user",
      createdAt: targetUser.created_at,
      voiceprintEnabled: Boolean(targetUser.voiceprint_enabled),
      hasVoiceprint: Boolean(targetUser.voiceprint_vector),
      historyCount: countHistory(targetUser.id),
    },
  });
});

app.patch("/api/admin/users/:userId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseIntegerId(req.params.userId);
    if (!userId) {
      return res.status(400).json({ error: "用户 ID 不合法。" });
    }

    const targetUser = getUserById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: "用户不存在。" });
    }

    const updates = {};
    const body = req.body || {};

    if (
      Object.prototype.hasOwnProperty.call(body, "account") ||
      Object.prototype.hasOwnProperty.call(body, "email")
    ) {
      const rawAccount = Object.prototype.hasOwnProperty.call(body, "account")
        ? body.account
        : body.email;
      const account = normalizeAccount(rawAccount);
      const accountError = validateAccount(account);
      if (accountError) {
        return res.status(400).json({ error: accountError });
      }
      const existing = getUserByAccount(account);
      if (existing && existing.id !== targetUser.id) {
        return res.status(409).json({ error: "该账户已被占用。" });
      }
      updates.email = account;
    }

    if (Object.prototype.hasOwnProperty.call(body, "password")) {
      const password = (body.password || "").trim();
      if (password.length < PASSWORD_MIN_LENGTH) {
        return res
          .status(400)
          .json({ error: `密码至少 ${PASSWORD_MIN_LENGTH} 位。` });
      }
      updates.password_hash = await bcrypt.hash(password, 10);
    }

    if (Object.prototype.hasOwnProperty.call(body, "role")) {
      const role = String(body.role || "").trim().toLowerCase();
      if (!VALID_ROLES.has(role)) {
        return res.status(400).json({ error: "角色仅支持 user/admin。" });
      }
      if (targetUser.id === req.user.id && role !== "admin") {
        return res.status(400).json({ error: "不能将当前登录管理员降权。" });
      }
      const finalAccount = normalizeAccount(updates.email || targetUser.email);
      if (finalAccount === ADMIN_ACCOUNT && role !== "admin") {
        return res.status(400).json({ error: "系统管理员账户不能被降为普通用户。" });
      }
      updates.role = role;
    }

    // 管理员账户必须为 admin
    const resultingAccount = normalizeAccount(updates.email || targetUser.email);
    if (resultingAccount === ADMIN_ACCOUNT) {
      updates.role = "admin";
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "没有可更新字段。" });
    }

    let updatedUser;
    try {
      updatedUser = updateUserById(targetUser.id, updates);
    } catch (error) {
      if (String(error).includes("UNIQUE constraint failed: users.email")) {
        return res.status(409).json({ error: "该账户已被占用。" });
      }
      throw error;
    }

    return res.json({
      user: {
        id: updatedUser.id,
        account: normalizeAccount(updatedUser.email),
        email: updatedUser.email,
        role: updatedUser.role || "user",
        createdAt: updatedUser.created_at,
        voiceprintEnabled: Boolean(updatedUser.voiceprint_enabled),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: "更新用户失败。", details: String(err) });
  }
});

app.get("/api/admin/users/:userId/history", requireAuth, requireAdmin, (req, res) => {
  const userId = parseIntegerId(req.params.userId);
  if (!userId) {
    return res.status(400).json({ error: "用户 ID 不合法。" });
  }
  const targetUser = getUserById(userId);
  if (!targetUser) {
    return res.status(404).json({ error: "用户不存在。" });
  }

  const items = toHistoryItems(listHistory(userId), {
    imageBase: "/api/admin/history/image",
  });
  return res.json({
    user: {
      id: targetUser.id,
      account: normalizeAccount(targetUser.email),
      email: targetUser.email,
      role: targetUser.role || "user",
    },
    items,
  });
});

app.delete("/api/admin/users/:userId/history", requireAuth, requireAdmin, (req, res) => {
  const userId = parseIntegerId(req.params.userId);
  if (!userId) {
    return res.status(400).json({ error: "用户 ID 不合法。" });
  }
  const targetUser = getUserById(userId);
  if (!targetUser) {
    return res.status(404).json({ error: "用户不存在。" });
  }

  const paths = deleteHistoryByUser(userId);
  deleteFilesSafely(paths);
  return res.json({ ok: true, deletedFiles: paths.length });
});

app.delete("/api/admin/users/:userId/voiceprint", requireAuth, requireAdmin, (req, res) => {
  const userId = parseIntegerId(req.params.userId);
  if (!userId) {
    return res.status(400).json({ error: "用户 ID 不合法。" });
  }

  const targetUser = getUserById(userId);
  if (!targetUser) {
    return res.status(404).json({ error: "用户不存在。" });
  }

  const updatedUser = clearVoiceprintForUser(userId);
  return res.json({
    ok: true,
    user: {
      id: updatedUser.id,
      account: normalizeAccount(updatedUser.email),
      email: updatedUser.email,
      role: updatedUser.role || "user",
      voiceprintEnabled: Boolean(updatedUser.voiceprint_enabled),
      hasVoiceprint: Boolean(updatedUser.voiceprint_vector),
    },
  });
});

app.get("/api/admin/history/image/:imageId", requireAuth, requireAdmin, (req, res) => {
  const imageId = parseIntegerId(req.params.imageId);
  if (!imageId) {
    return res.status(400).json({ error: "图片不存在。" });
  }
  const image = getHistoryImageById(imageId);
  if (!image || !image.path) {
    return res.status(404).json({ error: "图片不存在。" });
  }
  if (!fs.existsSync(image.path)) {
    return res.status(404).json({ error: "图片文件不存在。" });
  }
  res.setHeader("Content-Type", image.mime_type);
  return res.sendFile(path.resolve(image.path));
});

app.get("/api/admin/unified-api", requireAuth, requireAdmin, (_req, res) => {
  return res.json(getUnifiedApiView());
});

app.put("/api/admin/unified-api", requireAuth, requireAdmin, (req, res) => {
  const apiKey = (req.body?.apiKey || "").trim();
  if (!apiKey) {
    return res.status(400).json({ error: "apiKey 不能为空。" });
  }
  upsertUnifiedApiSetting(apiKey, req.user.id);
  return res.json(getUnifiedApiView());
});

app.delete("/api/admin/unified-api", requireAuth, requireAdmin, (req, res) => {
  upsertUnifiedApiSetting(null, req.user.id);
  return res.json(getUnifiedApiView());
});

app.post(
  "/api/solve",
  requireAuth,
  upload.array("image", MAX_IMAGES),
  async (req, res) => {
    try {
      const payload = buildSolvePayload(req);
      if (payload.error) {
        return res.status(payload.error.status).json({ error: payload.error.message });
      }

      const { apiKey, parts, normalizedModel, prompt, files } = payload;
      const result = await callGenerateContent({ apiKey, normalizedModel, parts });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.message, details: result.data });
      }
      const data = result.data || {};

      const answer = extractTextFromResponse(data).trim();
      const usage = data?.usageMetadata || null;

      if (req.user && answer) {
        try {
          saveHistoryForUser(req.user, prompt, answer, files);
        } catch (error) {
          // 历史保存失败不影响答题主流程
        }
      }

      return res.json({
        answer: answer || "No answer returned.",
        usage,
        model: normalizedModel,
      });
    } catch (err) {
      console.error("[/api/solve] unexpected error:", err);
      return res.status(500).json({ error: "服务器错误，请稍后再试。", details: String(err) });
    }
  }
);

app.post(
  "/api/solve-stream",
  requireAuth,
  upload.array("image", MAX_IMAGES),
  async (req, res) => {
    let controller = null;
    let cleanupAbortListeners = () => {};

    try {
      const payload = buildSolvePayload(req);
      if (payload.error) {
        return res.status(payload.error.status).json({ error: payload.error.message });
      }

      const { apiKey, parts, normalizedModel, prompt, files } = payload;
      const url = buildGeminiUrl({
        normalizedModel,
        action: "streamGenerateContent",
        alt: "sse",
        apiKey,
      });

      controller = new AbortController();
      const abortUpstream = () => {
        if (controller && !controller.signal.aborted) {
          controller.abort();
        }
      };
      const onRequestAborted = () => {
        abortUpstream();
      };
      const onResponseClosed = () => {
        if (!res.writableEnded) {
          abortUpstream();
        }
      };
      req.on("aborted", onRequestAborted);
      res.on("close", onResponseClosed);
      cleanupAbortListeners = () => {
        req.off("aborted", onRequestAborted);
        res.off("close", onResponseClosed);
      };

      const upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
        }),
        signal: controller.signal,
      });

      if (!upstream.ok) {
        let errorData = null;
        try {
          errorData = await upstream.json();
        } catch (error) {
          errorData = null;
        }
        const message = errorData?.error?.message || "Gemini API error.";
        return res.status(upstream.status).json({ error: message, details: errorData });
      }

      if (!upstream.body) {
        return res.status(502).json({ error: "Empty stream response." });
      }

      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let usage = null;
      let answerText = "";
      let lastParsedPayload = null;

      const sendEvent = (type, data) => {
        res.write(`event: ${type}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (typeof res.flush === "function") {
          res.flush();
        }
      };

      const handleChunk = (raw) => {
        const payloads = parseSsePayloads(raw);
        if (payloads.length === 0) return;

        payloads.forEach((parsed) => {
          lastParsedPayload = parsed;
          const list = Array.isArray(parsed) ? parsed : [parsed];
          list.forEach((item) => {
            if (item?.usageMetadata) {
              usage = item.usageMetadata;
            }
          });

          const text = extractTextFromResponse(parsed);
          if (!text) return;
          answerText += text;
          sendEvent("chunk", { text });
        });
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";
        blocks.forEach(handleChunk);
      }

      if (buffer.trim()) {
        handleChunk(buffer);
      }

      // 若上游流式未返回可显示文本，补一次非流式请求兜底，避免前端出现空答案
      if (!answerText.trim()) {
        const fallback = await callGenerateContent({
          apiKey,
          normalizedModel,
          parts,
          signal: controller.signal,
        });
        if (!fallback.ok) {
          sendEvent("error", {
            status: fallback.status,
            message: fallback.message || "请求失败。",
            details: fallback.data || lastParsedPayload || null,
          });
          return res.end();
        }

        const fallbackText = extractTextFromResponse(fallback.data).trim();
        if (!fallbackText) {
          const blockReason =
            fallback.data?.promptFeedback?.blockReason ||
            lastParsedPayload?.promptFeedback?.blockReason ||
            null;
          const message = blockReason
            ? `模型未返回可显示文本（${blockReason}）。`
            : "模型未返回可显示文本。";
          sendEvent("error", {
            status: 502,
            message,
            details: fallback.data || lastParsedPayload || null,
          });
          return res.end();
        }

        answerText = fallbackText;
        if (fallback.data?.usageMetadata) {
          usage = fallback.data.usageMetadata;
        }
        sendEvent("chunk", { text: fallbackText });
      }

      if (req.user && answerText.trim()) {
        try {
          saveHistoryForUser(req.user, prompt, answerText, files);
        } catch (error) {
          // 历史保存失败不影响答题主流程
        }
      }

      sendEvent("done", { usage, model: normalizedModel });
      return res.end();
    } catch (err) {
      if (err?.name === "AbortError") {
        return res.end();
      }
      console.error("[/api/solve-stream] unexpected error:", err);
      return res.status(500).json({ error: "服务器错误，请稍后再试。", details: String(err) });
    } finally {
      cleanupAbortListeners();
      controller = null;
    }
  }
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// 启动服务
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
