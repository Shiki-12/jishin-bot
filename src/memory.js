import { getDb } from './core/db.js';

const MAX_MESSAGES = Number(process.env.MAX_HISTORY ?? 24);

/**
 * Simpan segera (checkpoint WAL saat bot dimatikan).
 */
export function flush() {
  try {
    const db = getDb();
    db.pragma('wal_checkpoint(PASSIVE)');
  } catch {}
}

/**
 * Riwayat chat dalam format { role: 'user' | 'model', text }.
 * Mengambil N pesan terakhir dalam urutan kronologis.
 */
export function getHistory(chatId) {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT role, text FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?',
    )
    .all(chatId, MAX_MESSAGES)
    .reverse();

  // Sebagian API LLM mengharapkan percakapan diawali dari giliran 'user'.
  while (rows.length && rows[0].role !== 'user') {
    rows.shift();
  }

  return rows;
}

/**
 * Tambah pesan baru ke riwayat percakapan chat.
 */
export function addMessage(chatId, role, text) {
  const db = getDb();
  db.prepare(
    'INSERT INTO messages (chat_id, role, text, created_at) VALUES (?, ?, ?, ?)',
  ).run(chatId, role, text, Date.now());
}

/**
 * Hapus seluruh riwayat percakapan untuk chat tertentu.
 */
export function clearHistory(chatId) {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
}
