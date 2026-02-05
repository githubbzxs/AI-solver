// 数据库与持久化：负责用户、会话与历史记录存储
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "app.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    prompt TEXT,
    answer TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS history_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    history_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    path TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (history_id) REFERENCES history(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_history_user_id ON history(user_id);
  CREATE INDEX IF NOT EXISTS idx_history_images_history_id ON history_images(history_id);
`);

const createUser = (email, passwordHash) => {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)"
  );
  const info = stmt.run(email, passwordHash, now);
  return { id: info.lastInsertRowid, email };
};

const getUserByEmail = (email) =>
  db.prepare("SELECT * FROM users WHERE email = ?").get(email);

const getUserById = (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id);

const createSession = (userId, tokenHash, expiresAt) => {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(userId, tokenHash, now, expiresAt);
};

const getSessionByToken = (tokenHash) =>
  db
    .prepare(
      `SELECT sessions.id as session_id, sessions.expires_at, users.id as user_id, users.email
       FROM sessions
       JOIN users ON sessions.user_id = users.id
       WHERE sessions.token_hash = ?`
    )
    .get(tokenHash);

const deleteSessionByToken = (tokenHash) =>
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);

const createHistory = (userId, prompt, answer) => {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO history (user_id, prompt, answer, created_at) VALUES (?, ?, ?, ?)"
  );
  const info = stmt.run(userId, prompt, answer, now);
  return info.lastInsertRowid;
};

const addHistoryImages = (historyId, images) => {
  if (!images || images.length === 0) return;
  const stmt = db.prepare(
    "INSERT INTO history_images (history_id, filename, mime_type, path, size, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const now = new Date().toISOString();
  const insertMany = db.transaction((items) => {
    items.forEach((item) => {
      stmt.run(historyId, item.filename, item.mimeType, item.path, item.size, now);
    });
  });
  insertMany(images);
};

const listHistory = (userId) => {
  const histories = db
    .prepare(
      "SELECT id, prompt, answer, created_at FROM history WHERE user_id = ? ORDER BY id DESC"
    )
    .all(userId);
  if (histories.length === 0) return [];

  const ids = histories.map((item) => item.id);
  const placeholders = ids.map(() => "?").join(",");
  const images = db
    .prepare(
      `SELECT id, history_id, filename, mime_type, path, size, created_at
       FROM history_images
       WHERE history_id IN (${placeholders})
       ORDER BY id ASC`
    )
    .all(...ids);

  const grouped = new Map();
  images.forEach((image) => {
    if (!grouped.has(image.history_id)) grouped.set(image.history_id, []);
    grouped.get(image.history_id).push(image);
  });

  return histories.map((item) => ({
    ...item,
    images: grouped.get(item.id) || [],
  }));
};

const countHistory = (userId) => {
  const row = db
    .prepare("SELECT COUNT(1) as count FROM history WHERE user_id = ?")
    .get(userId);
  return row ? row.count : 0;
};

const deleteHistoryByUser = (userId) => {
  const images = db
    .prepare(
      `SELECT history_images.path as path
       FROM history_images
       JOIN history ON history_images.history_id = history.id
       WHERE history.user_id = ?`
    )
    .all(userId);

  const deleteTx = db.transaction(() => {
    db.prepare("DELETE FROM history_images WHERE history_id IN (SELECT id FROM history WHERE user_id = ?)")
      .run(userId);
    db.prepare("DELETE FROM history WHERE user_id = ?").run(userId);
  });

  deleteTx();
  return images.map((item) => item.path);
};

const getHistoryImage = (userId, imageId) =>
  db
    .prepare(
      `SELECT history_images.id, history_images.filename, history_images.mime_type, history_images.path
       FROM history_images
       JOIN history ON history_images.history_id = history.id
       WHERE history.user_id = ? AND history_images.id = ?`
    )
    .get(userId, imageId);

module.exports = {
  createUser,
  getUserByEmail,
  getUserById,
  createSession,
  getSessionByToken,
  deleteSessionByToken,
  createHistory,
  addHistoryImages,
  listHistory,
  countHistory,
  deleteHistoryByUser,
  getHistoryImage,
};
