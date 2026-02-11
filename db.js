// 数据库与持久化：负责用户、会话、历史记录与系统配置
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
    role TEXT NOT NULL DEFAULT 'user',
    voiceprint_vector TEXT,
    voiceprint_enabled INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL,
    updated_by_user_id INTEGER,
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_history_user_id ON history(user_id);
  CREATE INDEX IF NOT EXISTS idx_history_images_history_id ON history_images(history_id);
`);

const hasColumn = (table, column) => {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((row) => row.name === column);
};

const ensureColumn = (table, columnDef, columnName) => {
  if (hasColumn(table, columnName)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
};

// 兼容旧库：确保新增字段存在
ensureColumn("users", "role TEXT NOT NULL DEFAULT 'user'", "role");
ensureColumn("users", "voiceprint_vector TEXT", "voiceprint_vector");
ensureColumn("users", "voiceprint_enabled INTEGER NOT NULL DEFAULT 0", "voiceprint_enabled");

db.exec(`
  UPDATE users
  SET role = 'user'
  WHERE role IS NULL OR TRIM(role) = '';
`);

const normalizeRole = (role) =>
  String(role || "user").trim().toLowerCase() === "admin" ? "admin" : "user";

const normalizeVoiceprintPayload = (value) => {
  if (!value) return null;
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed;
  }
  return null;
};

const createUser = (email, passwordHash, optionsOrRole = {}, legacyVoiceprint, legacyEnabled) => {
  const now = new Date().toISOString();

  let role = "user";
  let voiceprintVector = null;
  let voiceprintEnabled = 0;

  if (typeof optionsOrRole === "string") {
    role = normalizeRole(optionsOrRole);
    voiceprintVector = normalizeVoiceprintPayload(legacyVoiceprint);
    if (typeof legacyEnabled === "boolean") {
      voiceprintEnabled = legacyEnabled ? 1 : 0;
    } else {
      voiceprintEnabled = voiceprintVector ? 1 : 0;
    }
  } else {
    const options = optionsOrRole || {};
    role = normalizeRole(options.role);
    voiceprintVector = normalizeVoiceprintPayload(options.voiceprintVector);
    voiceprintEnabled = voiceprintVector ? 1 : 0;
  }

  const stmt = db.prepare(
    `INSERT INTO users (
      email,
      password_hash,
      role,
      voiceprint_vector,
      voiceprint_enabled,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(email, passwordHash, role, voiceprintVector, voiceprintEnabled, now);
  return {
    id: info.lastInsertRowid,
    email,
    role,
    voiceprint_enabled: Boolean(voiceprintEnabled),
  };
};

const getUserByEmail = (email) =>
  db
    .prepare(
      `SELECT id, email, password_hash, role, voiceprint_vector, voiceprint_enabled, created_at
       FROM users
       WHERE email = ?`
    )
    .get(email);

// 账户语义别名：底层仍使用 users.email 列，避免破坏历史数据
const getUserByAccount = (account) => getUserByEmail(account);

const getUserById = (id) =>
  db
    .prepare(
      `SELECT id, email, password_hash, role, voiceprint_vector, voiceprint_enabled, created_at
       FROM users
       WHERE id = ?`
    )
    .get(id);

