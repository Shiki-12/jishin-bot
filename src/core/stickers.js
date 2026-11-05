import { getDb } from './db.js';

export const ALLOWED_MOODS = [
  'senang',
  'kesal',
  'malu',
  'sedih',
  'bingung',
  'kaget',
  'semangat',
  'lelah',
];

export function isValidMood(mood) {
  if (!mood || typeof mood !== 'string') return false;
  return ALLOWED_MOODS.includes(mood.trim().toLowerCase());
}

export function normalizeMood(mood) {
  if (!mood || typeof mood !== 'string') return null;
  const clean = mood.trim().toLowerCase();
  return ALLOWED_MOODS.includes(clean) ? clean : null;
}

export function addSticker({
  fileId,
  mood,
  setName = null,
  emoji = null,
  db = getDb(),
}) {
  if (!fileId || typeof fileId !== 'string') {
    throw new Error('fileId wajib diisi');
  }
  const cleanMood = normalizeMood(mood);
  if (!cleanMood) {
    throw new Error(`Mood tidak valid: ${mood}. Pilihan: ${ALLOWED_MOODS.join(', ')}`);
  }

  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO stickers (file_id, mood, set_name, emoji, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(file_id) DO UPDATE SET
      mood = excluded.mood,
      set_name = excluded.set_name,
      emoji = excluded.emoji
  `);
  stmt.run(fileId, cleanMood, setName, emoji, now);

  const row = db.prepare('SELECT * FROM stickers WHERE file_id = ?').get(fileId);
  return row;
}

export function deleteSticker(id, db = getDb()) {
  const numId = Number(id);
  if (isNaN(numId)) return false;
  const info = db.prepare('DELETE FROM stickers WHERE id = ?').run(numId);
  return info.changes > 0;
}

export function getStickerById(id, db = getDb()) {
  const numId = Number(id);
  if (isNaN(numId)) return null;
  return db.prepare('SELECT * FROM stickers WHERE id = ?').get(numId) ?? null;
}

export function getStickerByFileId(fileId, db = getDb()) {
  if (!fileId) return null;
  return db.prepare('SELECT * FROM stickers WHERE file_id = ?').get(fileId) ?? null;
}

export function getRandomStickerByMood(mood, db = getDb()) {
  const cleanMood = normalizeMood(mood);
  if (!cleanMood) return null;
  return (
    db
      .prepare('SELECT * FROM stickers WHERE mood = ? ORDER BY RANDOM() LIMIT 1')
      .get(cleanMood) ?? null
  );
}

export function getStickersCountByMood(db = getDb()) {
  const rows = db
    .prepare('SELECT mood, COUNT(*) as count FROM stickers GROUP BY mood')
    .all();
  const countMap = new Map(rows.map((r) => [r.mood, r.count]));
  return ALLOWED_MOODS.map((m) => ({
    mood: m,
    count: countMap.get(m) ?? 0,
  }));
}

export function getAllStickers(db = getDb()) {
  return db.prepare('SELECT * FROM stickers ORDER BY id DESC').all();
}

export function getTotalStickersCount(db = getDb()) {
  return db.prepare('SELECT COUNT(*) as total FROM stickers').get()?.total ?? 0;
}

// --- Mode Admin /addsticker --------------------------------------------------
const adminModes = new Map(); // userId -> { mood: string, startedAt: number }

export function setAdminAddStickerMode(userId, mood) {
  const cleanMood = normalizeMood(mood);
  if (!cleanMood) throw new Error('Mood tidak valid');
  adminModes.set(userId, { mood: cleanMood, startedAt: Date.now() });
}

export function getAdminAddStickerMode(userId) {
  if (!userId) return null;
  const mode = adminModes.get(userId);
  if (!mode) return null;
  // TTL 15 menit
  if (Date.now() - mode.startedAt > 15 * 60 * 1000) {
    adminModes.delete(userId);
    return null;
  }
  return mode;
}

export function clearAdminAddStickerMode(userId) {
  if (userId) {
    adminModes.delete(userId);
  } else {
    adminModes.clear();
  }
}

