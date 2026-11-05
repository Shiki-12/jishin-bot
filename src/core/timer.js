/**
 * Core module untuk F-43: Timer dan Pomodoro.
 * Memanfaatkan tabel `reminders` (F-10) untuk persistensi penuh & tahan restart.
 */

import { getDb } from './db.js';
import { getZonedParts } from './time_parser.js';

/**
 * Parse string durasi menjadi milidetik.
 * Mendukung format: 25m, 10menit, 30s, 45detik, 2j, 1jam, 1j30m, atau angka polos (default menit).
 */
export function parseTimerDuration(str) {
  if (!str || typeof str !== 'string') {
    throw new Error('Durasi timer tidak boleh kosong.');
  }

  const clean = str.trim().toLowerCase();
  if (clean.includes('-')) {
    throw new Error('Durasi tidak boleh negatif.');
  }

  // Jika hanya angka polos, anggap menit (misal "25" -> 25 menit)
  if (/^\d+$/.test(clean)) {
    const mins = parseInt(clean, 10);
    if (mins <= 0) throw new Error('Durasi harus lebih dari 0.');
    if (mins > 24 * 60) throw new Error('Durasi timer maksimal 24 jam.');
    return mins * 60_000;
  }

  let totalMs = 0;
  const regex = /(\d+)\s*(jam|j|h|menit|m|min|detik|d|s|sec)/gi;
  let match;
  let matchFound = false;

  while ((match = regex.exec(clean)) !== null) {
    matchFound = true;
    const val = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    if (['jam', 'j', 'h'].includes(unit)) {
      totalMs += val * 3600_000;
    } else if (['menit', 'm', 'min'].includes(unit)) {
      totalMs += val * 60_000;
    } else if (['detik', 'd', 's', 'sec'].includes(unit)) {
      totalMs += val * 1000;
    }
  }

  if (!matchFound || totalMs <= 0) {
    throw new Error(
      `Format durasi '${str}' tidak valid. Gunakan format seperti: 25m, 30s, 1j 30m.`,
    );
  }

  // Batas wajar timer: maksimal 24 jam
  if (totalMs > 24 * 3600_000) {
    throw new Error('Durasi timer maksimal 24 jam.');
  }

  return totalMs;
}

/**
 * Format milidetik ke teks yang mudah dibaca dalam bahasa Indonesia.
 */