const updateUserById = (userId, updates = {}) => {
  const fields = [];
  const values = [];

  if (typeof updates.email === "string") {
    fields.push("email = ?");
    values.push(updates.email);
  }
  if (typeof updates.passwordHash === "string") {
    fields.push("password_hash = ?");
    values.push(updates.passwordHash);
  }
  if (typeof updates.password_hash === "string") {
    fields.push("password_hash = ?");
    values.push(updates.password_hash);
  }
  if (typeof updates.role === "string") {
    fields.push("role = ?");
    values.push(normalizeRole(updates.role));
  }

  if (fields.length > 0) {
    values.push(userId);
    db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  return getUserById(userId);
};

const setUserRoleByEmail = (email, role) =>
  db.prepare("UPDATE users SET role = ? WHERE email = ?").run(normalizeRole(role), email);

// 账户语义别名：底层仍使用 users.email 列
const setUserRoleByAccount = (account, role) => setUserRoleByEmail(account, role);

const setUserVoiceprint = (userId, voiceprintVector) => {
  const normalized = normalizeVoiceprintPayload(voiceprintVector);
  db.prepare(
    "UPDATE users SET voiceprint_vector = ?, voiceprint_enabled = 1 WHERE id = ?"
  ).run(normalized, userId);
  return getUserById(userId);
};

const clearUserVoiceprint = (userId) => {
  db.prepare(
    "UPDATE users SET voiceprint_vector = NULL, voiceprint_enabled = 0 WHERE id = ?"
  ).run(userId);
  return getUserById(userId);
};

const listUsersWithStats = () =>
  db
    .prepare(
      `SELECT
         users.id,
         users.email,
         users.role,
         users.voiceprint_enabled,
         users.created_at,
         COUNT(history.id) AS history_count
       FROM users
       LEFT JOIN history ON history.user_id = users.id
       GROUP BY users.id
       ORDER BY users.id ASC`
    )
    .all();

const createSession = (userId, tokenHash, expiresAt) => {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(userId, tokenHash, now, expiresAt);
};

const getSessionByToken = (tokenHash) =>
  db
    .prepare(
      `SELECT
         sessions.id AS session_id,
         sessions.expires_at,
         users.id AS user_id,
         users.email,
         users.role
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
    .prepare("SELECT COUNT(1) AS count FROM history WHERE user_id = ?")
    .get(userId);
  return row ? row.count : 0;
};

const deleteHistoryByUser = (userId) => {
  const images = db
    .prepare(
      `SELECT history_images.path AS path
       FROM history_images
       JOIN history ON history_images.history_id = history.id
       WHERE history.user_id = ?`
    )
    .all(userId);

  const deleteTx = db.transaction(() => {
    db.prepare(
      "DELETE FROM history_images WHERE history_id IN (SELECT id FROM history WHERE user_id = ?)"
    ).run(userId);
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

const getHistoryImageById = (imageId) =>
  db
    .prepare(
      `SELECT
         history_images.id,
         history_images.filename,
         history_images.mime_type,
         history_images.path,
         history.user_id
       FROM history_images
       JOIN history ON history_images.history_id = history.id
       WHERE history_images.id = ?`
    )
    .get(imageId);

const getSystemSetting = (key) =>
  db
    .prepare(
      `SELECT
         system_settings.key,
         system_settings.value,
         system_settings.updated_at,
         system_settings.updated_by_user_id,
         users.email AS updated_by_email
       FROM system_settings
       LEFT JOIN users ON users.id = system_settings.updated_by_user_id
       WHERE system_settings.key = ?`
    )
    .get(key);

const setSystemSetting = (key, value, updatedByUserId = null) => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO system_settings (key, value, updated_at, updated_by_user_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at,
       updated_by_user_id = excluded.updated_by_user_id`
  ).run(key, value, now, updatedByUserId);
  return getSystemSetting(key);
};

const deleteSystemSetting = (key) =>
  db.prepare("DELETE FROM system_settings WHERE key = ?").run(key);

const UNIFIED_API_SETTING_KEY = "unified_api_key";

const getUnifiedApiSetting = () => {
  const setting = getSystemSetting(UNIFIED_API_SETTING_KEY);
  if (!setting) return null;
  return {
    setting_key: setting.key,
    setting_value: setting.value,
    updated_at: setting.updated_at,
    updated_by_user_id: setting.updated_by_user_id,
    updated_by_email: setting.updated_by_email,
  };
};

const upsertUnifiedApiSetting = (apiKey, updatedByUserId = null) => {
  const normalized = normalizeVoiceprintPayload(apiKey);
  if (!normalized) {
    deleteSystemSetting(UNIFIED_API_SETTING_KEY);
    return null;
  }
  const setting = setSystemSetting(UNIFIED_API_SETTING_KEY, normalized, updatedByUserId);
  return {
    setting_key: setting.key,
    setting_value: setting.value,
    updated_at: setting.updated_at,
    updated_by_user_id: setting.updated_by_user_id,
    updated_by_email: setting.updated_by_email,
  };
};

const listUsersForAdmin = () => listUsersWithStats();

const getVoiceprintByUserId = (userId) =>
  db
    .prepare(
      "SELECT id, voiceprint_vector, voiceprint_enabled FROM users WHERE id = ?"
    )
    .get(userId);

const setVoiceprintForUser = (userId, voiceprintVector) =>
  setUserVoiceprint(userId, voiceprintVector);

const clearVoiceprintForUser = (userId) => clearUserVoiceprint(userId);

module.exports = {
  createUser,
  getUserByEmail,
  getUserByAccount,
  getUserById,
  updateUserById,
  setUserRoleByEmail,
  setUserRoleByAccount,
  setUserVoiceprint,
  clearUserVoiceprint,
  setVoiceprintForUser,
  clearVoiceprintForUser,
  getVoiceprintByUserId,
  listUsersWithStats,
  listUsersForAdmin,
  createSession,
  getSessionByToken,
  deleteSessionByToken,
  createHistory,
  addHistoryImages,
  listHistory,
  countHistory,
  deleteHistoryByUser,
  getHistoryImage,
  getHistoryImageById,
  getSystemSetting,
  setSystemSetting,
  deleteSystemSetting,
  getUnifiedApiSetting,
  upsertUnifiedApiSetting,
};
