// 服务入口：
// 1) 提供静态页面（public/）
// 2) 接收前端表单/图片并转发给 Gemini
// 3) 把答案与用量信息返回给浏览器

// Node.js 内置模块与第三方依赖
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const bcrypt = require("bcryptjs");

const {
  createUser,
  getUserByEmail,
  getSessionByToken,
  deleteSessionByToken,
  createSession,
  createHistory,
  addHistoryImages,
  listHistory,
  countHistory,
  deleteHistoryByUser,
  getHistoryImage,
} = require("./db");

// Node 18+ 自带 fetch；旧版本用 node-fetch 兼容
const fetch = globalThis.fetch || require("node-fetch");

// Express 应用与上传限制
const app = express();
const MAX_IMAGES = 6;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DEFAULT_MODEL = "gemini-3-flash-preview";
const API_VERSION = "v1beta";
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_ROOT = path.join(DATA_DIR, "uploads");
if (!fs.existsSync(UPLOAD_ROOT)) {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

const SESSION_COOKIE = "ai_solver_session";
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 6;
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;
// multer 瑙ｆ瀽 multipart/form-data锛涘唴瀛樺瓨鍌ㄤ究浜庣洿鎺ヨ浆 base64
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

  const session = getSessionByToken(hashToken(token));
  if (!session) return next();

  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    deleteSessionByToken(hashToken(token));
    return next();
  }

  req.user = { id: session.user_id, email: session.email };
  req.sessionToken = token;
  return next();
};

const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "请先登录。" });
  }
  return next();
};

const normalizeEmail = (email) => (email || "").trim().toLowerCase();

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

const normalizeModelName = (model) => {
  const value = (model || DEFAULT_MODEL).trim();
  const normalized = (value || DEFAULT_MODEL).replace(/^models\//, "");
  return normalized || DEFAULT_MODEL;
};

// 统一构建解题请求入参，供普通/流式接口复用
const buildSolvePayload = (req) => {
  const apiKey = (req.body?.apiKey || process.env.GEMINI_API_KEY || "").trim();
  const normalizedModel = normalizeModelName(req.body?.model || DEFAULT_MODEL);
  const prompt = (req.body?.prompt || "").trim();
  const files = Array.isArray(req.files) ? req.files : [];

  if (!apiKey) {
    return { error: { status: 400, message: "未提供 API Key。" } };
  }

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
    apiKey,
    parts,
    normalizedModel,
    prompt,
    files,
  };
};

// 兼容 Gemini 返回对象或数组两种形态，统一提取文本
const extractTextFromResponse = (payload) => {
  const list = Array.isArray(payload) ? payload : [payload];
  return list
    .flatMap((item) => (Array.isArray(item?.candidates) ? item.candidates : []))
    .flatMap((candidate) =>
      Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
    )
    .map((part) => part?.text || "")
    .join("");
};

const safeJsonParse = (text) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
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

app.use(express.json({ limit: "1mb" }));
app.use(attachUser);
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/auth/register", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = (req.body?.password || "").trim();

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: "邮箱格式不正确。" });
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      return res
        .status(400)
        .json({ error: `密码至少 ${PASSWORD_MIN_LENGTH} 位。` });
    }
    if (getUserByEmail(email)) {
      return res.status(409).json({ error: "该邮箱已注册。" });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = createUser(email, hash);
    issueSession(req, res, user.id);
    return res.json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    return res.status(500).json({ error: "注册失败。", details: String(err) });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = (req.body?.password || "").trim();

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: "邮箱格式不正确。" });
    }
    if (!password) {
      return res.status(400).json({ error: "请输入密码。" });
    }

    const user = getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: "账号或密码错误。" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "账号或密码错误。" });
    }

    issueSession(req, res, user.id);
    return res.json({ user: { id: user.id, email: user.email } });
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
  return res.json({ user: { id: req.user.id, email: req.user.email } });
});

app.get("/api/history", requireAuth, (req, res) => {
  const items = listHistory(req.user.id).map((item) => ({
    id: item.id,
    time: item.created_at,
    prompt: item.prompt,
    answer: item.answer,
    images: (item.images || []).map((image) => ({
      id: image.id,
      name: image.filename,
      url: `/api/history/image/${image.id}`,
      mimeType: image.mime_type,
      size: image.size,
    })),
  }));
  return res.json({ items });
});

app.get("/api/history/summary", requireAuth, (req, res) => {
  const count = countHistory(req.user.id);
  return res.json({ count });
});

app.delete("/api/history", requireAuth, (req, res) => {
  const paths = deleteHistoryByUser(req.user.id);
  paths.forEach((filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      // 忽略单个文件删除失败，避免阻塞整体清理
    }
  });
  return res.json({ ok: true });
});

app.get("/api/history/image/:imageId", requireAuth, (req, res) => {
  const imageId = Number.parseInt(req.params.imageId, 10);
  if (Number.isNaN(imageId)) {
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
      const url = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${encodeURIComponent(
        normalizedModel
      )}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const message = data?.error?.message || "Gemini API error.";
        return res.status(response.status).json({ error: message, details: data });
      }

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

// 鍋ュ悍妫€鏌ワ細閮ㄧ讲鎴栫洃鎺у彲鐢ㄦ潵鎺㈡椿
app.post(
  "/api/solve-stream",
  requireAuth,
  upload.array("image", MAX_IMAGES),
  async (req, res) => {
    let controller = null;

    try {
      const payload = buildSolvePayload(req);
      if (payload.error) {
        return res.status(payload.error.status).json({ error: payload.error.message });
      }

      const { apiKey, parts, normalizedModel, prompt, files } = payload;
      const url = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${encodeURIComponent(
        normalizedModel
      )}:streamGenerateContent?alt=sse&key=${apiKey}`;

      controller = new AbortController();
      req.on("close", () => {
        if (controller) controller.abort();
      });

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
    }
  }
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// 鍚姩鏈嶅姟
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});