export function formatDuration(ms) {
  if (ms <= 0) return '0 detik';

  const totalSec = Math.round(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours} jam`);
  if (mins > 0) parts.push(`${mins} menit`);
  if (secs > 0 && hours === 0) parts.push(`${secs} detik`);

  return parts.join(' ') || '0 detik';
}

/**
 * Format epoch ms ke string waktu lokal HH:mm:ss.
 */
export function formatLocalTime(epochMs, tz = 'Asia/Jakarta') {
  const parts = getZonedParts(new Date(epochMs), tz);
  const hh = String(parts.hour).padStart(2, '0');
  const mm = String(parts.minute).padStart(2, '0');
  const ss = String(parts.second).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Buat timer sekali jalan menggunakan tabel `reminders` (F-10).
 */
export function createTimer({
  chatId,
  userId,
  durationMs,
  label = 'Waktu habis!',
  tz = 'Asia/Jakarta',
  now = Date.now(),
}) {
  const db = getDb();
  const dueAt = now + durationMs;
  const cleanLabel = (label || 'Waktu habis!').trim();
  const reminderText = `⏱️ *Timer Selesai:* ${cleanLabel}`;

  const res = db
    .prepare(
      `INSERT INTO reminders (chat_id, user_id, text, due_at, tz, repeat, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'timer', 'pending', ?)`,
    )
    .run(chatId, userId, reminderText, dueAt, tz, now);

  return {
    id: res.lastInsertRowid,
    chatId,
    userId,
    dueAt,
    durationMs,
    label: cleanLabel,
    text: reminderText,
    timeStr: formatLocalTime(dueAt, tz),
  };
}

/**
 * Ambil daftar timer yang sedang berjalan untuk chat/user.
 */
export function getActiveTimers(chatId, userId = null) {
  const db = getDb();
  let sql = `SELECT * FROM reminders WHERE chat_id = ? AND status = 'pending' AND repeat = 'timer'`;
  const params = [chatId];
  if (userId) {
    sql += ` AND user_id = ?`;
    params.push(userId);
  }
  sql += ` ORDER BY due_at ASC`;

  const rows = db.prepare(sql).all(...params);

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    label: r.text.replace(/^⏱️\s*\*Timer Selesai:\*\s*/, ''),
    dueAt: r.due_at,
    remainingMs: Math.max(0, r.due_at - Date.now()),
  }));
}

/**
 * Batalkan timer berdasarkan ID.
 */
export function cancelTimer(timerId, chatId, userId = null) {
  const db = getDb();
  let sql = `UPDATE reminders SET status = 'cancelled'
     WHERE id = ? AND chat_id = ? AND status = 'pending' AND repeat = 'timer'`;
  const params = [timerId, chatId];
  if (userId) {
    sql += ` AND user_id = ?`;
    params.push(userId);
  }
  const res = db.prepare(sql).run(...params);
  return res.changes > 0;
}

// ============================================================================
// POMODORO ENGINE (25/5 CYCLES VIA REMINDERS TABLE)
// ============================================================================

/**
 * Cek sesi Pomodoro yang sedang berjalan di chat saat ini.
 */
export function getActivePomodoro(chatId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM reminders
       WHERE chat_id = ? AND status = 'pending' AND repeat LIKE 'pomodoro:%'
       LIMIT 1`,
    )
    .get(chatId);

  if (!row) return null;

  // Format repeat: pomodoro:<phase>:<cycle>:<totalCycles>:<workMin>:<breakMin>
  const parts = row.repeat.split(':');
  return {
    id: row.id,
    chatId: row.chat_id,
    userId: row.user_id,
    phase: parts[1], // 'work' | 'break'
    cycle: parseInt(parts[2], 10),
    totalCycles: parseInt(parts[3], 10),
    workMin: parseInt(parts[4], 10),
    breakMin: parseInt(parts[5], 10),
    dueAt: row.due_at,
    remainingMs: Math.max(0, row.due_at - Date.now()),
  };
}

/**
 * Mulai sesi Pomodoro baru di chat.
 */
