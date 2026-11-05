import { getDb } from './db.js';
import { getZonedParts } from './time_parser.js';

export const DAILY_POINTS_CAP = 15;
export const POINTS_PER_INTERACTION = 2;

export const AFFINITY_LEVELS = [
  {
    level: 0,
    title: 'Jutek banget',
    minPoints: 0,
    nextThreshold: 20,
    promptInstruction:
      'Level 0 (Jutek banget): Sangat defensif, dingin, ketus, dan menjaga jarak. Bicara seperlunya dan anggap user sebagai orang asing yang mengganggu.',
  },
  {
    level: 1,
    title: 'Gengsian',
    minPoints: 20,
    nextThreshold: 50,
    promptInstruction:
      'Level 1 (Gengsian): Mulai terbiasa dengan user. Suka mengelak dan menyangkal dengan gengsi tinggi, tapi tetap melayani percakapan.',
  },
  {
    level: 2,
    title: 'Mulai luluh',
    minPoints: 50,
    nextThreshold: 100,
    promptInstruction:
      'Level 2 (Mulai luluh): Mulai peduli secara tersirat. Masih menyangkal ("bukan berarti aku peduli ya!"), tapi nada bicara terasa lebih hangat dan bersahabat.',
  },
  {
    level: 3,
    title: 'Malu-malu perhatian',
    minPoints: 100,
    nextThreshold: 200,
    promptInstruction:
      'Level 3 (Malu-malu perhatian): Menunjukkan perhatian secara terang-terangan walau mudah tersipu malu (blush) dan salting saat digoda.',
  },
  {
    level: 4,
    title: 'Dere',
    minPoints: 200,
    nextThreshold: null,
    promptInstruction:
      'Level 4 (Dere): Sangat manis, terbuka, tulus mengungkapkan rasa peduli dan menghargai keberadaan user, tetap dengan sentuhan gengsi imut khasnya.',
  },
];

export function computeLevel(points) {
  if (points >= 200) return 4;
  if (points >= 100) return 3;
  if (points >= 50) return 2;
  if (points >= 20) return 1;
  return 0;
}

export function getLevelInfo(level) {
  return (
    AFFINITY_LEVELS.find((l) => l.level === level) ?? AFFINITY_LEVELS[0]
  );
}

export function getTodayDateStr(now = Date.now(), tz = 'Asia/Jakarta') {
  const parts = getZonedParts(new Date(now), tz);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/**
 * Ambil status affinity user saat ini. Menerapkan peluruhan sangat lambat jika lama tidak interaksi (> 7 hari).
 */
export function getAffinity(userId, tz = 'Asia/Jakarta', now = Date.now()) {
  const db = getDb();
  let row = db
    .prepare('SELECT * FROM affinity WHERE user_id = ?')
    .get(userId);

  if (!row) {
    return {
      userId,
      points: 0,
      level: 0,
      title: AFFINITY_LEVELS[0].title,
      gainedToday: 0,
      dailyCap: DAILY_POINTS_CAP,
      lastGainDate: null,
      lastChatAt: now,
      promptInstruction: AFFINITY_LEVELS[0].promptInstruction,
      nextThreshold: AFFINITY_LEVELS[0].nextThreshold,
    };
  }

  const todayStr = getTodayDateStr(now, tz);
  let gainedToday = row.last_gain_date === todayStr ? row.gained_today : 0;
  let points = row.points;

  // Peluruhan sangat lambat (gentle decay): 1 poin per 7 hari tanpa interaksi
  const daysInactive = Math.floor((now - row.last_chat_at) / (24 * 3600_000));
  if (daysInactive >= 7) {
    const decayPoints = Math.floor(daysInactive / 7);
    points = Math.max(0, points - decayPoints);
  }

  const level = computeLevel(points);
  const info = getLevelInfo(level);

  return {
    userId,
    points,
    level,
    title: info.title,
    gainedToday,
    dailyCap: DAILY_POINTS_CAP,
    lastGainDate: row.last_gain_date,
    lastChatAt: row.last_chat_at,
    promptInstruction: info.promptInstruction,
    nextThreshold: info.nextThreshold,
  };
}

/**
 * Catat interaksi pesan baru user dan tambahkan poin kedekatan jika belum melewati batas harian.
 */
export function recordInteraction(userId, tz = 'Asia/Jakarta', now = Date.now()) {
  const db = getDb();
  const todayStr = getTodayDateStr(now, tz);
  const current = getAffinity(userId, tz, now);

  const remainingDaily = Math.max(0, DAILY_POINTS_CAP - current.gainedToday);
  const pointsToAdd = Math.min(POINTS_PER_INTERACTION, remainingDaily);

  const newPoints = current.points + pointsToAdd;
  const newGainedToday = current.gainedToday + pointsToAdd;
  const newLevel = computeLevel(newPoints);

  db.prepare(
    `INSERT INTO affinity (user_id, points, level, last_gain_date, gained_today, last_chat_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       points = ?,
       level = ?,
       last_gain_date = ?,
       gained_today = ?,
       last_chat_at = ?`,
  ).run(
    userId,
    newPoints,
    newLevel,
    todayStr,
    newGainedToday,
    now,
    newPoints,
    newLevel,
    todayStr,
    newGainedToday,
    now,
  );

  return {
    userId,
    points: newPoints,
    level: newLevel,
    addedPoints: pointsToAdd,
    gainedToday: newGainedToday,
    dailyCap: DAILY_POINTS_CAP,
  };
}

