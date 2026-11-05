import { getDb } from './db.js';

/**
 * Ambil daftar fakta stabil user (maksimal limit).
 */
export function getFacts(userId, limit = 15) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM user_facts
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(userId, limit);
}

/**
 * Tambah fakta baru tentang user (otomatis deduplikasi lewat UNIQUE).
 */
export function addFact(userId, fact) {
  if (!fact || typeof fact !== 'string') return null;
  const cleanFact = fact.trim();
  if (cleanFact.length < 3 || cleanFact.length > 300) return null;

  const db = getDb();
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO user_facts (user_id, fact, created_at)
       VALUES (?, ?, ?)`,
    )
    .run(userId, cleanFact, Date.now());

  return info.changes > 0 ? info.lastInsertRowid : null;
}

/**
 * Hapus satu fakta berdasarkan ID dan kepemilikan user.
 */
export function deleteFact(userId, factId) {
  const db = getDb();
  const res = db
    .prepare(`DELETE FROM user_facts WHERE id = ? AND user_id = ?`)
    .run(factId, userId);
  return res.changes > 0;
}

/**
 * Hapus seluruh fakta untuk seorang user.
 */
export function clearFacts(userId) {
  const db = getDb();
  const res = db
    .prepare(`DELETE FROM user_facts WHERE user_id = ?`)
    .run(userId);
  return res.changes;
}

/**
 * Ambil ringkasan riwayat percakapan lama untuk chat.
 */
export function getSummary(chatId) {
  const db = getDb();
  const row = db
    .prepare(`SELECT text FROM summaries WHERE chat_id = ?`)
    .get(chatId);
  return row?.text ?? null;
}

/**
 * Simpan atau perbarui ringkasan riwayat percakapan untuk chat.
 */
export function saveSummary(chatId, text) {
  if (!text || typeof text !== 'string') return;
  const clean = text.trim();
  const db = getDb();
  db.prepare(
    `INSERT INTO summaries (chat_id, text, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
       text = excluded.text,
       updated_at = excluded.updated_at`,
  ).run(chatId, clean, Date.now());
}

/**
 * Hapus ringkasan riwayat percakapan untuk chat.
 */
export function clearSummary(chatId) {
  const db = getDb();
  db.prepare(`DELETE FROM summaries WHERE chat_id = ?`).run(chatId);
}

/**
 * Parsing teks respons LLM menjadi array of string fakta.
 */
export function parseFactsJson(raw) {
  if (!raw || typeof raw !== 'string') return [];

  let text = raw.trim();
  // Hilangkan format markdown ```json ... ``` bila ada
  const jsonBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonBlock) {
    text = jsonBlock[1].trim();
  }

  // Cari blok array [...] bila masih ada teks pengantar
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    text = arrayMatch[0];
  }

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => typeof item === 'string' && item.trim().length >= 3)
        .map((item) => item.trim());
    }
  } catch {}

  return [];
}

/**
 * Ekstrak fakta baru dari percakapan terakhir menggunakan LLM.
 */
export async function extractAndSaveFacts({
  userId,
  chatId,
  generateReplyFn,
}) {
  if (typeof generateReplyFn !== 'function') return [];

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT role, text FROM messages
       WHERE chat_id = ?
       ORDER BY id DESC
       LIMIT 20`,
    )
    .all(chatId)
    .reverse();

  if (rows.length < 2) return [];

  const conversationTranscript = rows
    .map((r) => `${r.role === 'user' ? 'User' : 'Mika'}: ${r.text}`)
    .join('\n');

  const systemPrompt = `Kamu adalah sistem ekstraksi fakta jangka panjang.
Tugas: Ekstrak fakta stabil dan relevan tentang User dari kutipan percakapan berikut (misalnya: nama panggilan, pekerjaan/jurusan, hobi, makanan kesukaan, hewan peliharaan, preferensi pribadi, kebiasaan, jadwal tetap).

ATURAN KEAMANAN & PRIVASI (MUTLAK):
1. DILARANG KERAS menyimpan data sensitif: kata sandi/password, PIN, nomor rekening bank, kartu kredit, nomor KTP/identitas rahasia, atau informasi diagnosis medis/penyakit pribadi.
2. HANYA ekstrak fakta yang secara eksplisit dinyatakan oleh User tentang dirinya sendiri. Jangan menebak.
3. HANYA kembalikan JSON array of string tanpa format atau penjelasan tambahan.
   Contoh: ["Suka minum kopi hitam tanpa gula", "Pelihara kucing bernama Mochi"]
4. Jika tidak ada fakta stabil atau baru yang ditemukan, kembalikan: []`;

  try {
    const raw = await generateReplyFn({
      systemPrompt,
      history: [],
      userText: `Kutipan percakapan:\n${conversationTranscript}\n\nEkstrak fakta stabil tentang user dalam format JSON array:`,
    });

    const facts = parseFactsJson(raw);
    const saved = [];
    for (const f of facts) {
      const id = addFact(userId, f);
      if (id) saved.push({ id, fact: f });
    }
    return saved;
  } catch (err) {
    console.error('Gagal mengekstrak fakta memori:', err.message);
    return [];
  }
}

/**
 * Rangkum percakapan lama jika jumlah pesan melebihi ambang batas (threshold).
 */
export async function summarizeOlderHistory({
  chatId,
  generateReplyFn,
  threshold = 24,
  batchSize = 12,
}) {
  if (typeof generateReplyFn !== 'function') return null;

  const db = getDb();
  const countRow = db
    .prepare(`SELECT count(*) as count FROM messages WHERE chat_id = ?`)
    .get(chatId);
  const total = countRow?.count ?? 0;

  if (total <= threshold) return null;

  // Ambil pesan paling lama sebanyak batchSize
  const oldRows = db
    .prepare(
      `SELECT id, role, text FROM messages
       WHERE chat_id = ?
       ORDER BY id ASC
       LIMIT ?`,
    )
    .all(chatId, batchSize);

  if (oldRows.length === 0) return null;

  const oldTranscript = oldRows
    .map((r) => `${r.role === 'user' ? 'User' : 'Mika'}: ${r.text}`)
    .join('\n');

  const existingSummary = getSummary(chatId);
  let prompt = `Rangkum intisari percakapan lama berikut secara padat, jelas, dan objektif dalam 1-2 paragraf pendek. Sertakan topik utama dan keputusan penting yang pernah dibicarakan.`;
  if (existingSummary) {
    prompt += `\n\nRingkasan percakapan sebelumnya:\n${existingSummary}`;
  }

  try {
    const newSummary = await generateReplyFn({
      systemPrompt: 'Kamu adalah asisten perangkum memori percakapan.',
      history: [],
      userText: `${prompt}\n\nPercakapan yang perlu dirangkum:\n${oldTranscript}\n\nRingkasan padat baru:`,
    });

    if (newSummary && newSummary.trim().length > 10) {
      saveSummary(chatId, newSummary.trim());

      // Hapus pesan lama yang sudah terangkum agar tabel tetap ramping
      const idsToDelete = oldRows.map((r) => r.id);
      db.prepare(
        `DELETE FROM messages WHERE id IN (${idsToDelete.map(() => '?').join(',')})`,
      ).run(...idsToDelete);

      return newSummary.trim();
    }
  } catch (err) {
    console.error('Gagal merangkum riwayat percakapan lama:', err.message);
  }

  return null;
}