export function startPomodoro({
  chatId,
  userId,
  workMin = 25,
  breakMin = 5,
  cycles = 4,
  tz = 'Asia/Jakarta',
  now = Date.now(),
}) {
  const db = getDb();

  // Validasi parameter
  const w = parseInt(workMin, 10);
  const b = parseInt(breakMin, 10);
  const c = parseInt(cycles, 10);

  if (isNaN(w) || w < 1 || w > 180) {
    throw new Error('Durasi fokus (work) harus antara 1 sampai 180 menit.');
  }
  if (isNaN(b) || b < 1 || b > 60) {
    throw new Error('Durasi istirahat (break) harus antara 1 sampai 60 menit.');
  }
  if (isNaN(c) || c < 1 || c > 12) {
    throw new Error('Jumlah siklus Pomodoro harus antara 1 sampai 12 siklus.');
  }

  // Pastikan tidak ada pomodoro yang sedang aktif di chat ini
  const existing = getActivePomodoro(chatId);
  if (existing) {
    throw new Error(
      `Sesi Pomodoro sudah berjalan di chat ini (Siklus ${existing.cycle}/${existing.totalCycles}, tahap ${existing.phase === 'work' ? 'Fokus' : 'Istirahat'}). Ketik /stop untuk membatalkan terlebih dahulu.`,
    );
  }

  const durationMs = w * 60_000;
  const dueAt = now + durationMs;
  const repeatKey = `pomodoro:work:1:${c}:${w}:${b}`;
  const text =
    c === 1
      ? `🍅 *Waktu Fokus Selesai!* Siklus 1/1 selesai. 🎉 *Sesi Pomodoro Selesai!* Hebat! Kamu telah menyelesaikan seluruh 1 siklus fokus. Istirahatlah yang cukup! ✨`
      : `🍅 *Waktu Fokus Selesai!* Siklus 1/${c} selesai. Waktunya istirahat ${b} menit. ☕`;

  const res = db
    .prepare(
      `INSERT INTO reminders (chat_id, user_id, text, due_at, tz, repeat, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(chatId, userId, text, dueAt, tz, repeatKey, now);

  return {
    id: res.lastInsertRowid,
    chatId,
    userId,
    cycle: 1,
    totalCycles: c,
    workMin: w,
    breakMin: b,
    dueAt,
    timeStr: formatLocalTime(dueAt, tz),
  };
}

/**
 * Hentikan sesi Pomodoro yang aktif.
 */
export function stopPomodoro(chatId) {
  const db = getDb();
  const res = db
    .prepare(
      `UPDATE reminders SET status = 'cancelled'
       WHERE chat_id = ? AND status = 'pending' AND repeat LIKE 'pomodoro:%'`,
    )
    .run(chatId);

  return res.changes > 0;
}

/**
 * Lanjutkan siklus Pomodoro ke tahap berikutnya saat pengingat jatuh tempo.
 * Dipanggil oleh scheduler loop di F-10.
 */
export function advancePomodoro(reminder, now = Date.now()) {
  if (!reminder?.repeat || !reminder.repeat.startsWith('pomodoro:')) {
    return null;
  }

  const db = getDb();
  const parts = reminder.repeat.split(':');
  const phase = parts[1]; // 'work' | 'break'
  const cycle = parseInt(parts[2], 10);
  const totalCycles = parseInt(parts[3], 10);
  const workMin = parseInt(parts[4], 10);
  const breakMin = parseInt(parts[5], 10);

  if (phase === 'work') {
    // Jika fase fokus selesai dan masih ada siklus berikutnya -> Mulai fase istirahat
    if (cycle < totalCycles) {
      const nextDue = now + breakMin * 60_000;
      const nextCycle = cycle + 1;
      const nextRepeat = `pomodoro:break:${nextCycle}:${totalCycles}:${workMin}:${breakMin}`;
      const nextText = `☕ *Waktu Istirahat Selesai!* Waktunya kembali fokus untuk Siklus ${nextCycle}/${totalCycles} (${workMin} menit). 💪`;

      const res = db
        .prepare(
          `INSERT INTO reminders (chat_id, user_id, text, due_at, tz, repeat, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .run(reminder.chat_id, reminder.user_id, nextText, nextDue, reminder.tz, nextRepeat, now);

      return {
        nextPhase: 'break',
        nextCycle,
        nextDue,
        reminderId: res.lastInsertRowid,
      };
    }

    // Seluruh siklus selesai
    return {
      nextPhase: 'finished',
      cycle: totalCycles,
    };
  }

  if (phase === 'break') {
    // Fase istirahat selesai -> Mulai siklus fokus berikutnya
    const nextDue = now + workMin * 60_000;
    const nextRepeat = `pomodoro:work:${cycle}:${totalCycles}:${workMin}:${breakMin}`;
    const isLast = cycle === totalCycles;
    const nextText = isLast
      ? `🍅 *Waktu Fokus Selesai!* Siklus ${cycle}/${totalCycles} selesai. 🎉 *Sesi Pomodoro Selesai!* Hebat! Kamu telah menyelesaikan seluruh ${totalCycles} siklus fokus hari ini. Istirahatlah yang cukup! ✨`
      : `🍅 *Waktu Fokus Selesai!* Siklus ${cycle}/${totalCycles} selesai. Waktunya istirahat ${breakMin} menit. ☕`;

    const res = db
      .prepare(
        `INSERT INTO reminders (chat_id, user_id, text, due_at, tz, repeat, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(reminder.chat_id, reminder.user_id, nextText, nextDue, reminder.tz, nextRepeat, now);

    return {
      nextPhase: 'work',
      cycle,
      nextDue,
      reminderId: res.lastInsertRowid,
    };
  }

  return null;
}
