/**
 * Core module untuk F-44: Habit Tracker dan Streak Harian.
 */

import { getDb } from './db.js';
import { getZonedParts } from './time_parser.js';
import { InlineKeyboard } from 'grammy';

/**
 * Konversi tanggal lokal user (YYYY-MM-DD) dan waktu saat ini (HH:mm).
 */
export function getZonedDateAndMinutes(date = new Date(), tz = 'Asia/Jakarta') {
  const parts = getZonedParts(date instanceof Date ? date : new Date(date), tz);
  const yyyy = String(parts.year);
  const mm = String(parts.month).padStart(2, '0');
  const dd = String(parts.day).padStart(2, '0');
  const hh = String(parts.hour).padStart(2, '0');
  const min = String(parts.minute).padStart(2, '0');
  return {
    dateStr: `${yyyy}-${mm}-${dd}`,
    timeStr: `${hh}:${min}`,
  };
}

/**
 * Konversi string YYYY-MM-DD ke nomor hari integer murni UTC.
 */
export function dateStrToEpochDay(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * Parse argumen input untuk membuat kebiasaan baru.
 * Mendukung format: "Baca buku 21:00", "Minum air 2 liter 07.30", "Olahraga pagi"
 */
export function parseHabitArgs(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Nama kebiasaan tidak boleh kosong.');
  }

  const clean = raw.trim();
  if (!clean) {
    throw new Error('Nama kebiasaan tidak boleh kosong.');
  }

  // Cek apakah ada format jam di akhir string: 08:00 atau 08.00
  const timeRegex = /(?:\s+|^)([01]?\d|2[0-3])[:.]([0-5]\d)$/;
  const match = timeRegex.exec(clean);

  let remindTime = null;
  let name = clean;

  if (match) {
    const hh = match[1].padStart(2, '0');
    const mm = match[2];
    remindTime = `${hh}:${mm}`;
    name = clean.slice(0, match.index).trim();
  }

  if (!name) {
    throw new Error('Nama kebiasaan tidak boleh kosong.');
  }

  if (name.length > 100) {
    throw new Error('Nama kebiasaan maksimal 100 karakter.');
  }

  return { name, remindTime };
}

/**
 * Tambah kebiasaan baru untuk user.
 */
export function addHabit({ userId, name, remindTime = null, now = Date.now() }) {
  if (!userId) throw new Error('User ID diperlukan.');
  const parsed = parseHabitArgs(remindTime ? `${name} ${remindTime}` : name);

  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO habits (user_id, name, remind_time, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(userId, parsed.name, parsed.remindTime, now);

  return {
    id: res.lastInsertRowid,
    userId,
    name: parsed.name,
    remindTime: parsed.remindTime,
    createdAt: now,
  };
}

/**
 * Hapus kebiasaan berdasarkan ID.
 */
export function deleteHabit(habitId, userId) {
  const db = getDb();
  const res = db
    .prepare(`DELETE FROM habits WHERE id = ? AND user_id = ?`)
    .run(habitId, userId);

  if (res.changes > 0) {
    db.prepare(`DELETE FROM habit_logs WHERE habit_id = ?`).run(habitId);
    return true;
  }
  return false;
}

/**
 * Ambil satu kebiasaan berdasarkan ID.
 */
export function getHabitById(habitId, userId = null) {
  const db = getDb();
  if (userId) {
    return (
      db
        .prepare(`SELECT * FROM habits WHERE id = ? AND user_id = ?`)
        .get(habitId, userId) || null
    );
  }
  return db.prepare(`SELECT * FROM habits WHERE id = ?`).get(habitId) || null;
}

/**
 * Hitung streak saat ini (current) dan rekor terpanjang (longest).
 * Streak putus jika ada 1 hari kemarin terlewat.
 */
export function calculateStreaks(habitId, todayDateStr) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT date FROM habit_logs
       WHERE habit_id = ? AND status = 'done'
       ORDER BY date ASC`,
    )
    .all(habitId);

  if (rows.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  // Ubah ke array hari numerik UTC yang unik dan urut
  const doneDays = Array.from(
    new Set(rows.map((r) => dateStrToEpochDay(r.date)).filter((d) => d !== null)),
  ).sort((a, b) => a - b);

  if (doneDays.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  // 1. Hitung longest streak (rekor berurutan terpanjang sepanjang waktu)
  let longestStreak = 1;
  let runningStreak = 1;

  for (let i = 1; i < doneDays.length; i++) {
    if (doneDays[i] === doneDays[i - 1] + 1) {
      runningStreak++;
      if (runningStreak > longestStreak) {
        longestStreak = runningStreak;
      }
    } else {
      runningStreak = 1;
    }
  }

  // 2. Hitung current streak relatif terhadap todayDateStr
  const todayDay = dateStrToEpochDay(todayDateStr);
  const doneSet = new Set(doneDays);

  let currentStreak = 0;
  let checkDay = todayDay;

  // Jika hari ini belum dicatat sebagai 'done', periksa apakah kemarin 'done'
  if (!doneSet.has(checkDay)) {
    checkDay = todayDay - 1;
  }

  // Hitung mundur hari-hari berturut-turut yang selesai
  while (doneSet.has(checkDay)) {
    currentStreak++;
    checkDay--;
  }

  return {
    currentStreak,
    longestStreak: Math.max(longestStreak, currentStreak),
  };
}

/**
 * Catat status kebiasaan untuk tanggal tertentu ('done' atau 'skipped').
 */
export function logHabit({
  habitId,
  userId,
  dateStr,
  status = 'done',
  now = Date.now(),
}) {
  const db = getDb();
  const habit = getHabitById(habitId, userId);
  if (!habit) {
    throw new Error(`Kebiasaan #${habitId} tidak ditemukan.`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error('Format tanggal harus YYYY-MM-DD.');
  }

  if (!['done', 'skipped'].includes(status)) {
    throw new Error("Status harus 'done' atau 'skipped'.");
  }

  db.prepare(
    `INSERT INTO habit_logs (habit_id, date, status, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(habit_id, date) DO UPDATE SET
       status = excluded.status,
       created_at = excluded.created_at`,
  ).run(habitId, dateStr, status, now);

  const streaks = calculateStreaks(habitId, dateStr);

  return {
    habit,
    dateStr,
    status,
    currentStreak: streaks.currentStreak,
    longestStreak: streaks.longestStreak,
  };
}

