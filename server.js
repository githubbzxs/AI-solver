const path = require("path");
const express = require("express");
const multer = require("multer");

const fetch = globalThis.fetch || require("node-fetch");

const app = express();
const MAX_IMAGES = 6;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/solve", upload.array("image", MAX_IMAGES), async (req, res) => {
  try {
    const apiKey = (req.body.apiKey || process.env.GEMINI_API_KEY || "").trim();
    const apiVersion = "v1beta";
    const model = (req.body.model || "gemini-3-flash-preview").trim();
    const prompt = (req.body.prompt || "").trim();
    const files = req.files || [];

    if (!apiKey) {
      return res.status(400).json({ error: "Missing API key." });
    }
    if (!prompt && files.length === 0) {
      return res.status(400).json({ error: "Provide text or an image." });
    }
    if (files.some((file) => !ALLOWED_IMAGE_TYPES.has(file.mimetype))) {
      return res.status(400).json({
        error: "Only PNG, JPEG, or WebP images are supported.",
      });
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

    const normalizedModel = model.replace(/^models\//, "");
    const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${encodeURIComponent(
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

    const answer = (data?.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || "")
      .join("")
      .trim();

    const usage = data?.usageMetadata || null;

    return res.json({
      answer: answer || "No answer returned.",
      usage,
      model: normalizedModel,
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error.", details: String(err) });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
