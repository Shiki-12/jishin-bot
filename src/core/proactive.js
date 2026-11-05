import { getDb } from './db.js';
import { getPersonality } from '../personalities/index.js';

/**
 * Validasi dan parse format jam tenang HH:mm-HH:mm.
 * Contoh: "22:00-07:00", "23:00 - 06:00".
 */
export function parseQuietHours(str) {
  if (!str || typeof str !== 'string') return null;
  const match = str.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)\s*-\s*([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;

  const pad = (n) => String(n).padStart(2, '0');
  const startH = pad(match[1]);
  const startM = pad(match[2]);
  const endH = pad(match[3]);
  const endM = pad(match[4]);

  return {
    quietStart: `${startH}:${startM}`,
    quietEnd: `${endH}:${endM}`,
  };
}

/**
 * Cek apakah waktu saat ini berada di dalam rentang jam tenang (quiet hours)
 * sesuai zona waktu user.
 */
export function isQuietTime(now = Date.now(), tz = 'Asia/Jakarta', quietStart = '22:00', quietEnd = '07:00') {
  if (!quietStart || !quietEnd) return false;
  if (quietStart === quietEnd) return false;

  let currentMinutes;
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.format(now).split(':');
    currentMinutes = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  } catch {
    const d = new Date(now);
    currentMinutes = d.getHours() * 60 + d.getMinutes();
  }

  const [sH, sM] = quietStart.split(':').map(Number);
  const [eH, eM] = quietEnd.split(':').map(Number);
  const startMinutes = sH * 60 + sM;
  const endMinutes = eH * 60 + eM;

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // Rentang melewati tengah malam (misal 22:00 s.d. 07:00)
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

/**
 * Ambil setelan proaktif user. Jika belum ada, kembalikan nilai default.
 */
export function getProactiveSettings(userId, db = getDb()) {
  const row = db.prepare('SELECT * FROM proactive_settings WHERE user_id = ?').get(userId);
  if (row) return row;

  return {
    user_id: userId,
    enabled: 0,
    quiet_start: '22:00',
    quiet_end: '07:00',
    min_idle_hours: 8,
    unreplied_count: 0,
    last_sent_at: 0,
    last_sent_date: null,
  };
}

/**
 * Aktifkan atau nonaktifkan chat proaktif untuk user.
 */
export function setProactiveEnabled(userId, enabled, db = getDb()) {
  const val = enabled ? 1 : 0;
  const now = Date.now();
  db.prepare(`
    INSERT INTO proactive_settings (user_id, enabled, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled
  `).run(userId, val, now);

  return getProactiveSettings(userId, db);
}

/**
 * Set jam tenang (quiet hours) untuk user.
 */
export function setQuietHours(userId, quietStart, quietEnd, db = getDb()) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO proactive_settings (user_id, quiet_start, quiet_end, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      quiet_start = excluded.quiet_start,
      quiet_end = excluded.quiet_end
  `).run(userId, quietStart, quietEnd, now);

  return getProactiveSettings(userId, db);
}

/**
 * Reset counter unreplied_count menjadi 0 saat user mengirim pesan baru.
 */
export function resetProactiveUnreplied(userId, db = getDb()) {
  if (!userId) return;
  db.prepare('UPDATE proactive_settings SET unreplied_count = 0 WHERE user_id = ?').run(userId);
}

/**
 * Dapatkan waktu aktivitas terakhir user (epoch ms).
 */
export function getLastUserActivity(userId, db = getDb()) {
  const row = db
    .prepare(
      `SELECT MAX(created_at) as last_activity FROM messages
       WHERE chat_id = ? AND role = 'user'`,
    )
    .get(userId);

  if (row?.last_activity) return row.last_activity;

  const userRow = db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId);
  return userRow?.created_at ?? 0;
}

/**
 * Susun pesan sapaan proaktif in-character yang merujuk fakta F-14 atau to-do F-11.
 */
export function buildProactiveMessage({ userId, persona, tz = 'Asia/Jakarta', now = Date.now(), db = getDb() }) {
  const p = persona ?? { strings: {} };

  // 1. Cek to-do pending
  let pendingTodo = null;
  try {
    pendingTodo = db
      .prepare('SELECT text FROM todos WHERE user_id = ? AND done = 0 ORDER BY id ASC LIMIT 1')
      .get(userId);
  } catch {}

  // 2. Cek fakta stabil tentang user
  let randomFact = null;
  try {
    const facts = db
      .prepare('SELECT fact FROM user_facts WHERE user_id = ? ORDER BY RANDOM() LIMIT 1')
      .all(userId);
    if (facts.length > 0) randomFact = facts[0].fact;
  } catch {}

  const greetings = p.strings?.proactiveGreetings ?? {};

  if (pendingTodo?.text && greetings.withTodo) {
    return greetings.withTodo.replace('{todo}', pendingTodo.text);
  }

  if (randomFact && greetings.withFact) {
    return greetings.withFact.replace('{fact}', randomFact);
  }

  if (Array.isArray(greetings.general) && greetings.general.length > 0) {
    const idx = Math.floor(Math.random() * greetings.general.length);
    return greetings.general[idx];
  }

  return 'Hei... seharian ini sepi banget. Cuma mau mastiin kamu baik-baik aja kok.';
}

/**
 * Proses batch pengiriman pesan proaktif ke user yang memenuhi kriteria.
 */
export async function processProactiveMessages(bot, now = Date.now(), db = getDb()) {
  const candidates = db
    .prepare(
      `SELECT p.*, COALESCE(u.tz, 'Asia/Jakarta') as tz, u.first_name
       FROM proactive_settings p
       JOIN users u ON p.user_id = u.id
       WHERE p.enabled = 1 AND p.unreplied_count < 3`,
    )
    .all();

  if (candidates.length === 0) return 0;

  let sentCount = 0;

  for (const row of candidates) {
    const tz = row.tz || 'Asia/Jakarta';

    // 1. Jangan kirim saat jam tenang
    if (isQuietTime(now, tz, row.quiet_start, row.quiet_end)) {
      continue;
    }

    // 2. Maksimal 1 pesan per hari di zona waktu user
    let todayDate;
    try {
      todayDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);
    } catch {
      todayDate = new Date(now).toISOString().slice(0, 10);
    }

    if (row.last_sent_date === todayDate) {
      continue;
    }

    // 3. User harus tidak aktif lebih dari min_idle_hours (default 8 jam)
    const minIdleMs = (row.min_idle_hours || 8) * 3600_000;
    const lastActivity = getLastUserActivity(row.user_id, db);
    if (now - lastActivity < minIdleMs) {
      continue;
    }

    // 4. Susun pesan proaktif in-character
    let persona;
    try {
      persona = getPersonality(process.env.PERSONALITY || 'tsundere');
    } catch {
      persona = { strings: {} };
    }

    const message = buildProactiveMessage({
      userId: row.user_id,
      persona,
      tz,
      now,
      db,
    });

    // 5. Kirim pesan ke user
    try {
      if (bot?.api?.sendMessage) {
        await bot.api.sendMessage(row.user_id, message);
      }

      db.prepare(
        `UPDATE proactive_settings
         SET last_sent_at = ?,
             last_sent_date = ?,
             unreplied_count = unreplied_count + 1
         WHERE user_id = ?`,
      ).run(now, todayDate, row.user_id);

      sentCount++;
    } catch (err) {
      console.error(`Gagal mengirim pesan proaktif ke user ${row.user_id}:`, err.message);

      const isBlocked =
        err.error_code === 403 ||
        err.description?.includes('blocked') ||
        err.description?.includes('chat not found') ||
        err.description?.includes('user is deactivated');

      if (isBlocked) {
        db.prepare(
          `UPDATE proactive_settings SET enabled = 0 WHERE user_id = ?`,
        ).run(row.user_id);
      }
    }
  }

  return sentCount;
}