/**
 * Ambil daftar semua kebiasaan milik user beserta status hari ini dan streak.
 */
export function getUserHabitsWithStatus(userId, tz = 'Asia/Jakarta', now = new Date()) {
  const db = getDb();
  const habits = db
    .prepare(`SELECT * FROM habits WHERE user_id = ? ORDER BY id ASC`)
    .all(userId);

  const { dateStr: todayStr } = getZonedDateAndMinutes(now, tz);

  return habits.map((h) => {
    const todayLog = db
      .prepare(`SELECT status FROM habit_logs WHERE habit_id = ? AND date = ?`)
      .get(h.id, todayStr);

    const streaks = calculateStreaks(h.id, todayStr);

    return {
      id: h.id,
      name: h.name,
      remindTime: h.remind_time,
      todayStatus: todayLog ? todayLog.status : 'pending',
      currentStreak: streaks.currentStreak,
      longestStreak: streaks.longestStreak,
    };
  });
}

/**
 * Scheduler loop handler untuk mengirim pengingat kebiasaan.
 */
export async function processHabitReminders(bot, now = Date.now()) {
  const db = getDb();

  // Ambil semua habit yang memiliki waktu pengingat
  const habits = db
    .prepare(
      `SELECT h.*, COALESCE(u.tz, 'Asia/Jakarta') as tz
       FROM habits h
       LEFT JOIN users u ON h.user_id = u.id
       WHERE h.remind_time IS NOT NULL`,
    )
    .all();

  if (habits.length === 0) return 0;

  let sentCount = 0;

  for (const habit of habits) {
    const { dateStr, timeStr } = getZonedDateAndMinutes(now, habit.tz);

    // Cek apakah waktu saat ini sudah mencapai/melewati remind_time dan belum diingatkan hari ini
    if (timeStr >= habit.remind_time && habit.last_remind_date !== dateStr) {
      // Periksa apakah user sudah mencatat kebiasaan ini hari ini
      const alreadyLogged = db
        .prepare(`SELECT status FROM habit_logs WHERE habit_id = ? AND date = ?`)
        .get(habit.id, dateStr);

      if (alreadyLogged) {
        // Tandai sudah diingatkan tanpa mengirim pesan
        db.prepare(`UPDATE habits SET last_remind_date = ? WHERE id = ?`).run(
          dateStr,
          habit.id,
        );
        continue;
      }

      const streaks = calculateStreaks(habit.id, dateStr);
      const streakInfo =
        streaks.currentStreak > 0
          ? ` (🔥 Streak saat ini: ${streaks.currentStreak} hari)`
          : '';

      const text =
        `📋 *Pengingat Kebiasaan:*\n` +
        `Saatnya untuk: *${habit.name}*${streakInfo}!\n` +
        `Sudahkah kamu melakukannya hari ini?`;

      const keyboard = new InlineKeyboard()
        .text('✅ Sudah', `hbt:done:${habit.id}:${dateStr}`)
        .text('⏭️ Lewat', `hbt:skip:${habit.id}:${dateStr}`);

      try {
        if (bot?.api?.sendMessage) {
          await bot.api.sendMessage(habit.user_id, text, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        }

        db.prepare(`UPDATE habits SET last_remind_date = ? WHERE id = ?`).run(
          dateStr,
          habit.id,
        );
        sentCount++;
      } catch (err) {
        console.error(
          `Gagal mengirim pengingat habit #${habit.id} ke user ${habit.user_id}:`,
          err.message,
        );
      }
    }
  }

  return sentCount;
}

