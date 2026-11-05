import { getDb } from './db.js';
import { getPersonality } from '../personalities/index.js';

const ALLOWED_KEYS = new Set(['tz', 'persona', 'lang', 'gif_freq', 'city', 'adzan', 'adzan_lead', 'adzan_last_date', 'voice_reply', 'expression_mode']);

const DEFAULT_SETTINGS = {
  tz: 'Asia/Jakarta',
  persona: null,
  lang: 'id',
  gif_freq: 'normal',
  city: null,
  adzan: 0,
  adzan_lead: 10,
  adzan_last_date: null,
  voice_reply: 0,
  expression_mode: null,
};

/**
 * Validasi apakah nama zona waktu sesuai format IANA valid di Node.js Intl.
 */
export function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ambil nilai pengaturan untuk user/chat saat ini.
 */
export function getSetting(ctx, key, defaultValue = DEFAULT_SETTINGS[key]) {
  if (!ALLOWED_KEYS.has(key)) return defaultValue;

  const db = getDb();
  const isPrivate = ctx?.chat?.type === 'private' || !ctx?.chat;
  const userId = ctx?.from?.id;
  const chatId = ctx?.chat?.id;

  if (isPrivate && userId) {
    const row = db.prepare(`SELECT ${key} AS val FROM users WHERE id = ?`).get(userId);
    if (row?.val !== null && row?.val !== undefined) return row.val;
  } else if (chatId) {
    const row = db.prepare(`SELECT ${key} AS val FROM chats WHERE id = ?`).get(chatId);
    if (row?.val !== null && row?.val !== undefined) return row.val;
  }

  return defaultValue ?? null;
}

/**
 * Ambil persona efektif berdasarkan prioritas:
 * 1. Pilihan eksplisit user/chat (/persona atau /settings) -> 'pilihan chat'
 * 2. PERSONALITY di .env -> 'env'
 * 3. Default ('tsundere') -> 'default'
 */
export function getEffectivePersona(ctx) {
  const db = getDb();
  const isPrivate = ctx?.chat?.type === 'private' || !ctx?.chat;
  const userId = ctx?.from?.id;
  const chatId = ctx?.chat?.id;

  let chosen = null;
  try {
    if (isPrivate && userId) {
      const row = db.prepare('SELECT persona AS val FROM users WHERE id = ?').get(userId);
      if (row?.val) chosen = row.val;
    } else if (chatId) {
      const row = db.prepare('SELECT persona AS val FROM chats WHERE id = ?').get(chatId);
      if (row?.val) chosen = row.val;
    }
  } catch {}

  if (chosen) {
    try {
      const persona = getPersonality(chosen, ctx);
      return { persona, id: chosen, source: 'pilihan chat' };
    } catch {}
  }

  const envPersona = process.env.PERSONALITY?.trim();
  if (envPersona) {
    try {
      const persona = getPersonality(envPersona, ctx);
      return { persona, id: envPersona, source: 'env' };
    } catch {}
  }

  const defaultPersona = getPersonality('tsundere', ctx);
  return { persona: defaultPersona, id: 'tsundere', source: 'default' };
}

/**
 * Ambil mode gaya ekspresi efektif (mixed / emoji / kaomoji / plain / off).
 * Pilihan chat mengalahkan konfigurasi env EXPRESSION_MODE.
 */
export function getEffectiveExpressionMode(ctx) {
  const chosen = getSetting(ctx, 'expression_mode', null);
  if (chosen) return chosen;
  return process.env.EXPRESSION_MODE || 'mixed';
}

/**
 * Simpan nilai pengaturan untuk user/chat saat ini.
 */
export function setSetting(ctx, key, value) {
  if (!ALLOWED_KEYS.has(key)) {
    throw new Error(`Kunci pengaturan '${key}' tidak dikenali.`);
  }

  if (key === 'tz' && !isValidTimezone(value)) {
    throw new Error(`Zona waktu '${value}' tidak valid. Gunakan format IANA, misal: Asia/Jakarta`);
  }

  const db = getDb();
  const isPrivate = ctx?.chat?.type === 'private' || !ctx?.chat;
  const userId = ctx?.from?.id;
  const chatId = ctx?.chat?.id;

  if (isPrivate && userId) {
    // Pastikan user ada di tabel
    db.prepare(`
      INSERT INTO users (id, first_name, username, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(userId, ctx?.from?.first_name ?? null, ctx?.from?.username ?? null, Date.now());

    db.prepare(`UPDATE users SET ${key} = ? WHERE id = ?`).run(value, userId);
  } else if (chatId) {
    db.prepare(`
      INSERT INTO chats (id, type, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(chatId, ctx?.chat?.type ?? 'group', Date.now());

    db.prepare(`UPDATE chats SET ${key} = ? WHERE id = ?`).run(value, chatId);
  }
}

/**
 * Sesuaikan baris frekuensi GIF di dalam system prompt sesuai preferensi user.
 */
export function applyGifSetting(systemPrompt, gifFreq = 'normal') {
  if (!systemPrompt) return systemPrompt;

  if (gifFreq === 'off') {
    return systemPrompt.replace(
      /## GIF[\s\S]*?(?=##|$)/,
      '## GIF\nJangan pernah menggunakan tag [GIF: ...] dalam situasi apa pun. Dilarang mengirim GIF.\n\n',
    );
  }

  if (gifFreq === 'rare') {
    return systemPrompt.replace(
      /sekitar 1 dari 4 balasan/i,
      'sangat jarang (sekitar 1 dari 10 balasan)',
    );
  }

  if (gifFreq === 'often') {
    return systemPrompt.replace(
      /sekitar 1 dari 4 balasan/i,
      'sering (sekitar 1 dari 2 balasan)',
    );
  }

  return systemPrompt;
}

