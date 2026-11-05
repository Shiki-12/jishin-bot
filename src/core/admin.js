import { getDb } from './db.js';
import { isAdmin } from './guards.js';
import { getUsageStats } from './usage.js';

// Cache in-memory untuk pending broadcast confirmation
const pendingBroadcasts = new Map();

/**
 * Catat tindakan admin ke tabel admin_log.
 * @param {object} params
 * @param {number} params.adminId
 * @param {string} params.action
 * @param {string} [params.details]
 */
export function logAdminAction({ adminId, action, details = '' }) {
  const db = getDb();
  db.prepare(
    `INSERT INTO admin_log (admin_id, action, details, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(adminId, action, String(details).slice(0, 1000), Date.now());
}

/**
 * Blokir (ban) user dari bot.
 * @param {object} params
 * @param {number} params.userId
 * @param {string} [params.reason]
 * @param {number} params.adminId
 */
export function banUser({ userId, reason = 'Melanggar aturan', adminId }) {
  if (isAdmin(userId)) {
    throw new Error('CANNOT_BAN_ADMIN');
  }

  const db = getDb();
  const cleanReason = (reason || 'Melanggar aturan').trim().slice(0, 200);

  db.prepare(
    `INSERT INTO banned_users (user_id, reason, banned_at, banned_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       reason = excluded.reason,
       banned_at = excluded.banned_at,
       banned_by = excluded.banned_by`,
  ).run(userId, cleanReason, Date.now(), adminId);

  logAdminAction({
    adminId,
    action: 'ban',
    details: `User: ${userId}, Alasan: ${cleanReason}`,
  });
}

/**
 * Buka blokir (unban) user.
 * @param {object} params
 * @param {number} params.userId
 * @param {number} params.adminId
 * @returns {boolean}
 */
export function unbanUser({ userId, adminId }) {
  const db = getDb();
  const res = db.prepare('DELETE FROM banned_users WHERE user_id = ?').run(userId);

  if (res.changes > 0) {
    logAdminAction({
      adminId,
      action: 'unban',
      details: `User: ${userId}`,
    });
    return true;
  }
  return false;
}

/**
 * Cek apakah user sedang diblokir.
 * @param {number} userId
 * @returns {boolean}
 */
export function isUserBanned(userId) {
  if (!userId) return false;
  try {
    const db = getDb();
    const row = db
      .prepare('SELECT user_id FROM banned_users WHERE user_id = ?')
      .get(userId);
    return Boolean(row);
  } catch {
    return false;
  }
}

/**
 * Ambil daftar semua user yang sedang diban.
 * @returns {Array<{ user_id: number, reason: string, banned_at: number, banned_by: number }>}
 */
export function listBannedUsers() {
  const db = getDb();
  return db
    .prepare('SELECT * FROM banned_users ORDER BY banned_at DESC')
    .all();
}

/**
 * Ambil nilai konfigurasi dinamis bot dari tabel bot_state.
 * @param {string} key
 * @param {string|null} [fallback=null]
 * @returns {string|null}
 */
export function getBotState(key, fallback = null) {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM bot_state WHERE key = ?').get(key);
    return row ? row.value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Simpan atau perbarui nilai konfigurasi bot di bot_state.
 * @param {string} key
 * @param {string} value
 */
export function setBotState(key, value) {
  const db = getDb();
  db.prepare(
    `INSERT INTO bot_state (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  ).run(key, String(value), Date.now());
}

/**
 * Cek apakah bot sedang dalam mode pemeliharaan (maintenance).
 * @returns {boolean}
 */
export function isMaintenanceMode() {
  const val = getBotState('maintenance', '0');
  return val === '1' || val === 'on' || val === 'true';
}

/**
 * Atur status mode maintenance bot.
 * @param {boolean} enabled
 * @param {number} adminId
 */
export function setMaintenanceMode(enabled, adminId) {
  const val = enabled ? '1' : '0';
  setBotState('maintenance', val);
  logAdminAction({
    adminId,
    action: 'maintenance',
    details: enabled ? 'Maintenance diaktifkan (ON)' : 'Maintenance dimatikan (OFF)',
  });
}

/**
 * Ambil model LLM yang sedang aktif (dinamis via /model atau env LLM_MODEL).
 * @returns {string}
 */
export function getActiveModel() {
  const dynamicModel = getBotState('active_model');
  if (dynamicModel && dynamicModel.trim()) {
    return dynamicModel.trim();
  }
  return process.env.LLM_MODEL || 'mistralai/mistral-large-2512';
}

/**
 * Ubah model LLM aktif sementara tanpa perlu restart bot.
 * @param {string} modelName
 * @param {number} adminId
 */
export function setActiveModel(modelName, adminId) {
  const cleanName = (modelName || '').trim();
  if (!cleanName) {
    throw new Error('MODEL_NAME_EMPTY');
  }

  setBotState('active_model', cleanName);
  logAdminAction({
    adminId,
    action: 'model',
    details: `Model diganti ke: ${cleanName}`,
  });
  return cleanName;
}

/**
 * Ambil statistik operasional bot lengkap untuk perintah /stats.
 * @param {number} [now]
 * @returns {object}
 */
export function getAdminStats(now = Date.now()) {
  const db = getDb();

  // Hitung awal hari ini (00:00:00 lokal WIB / default UTC)
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  const startOfDay = d.getTime();

  const totalUsers =
    db.prepare('SELECT count(*) as c FROM users WHERE id > 0').get()?.c ?? 0;
  const totalChats =
    db.prepare('SELECT count(*) as c FROM chats').get()?.c ?? 0;

  const activeUsersToday =
    db
      .prepare('SELECT count(DISTINCT chat_id) as c FROM messages WHERE created_at >= ?')
      .get(startOfDay)?.c ?? 0;

  const messagesToday =
    db
      .prepare('SELECT count(*) as c FROM messages WHERE created_at >= ?')
      .get(startOfDay)?.c ?? 0;

  const pendingReminders =
    db
      .prepare(`SELECT count(*) as c FROM reminders WHERE status = 'pending'`)
      .get()?.c ?? 0;

  const bannedCount =
    db.prepare('SELECT count(*) as c FROM banned_users').get()?.c ?? 0;

  let factsCount = 0;
  try {
    factsCount = db.prepare('SELECT count(*) as c FROM user_facts').get()?.c ?? 0;
  } catch {}

  let expensesCount = 0;
  let expensesTotal = 0;
  try {
    const expRow = db.prepare('SELECT count(*) as c, sum(amount) as s FROM expenses').get();
    expensesCount = expRow?.c ?? 0;
    expensesTotal = expRow?.s ?? 0;
  } catch {}

  let usageToday = { totalTokens: 0, totalPrompt: 0, totalCompletion: 0, avgLatencyMs: 0, models: [] };
  try {
    usageToday = getUsageStats();
  } catch {}

  return {
    totalUsers,
    totalChats,
    activeUsersToday,
    messagesToday,
    pendingReminders,
    bannedCount,
    factsCount,
    expensesCount,
    expensesTotal,
    tokensToday: usageToday.totalTokens,
    promptTokensToday: usageToday.totalPrompt,
    completionTokensToday: usageToday.totalCompletion,
    avgLatencyMs: usageToday.avgLatencyMs,
    usageByModel: usageToday.models,
    activeModel: getActiveModel(),
    isMaintenance: isMaintenanceMode(),
  };
}

/**
 * Buat antrian konfirmasi siaran pesan broadcast.
 * @param {object} params
 * @param {number} params.adminId
 * @param {string} params.text
 * @param {number} params.targetCount
 * @returns {string}
 */
export function createPendingBroadcast({ adminId, text, targetCount }) {
  const id = `bc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  pendingBroadcasts.set(id, {
    id,
    adminId,
    text,
    targetCount,
    createdAt: Date.now(),
  });
  return id;
}

/**
 * Ambil data pending broadcast berdasarkan ID.
 * @param {string} id
 * @returns {object|null}
 */
export function getPendingBroadcast(id) {
  return pendingBroadcasts.get(id) || null;
}

/**
 * Hapus pending broadcast.
 * @param {string} id
 */
export function deletePendingBroadcast(id) {
  pendingBroadcasts.delete(id);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Eksekusi pengiriman broadcast ke seluruh pengguna terdaftar dengan throttling jeda.
 * @param {object} params
 * @param {object} params.bot
 * @param {string} params.text
 * @param {number} [params.delayMs=50]
 * @returns {Promise<{ total: number, successCount: number, failCount: number }>}
 */
export async function executeBroadcast({ bot, text, delayMs = 50 }) {
  const db = getDb();
  const users = db.prepare('SELECT id FROM users WHERE id > 0').all();

  let successCount = 0;
  let failCount = 0;

  for (const user of users) {
    try {
      if (bot?.api?.sendMessage) {
        await bot.api.sendMessage(user.id, text);
      }
      successCount++;
    } catch (err) {
      failCount++;
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return {
    total: users.length,
    successCount,
    failCount,
  };
}

