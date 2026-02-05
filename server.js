// 服务器入口：
// 1) 提供静态页面（public/）
// 2) 接收前端表单/图片并转发给 Gemini
// 3) 把答案与用量信息返回给浏览器

// Node.js 内置模块与第三方依赖
const path = require("path");
const express = require("express");
const multer = require("multer");

// Node 18+ 自带 fetch；旧版本用 node-fetch 兜底
const fetch = globalThis.fetch || require("node-fetch");

// Express 应用与上传限制
const app = express();
const MAX_IMAGES = 6;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DEFAULT_MODEL = "gemini-3-flash-preview";
// multer 解析 multipart/form-data；内存存储便于直接转 base64
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// 静态资源服务：让浏览器直接访问 public/ 目录
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/solve", upload.array("image", MAX_IMAGES), async (req, res) => {
  try {
    // 从表单或环境变量读取 key/model/prompt 与上传文件
    const apiKey = (req.body.apiKey || process.env.GEMINI_API_KEY || "").trim();
    const apiVersion = "v1beta";
    const model = DEFAULT_MODEL;
    const prompt = (req.body.prompt || "").trim();
    const files = req.files || [];

    // 基本校验：必须有 Key，且至少提供文字或图片
    if (!apiKey) {
      return res.status(400).json({ error: "Missing API key." });
    }
    if (!prompt && files.length === 0) {
      return res.status(400).json({ error: "Provide text or an image." });
    }
    // 只接受常见图片格式，避免服务端/模型无法解析
    if (files.some((file) => !ALLOWED_IMAGE_TYPES.has(file.mimetype))) {
      return res.status(400).json({
        error: "Only PNG, JPEG, or WebP images are supported.",
      });
    }

    // Gemini API 采用 parts 结构：文字与图片都放在同一个数组里
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

    // 规范化模型名（去掉可选的 models/ 前缀），并拼接请求地址
    const normalizedModel = model.replace(/^models\//, "");
    const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${encodeURIComponent(
      normalizedModel
    )}:generateContent?key=${apiKey}`;

    // 调用 Gemini 生成内容接口
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
      }),
    });

    // 解析响应 JSON
    const data = await response.json();

    // HTTP 状态非 2xx 时，把错误信息透传给前端
    if (!response.ok) {
      const message = data?.error?.message || "Gemini API error.";
      return res.status(response.status).json({ error: message, details: data });
    }

    // Gemini 返回的文本可能被拆成多段，这里拼成一个字符串
    const answer = (data?.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || "")
      .join("")
      .trim();

    // usageMetadata 里包含 token/请求统计，前端可用于展示用量
    const usage = data?.usageMetadata || null;

    // 返回给前端：答案、用量、模型名
    return res.json({
      answer: answer || "No answer returned.",
      usage,
      model: normalizedModel,
    });
  } catch (err) {
    // 兜底错误：网络/解析/运行时异常
    return res.status(500).json({ error: "Server error.", details: String(err) });
  }
});

// 健康检查：部署或监控可用来探活
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// 启动服务
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
