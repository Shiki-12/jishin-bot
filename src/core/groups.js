import { getDb } from './db.js';
import { generateReply } from '../llm.js';

export const MAX_GROUP_BUFFER = 200;
export const DEFAULT_CHATTY_PROB = 0.05;
export const DEFAULT_CHATTY_COOLDOWN_MS = 60_000; // 1 menit

/**
 * Cek apakah user adalah admin atau pembuat grup.
 * Di private chat selalu true.
 * @param {object} ctx
 * @param {number} [userId]
 * @returns {Promise<boolean>}
 */
export async function isGroupAdmin(ctx, userId) {
  if (!ctx.chat || ctx.chat.type === 'private') return true;
  const targetId = userId ?? ctx.from?.id;
  if (!targetId) return false;

  try {
    let member = null;
    if (typeof ctx.getChatMember === 'function') {
      member = await ctx.getChatMember(targetId);
    } else if (ctx.api?.getChatMember) {
      member = await ctx.api.getChatMember(ctx.chat.id, targetId);
    }
    return ['creator', 'administrator'].includes(member?.status);
  } catch (err) {
    console.warn(`Gagal memeriksa status admin untuk user ${targetId} di chat ${ctx.chat?.id}:`, err.message);
    return false;
  }
}

/**
 * Ambil pengaturan grup saat ini dari database.
 * @param {number} chatId
 * @returns {{ chat_id: number, chatty: number, chatty_prob: number, last_chatty_at: number, welcome_enabled: number, created_at: number }}
 */
export function getGroupSettings(chatId) {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM group_settings WHERE chat_id = ?')
    .get(chatId);

  if (row) return row;

  return {
    chat_id: chatId,
    chatty: 0,
    chatty_prob: DEFAULT_CHATTY_PROB,
    last_chatty_at: 0,
    welcome_enabled: 1,
    created_at: Date.now(),
  };
}

/**
 * Simpan atau perbarui pengaturan grup.
 * @param {number} chatId
 * @param {object} updates
 * @returns {object}
 */
export function setGroupSetting(chatId, updates = {}) {
  const db = getDb();
  const current = getGroupSettings(chatId);

  const chatty = updates.chatty !== undefined ? Number(updates.chatty) : current.chatty;
  const chattyProb = updates.chatty_prob !== undefined ? Number(updates.chatty_prob) : current.chatty_prob;
  const lastChattyAt = updates.last_chatty_at !== undefined ? Number(updates.last_chatty_at) : current.last_chatty_at;
  const welcomeEnabled = updates.welcome_enabled !== undefined ? Number(updates.welcome_enabled) : current.welcome_enabled;
  const now = Date.now();

  db.prepare(
    `INSERT INTO group_settings (chat_id, chatty, chatty_prob, last_chatty_at, welcome_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
       chatty = excluded.chatty,
       chatty_prob = excluded.chatty_prob,
       last_chatty_at = excluded.last_chatty_at,
       welcome_enabled = excluded.welcome_enabled`,
  ).run(chatId, chatty, chattyProb, lastChattyAt, welcomeEnabled, current.created_at || now);

  return {
    chat_id: chatId,
    chatty,
    chatty_prob: chattyProb,
    last_chatty_at: lastChattyAt,
    welcome_enabled: welcomeEnabled,
  };
}

/**
 * Simpan pesan grup ke penyangga (buffer) terbatas maksimal 200 pesan.
 * Pesan lama di atas 200 otomatis dihapus.
 * @param {object} params
 * @param {number} params.chatId
 * @param {number} params.userId
 * @param {string} params.senderName
 * @param {string} params.text
 * @param {number} [params.now]
 */
export function recordGroupMessage({
  chatId,
  userId,
  senderName,
  text,
  now = Date.now(),
}) {
  if (!chatId || !text || !text.trim()) return;

  const db = getDb();
  const cleanText = text.trim();
  const cleanSender = (senderName || 'User').trim().slice(0, 100);

  db.prepare(
    `INSERT INTO group_messages (chat_id, user_id, sender_name, text, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(chatId, userId, cleanSender, cleanText, now);

  // Pangkas pesan agar maksimal hanya 200 pesan terakhir per grup
  db.prepare(
    `DELETE FROM group_messages
     WHERE chat_id = ? AND id NOT IN (
       SELECT id FROM group_messages
       WHERE chat_id = ?
       ORDER BY id DESC
       LIMIT ?
     )`,
  ).run(chatId, chatId, MAX_GROUP_BUFFER);
}

/**
 * Ambil riwayat pesan terakhir dari grup.
 * @param {number} chatId
 * @param {number} [limit=30]
 * @returns {Array<{ id: number, chat_id: number, user_id: number, sender_name: string, text: string, created_at: number }>}
 */
export function getGroupMessages(chatId, limit = 30) {
  const db = getDb();
  const clampedLimit = Math.max(5, Math.min(Number(limit) || 30, MAX_GROUP_BUFFER));

  return db
    .prepare(
      `SELECT * FROM (
         SELECT * FROM group_messages
         WHERE chat_id = ?
         ORDER BY id DESC
         LIMIT ?
       ) ORDER BY id ASC`,
    )
    .all(chatId, clampedLimit);
}

/**
 * Evaluasi apakah mode /chatty terpicu (peluang acak + cooldown).
 * @param {number} chatId
 * @param {number} [now]
 * @param {number} [cooldownMs]
 * @returns {boolean}
 */
export function shouldChattyTrigger(
  chatId,
  now = Date.now(),
  cooldownMs = DEFAULT_CHATTY_COOLDOWN_MS,
) {
  const settings = getGroupSettings(chatId);
  if (!settings.chatty) return false;

  // Cek cooldown
  if (now - (settings.last_chatty_at || 0) < cooldownMs) {
    return false;
  }

  // Cek peluang acak
  const prob = settings.chatty_prob ?? DEFAULT_CHATTY_PROB;
  if (Math.random() < prob) {
    setGroupSetting(chatId, { last_chatty_at: now });
    return true;
  }

  return false;
}

/**
 * Buat system prompt khusus untuk perangkuman percakapan grup.
 * @returns {string}
 */
export function buildGroupSummarySystemPrompt() {
  return [
    'You are an expert executive group conversation summarizer.',
    'Summarize the following recent group chat discussion objectively and clearly.',
    'Rules:',
    '- Highlight key discussion topics, decisions made, questions asked, and important highlights.',
    '- Present the summary as clear bullet points (- point).',
    '- Keep the language matching the primary language used in the group (Indonesian by default).',
    '- Do NOT include pleasantries, meta-commentary, or personal opinions.',
    '- Output ONLY the structured bullet-point summary.',
  ].join('\n');
}

/**
 * Rangkum pesan grup menggunakan LLM dengan system prompt netral.
 * @param {object} params
 * @param {Array<{ sender_name: string, text: string }>} params.messages
 * @param {Function} [params.generateReplyFn]
 * @returns {Promise<{ summaryText: string, messageCount: number }>}
 */
export async function summarizeGroupMessages({
  messages = [],
  generateReplyFn = generateReply,
}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('NO_MESSAGES');
  }

  const transcript = messages
    .map((m) => `[${m.sender_name}]: ${m.text}`)
    .join('\n');

  const systemPrompt = buildGroupSummarySystemPrompt();
  const result = await generateReplyFn({
    systemPrompt,
    history: [],
    userText: transcript,
  });

  return {
    summaryText: (result || '').trim(),
    messageCount: messages.length,
  };
}

