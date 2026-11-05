import { getDb } from './db.js';
import { logger } from './logger.js';
import { getAdminIds } from './guards.js';

let currentAlertDate = '';
const alertedUsersToday = new Set();

/**
 * Dapatkan string tanggal saat ini (YYYY-MM-DD).
 */
export function getTodayDateStr() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Catat pemakaian token dan latensi panggilan LLM ke database.
 * @param {object} params
 * @param {number} params.userId
 * @param {number} [params.promptTokens]
 * @param {number} [params.completionTokens]
 * @param {number} [params.totalTokens]
 * @param {number} [params.latencyMs]
 * @param {string} [params.model]
 * @param {string} [params.dateStr]
 * @returns {{ id: number, userId: number, totalTokens: number, latencyMs: number, model: string, userTotalToday: number, limitExceeded: boolean, limit: number }}
 */
export function recordUsage({
  userId,
  promptTokens = 0,
  completionTokens = 0,
  totalTokens = 0,
  latencyMs = 0,
  model = 'unknown',
  dateStr = null,
}) {
  const db = getDb();
  const date = dateStr || getTodayDateStr();
  const finalTotal = totalTokens || promptTokens + completionTokens;
  const now = Date.now();

  const info = db
    .prepare(
      `INSERT INTO usage (user_id, date_str, prompt_tokens, completion_tokens, total_tokens, latency_ms, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, date, promptTokens, completionTokens, finalTotal, latencyMs, model, now);

  // Hitung total pemakaian user hari ini
  const userTotalRow = db
    .prepare('SELECT sum(total_tokens) as total FROM usage WHERE user_id = ? AND date_str = ?')
    .get(userId, date);
  const userTotalToday = userTotalRow?.total ?? finalTotal;

  const dailyLimit = Number(process.env.DAILY_TOKEN_LIMIT || 0);
  const limitExceeded = dailyLimit > 0 && userTotalToday >= dailyLimit;

  return {
    id: Number(info.lastInsertRowid),
    userId,
    totalTokens: finalTotal,
    latencyMs,
    model,
    userTotalToday,
    limitExceeded,
    limit: dailyLimit,
  };
}

/**
 * Dapatkan statistik agregat pemakaian token.
 * @param {string} [dateStr] Opsional: tanggal tertentu (default: hari ini). Kirim 'all' untuk seluruh waktu.
 */
export function getUsageStats(dateStr = null) {
  const db = getDb();
  const isAll = dateStr === 'all';
  const targetDate = isAll ? null : (dateStr || getTodayDateStr());

  const aggregateQuery = targetDate
    ? `SELECT count(*) as totalCalls,
              coalesce(sum(prompt_tokens), 0) as totalPrompt,
              coalesce(sum(completion_tokens), 0) as totalCompletion,
              coalesce(sum(total_tokens), 0) as totalTokens,
              coalesce(round(avg(latency_ms)), 0) as avgLatency
       FROM usage WHERE date_str = ?`
    : `SELECT count(*) as totalCalls,
              coalesce(sum(prompt_tokens), 0) as totalPrompt,
              coalesce(sum(completion_tokens), 0) as totalCompletion,
              coalesce(sum(total_tokens), 0) as totalTokens,
              coalesce(round(avg(latency_ms)), 0) as avgLatency
       FROM usage`;

  const agg = targetDate
    ? db.prepare(aggregateQuery).get(targetDate)
    : db.prepare(aggregateQuery).get();

  const modelQuery = targetDate
    ? `SELECT model, coalesce(sum(total_tokens), 0) as tokens, count(*) as calls
       FROM usage WHERE date_str = ?
       GROUP BY model ORDER BY tokens DESC`
    : `SELECT model, coalesce(sum(total_tokens), 0) as tokens, count(*) as calls
       FROM usage
       GROUP BY model ORDER BY tokens DESC`;

  const models = targetDate
    ? db.prepare(modelQuery).all(targetDate)
    : db.prepare(modelQuery).all();

  return {
    date: targetDate || 'all',
    totalCalls: agg?.totalCalls ?? 0,
    totalPrompt: agg?.totalPrompt ?? 0,
    totalCompletion: agg?.totalCompletion ?? 0,
    totalTokens: agg?.totalTokens ?? 0,
    avgLatencyMs: Number(agg?.avgLatency ?? 0),
    models,
  };
}

/**
 * Dapatkan total konsumsi token user tertentu hari ini.
 * @param {number} userId
 * @param {string} [dateStr]
 */
export function getUserUsageToday(userId, dateStr = null) {
  const db = getDb();
  const date = dateStr || getTodayDateStr();

  const row = db
    .prepare(
      `SELECT count(*) as calls,
              coalesce(sum(prompt_tokens), 0) as promptTokens,
              coalesce(sum(completion_tokens), 0) as completionTokens,
              coalesce(sum(total_tokens), 0) as totalTokens
       FROM usage WHERE user_id = ? AND date_str = ?`,
    )
    .get(userId, date);

  return {
    calls: row?.calls ?? 0,
    promptTokens: row?.promptTokens ?? 0,
    completionTokens: row?.completionTokens ?? 0,
    totalTokens: row?.totalTokens ?? 0,
  };
}

/**
 * Periksa batas token harian dan kirim peringatan ke admin jika terlampaui.
 * Hanya mengirim satu kali peringatan per user per hari agar tidak spam.
 * @param {object} params
 * @param {object} params.bot Instance grammY bot
 * @param {number} params.userId ID user
 * @param {number} params.userTotalToday Total token hari ini
 * @param {number} params.limit Batas limit token harian
 */
export async function checkAndAlertTokenLimit({ bot, userId, userTotalToday, limit }) {
  if (!limit || limit <= 0 || userTotalToday < limit) return;

  const today = getTodayDateStr();
  if (currentAlertDate !== today) {
    currentAlertDate = today;
    alertedUsersToday.clear();
  }

  if (alertedUsersToday.has(userId)) {
    return; // Sudah diperingatkan hari ini
  }

  alertedUsersToday.add(userId);

  const warnMsg = `⚠️ *Peringatan Kuota Token LLM!*\nPengguna ID \`${userId}\` telah menghabiskan *${userTotalToday.toLocaleString('id-ID')} token* hari ini (batas harian: ${limit.toLocaleString('id-ID')} token).`;

  logger.warn('Token limit exceeded by user', { userId, userTotalToday, limit });

  if (bot?.api?.sendMessage) {
    const adminIds = getAdminIds();
    for (const adminId of adminIds) {
      try {
        await bot.api.sendMessage(adminId, warnMsg, { parse_mode: 'Markdown' });
      } catch (err) {
        logger.error('Failed to send token limit alert to admin', { adminId, error: err.message });
      }
    }
  }
}

