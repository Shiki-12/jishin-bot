import { getDb } from './db.js';

export const MOOD_LEVELS = {
  1: { score: 1, label: 'Sangat Buruk', emoji: '😢', bar: '█░░░░' },
  2: { score: 2, label: 'Buruk', emoji: '🙁', bar: '██░░░' },
  3: { score: 3, label: 'Biasa Saja', emoji: '😐', bar: '███░░' },
  4: { score: 4, label: 'Baik', emoji: '🙂', bar: '████░' },
  5: { score: 5, label: 'Sangat Baik', emoji: '😄', bar: '█████' },
};

export const CRISIS_KEYWORDS = [
  'bunuh diri',
  'suicide',
  'akhiri hidup',
  'mengakhiri hidup',
  'pengen mati',
  'mau mati',
  'menyakiti diri',
  'self harm',
  'potong nadi',
];

export function hasCrisisSigns(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return CRISIS_KEYWORDS.some((kw) => lower.includes(kw));
}

export function formatDateStr(timestamp, tz = 'Asia/Jakarta') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(timestamp);
  } catch {
    return new Date(timestamp).toISOString().slice(0, 10);
  }
}

export function recordMood({
  userId,
  score,
  note = null,
  tz = 'Asia/Jakarta',
  now = Date.now(),
  db = getDb(),
}) {
  const numScore = Number(score);
  if (!Number.isInteger(numScore) || numScore < 1 || numScore > 5) {
    throw new Error('Skor mood harus berupa angka bulat antara 1 sampai 5');
  }

  const cleanNote = note ? String(note).trim().slice(0, 500) : null;
  const dateStr = formatDateStr(now, tz);

  const stmt = db.prepare(`
    INSERT INTO moods (user_id, score, note, date_str, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = stmt.run(userId, numScore, cleanNote, dateStr, now);

  return db.prepare('SELECT * FROM moods WHERE id = ?').get(info.lastInsertRowid);
}

export function getTodayMood(userId, tz = 'Asia/Jakarta', now = Date.now(), db = getDb()) {
  const dateStr = formatDateStr(now, tz);
  return (
    db
      .prepare(
        'SELECT * FROM moods WHERE user_id = ? AND date_str = ? ORDER BY id DESC LIMIT 1',
      )
      .get(userId, dateStr) ?? null
  );
}

export function getUserMoodsLast7Days(userId, now = Date.now(), db = getDb()) {
  const sevenDaysAgo = now - 7 * 24 * 3600_000;
  return db
    .prepare(
      `SELECT * FROM moods
       WHERE user_id = ? AND created_at >= ?
       ORDER BY created_at ASC`,
    )
    .all(userId, sevenDaysAgo);
}

export function deleteMood(id, userId, db = getDb()) {
  const res = db
    .prepare('DELETE FROM moods WHERE id = ? AND user_id = ?')
    .run(id, userId);
  return res.changes > 0;
}

export function renderMoodWeekSummary(moods, tz = 'Asia/Jakarta') {
  if (!Array.isArray(moods) || moods.length === 0) {
    return null;
  }

  let totalScore = 0;
  const lines = moods.map((m) => {
    totalScore += m.score;
    const meta = MOOD_LEVELS[m.score] || { emoji: '😐', bar: '███░░', label: 'Biasa' };

    let dateLabel = m.date_str;
    try {
      dateLabel = new Intl.DateTimeFormat('id-ID', {
        timeZone: tz,
        day: '2-digit',
        month: 'short',
      }).format(m.created_at);
    } catch {}

    const notePart = m.note ? ` — _"${m.note}"_` : '';
    return `• *${dateLabel}:* [${meta.bar}] ${meta.emoji} (${m.score}/5)${notePart}`;
  });

  const avg = (totalScore / moods.length).toFixed(1);

  return (
    `📊 *Jurnal Mood 7 Hari Terakhir*\n\n` +
    `${lines.join('\n')}\n\n` +
    `📈 *Rata-rata:* *${avg}* / 5.0 (${moods.length} entri)\n\n` +
    `⚠️ _Catatan: Jurnal ini adalah catatan refleksi pribadi dan bukan pengganti diagnosis medis atau sesi terapi profesional._`
  );
}

