import { getDb } from './db.js';

/**
 * Kumpulkan seluruh data user yang tersimpan di bot untuk diekspor ke JSON.
 * @param {number} userId
 * @returns {object}
 */
export function getUserExportData(userId) {
  const db = getDb();

  const profile =
    db.prepare('SELECT id, first_name, username, tz, persona, lang, city, voice_reply, created_at FROM users WHERE id = ?').get(userId) ||
    { id: userId };

  const notes = db
    .prepare('SELECT id, text, tags, created_at FROM notes WHERE user_id = ? ORDER BY id ASC')
    .all(userId);

  const todos = db
    .prepare('SELECT id, text, done, due_at, created_at, done_at FROM todos WHERE user_id = ? ORDER BY id ASC')
    .all(userId);

  const reminders = db
    .prepare('SELECT id, chat_id, text, due_at, tz, repeat, status, created_at FROM reminders WHERE user_id = ? ORDER BY due_at ASC')
    .all(userId);

  const facts = db
    .prepare('SELECT id, fact, created_at FROM user_facts WHERE user_id = ? ORDER BY id ASC')
    .all(userId);

  const expenses = db
    .prepare('SELECT id, amount, category, note, created_at FROM expenses WHERE user_id = ? ORDER BY created_at ASC')
    .all(userId);

  const moods = db
    .prepare('SELECT id, score, note, date_str, created_at FROM moods WHERE user_id = ? ORDER BY created_at ASC')
    .all(userId);

  const habits = db
    .prepare('SELECT id, name, remind_time, created_at FROM habits WHERE user_id = ? ORDER BY id ASC')
    .all(userId);

  const habitLogs = db
    .prepare(
      `SELECT l.habit_id, l.date, l.status
       FROM habit_logs l
       JOIN habits h ON l.habit_id = h.id
       WHERE h.user_id = ?
       ORDER BY l.date ASC`,
    )
    .all(userId);

  const affinity =
    db.prepare('SELECT points, level, last_gain_date, gained_today, last_chat_at FROM affinity WHERE user_id = ?').get(userId) || null;

  const gameScores = db
    .prepare('SELECT chat_id, points, wins, losses, draws, updated_at FROM game_scores WHERE user_id = ?')
    .all(userId);

  const customPersona =
    db.prepare('SELECT name, description, created_at FROM custom_personas WHERE user_id = ?').get(userId) || null;

  const proactive =
    db.prepare('SELECT enabled, quiet_start, quiet_end, unreplied_count, last_sent_at FROM proactive_settings WHERE user_id = ?').get(userId) || null;

  return {
    export_metadata: {
      exported_at: new Date().toISOString(),
      user_id: userId,
      format_version: '1.0',
    },
    user_profile: profile,
    notes,
    todos,
    reminders,
    memory_facts: facts,
    expenses,
    moods,
    habits: habits.map((h) => ({
      ...h,
      logs: habitLogs.filter((l) => l.habit_id === h.id),
    })),
    affinity,
    game_scores: gameScores,
    custom_persona: customPersona,
    proactive_settings: proactive,
  };
}

/**
 * Hapus seluruh data pribadi pengguna secara permanen dari database.
 * @param {number} userId
 * @returns {{ success: boolean, userId: number }}
 */
export function deleteUserData(userId) {
  const db = getDb();

  const tx = db.transaction(() => {
    // 1. Data catatan & to-do
    db.prepare('DELETE FROM notes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM todos WHERE user_id = ?').run(userId);

    // 2. Data pengingat
    db.prepare('DELETE FROM reminders WHERE user_id = ?').run(userId);

    // 3. Fakta ingatan jangka panjang
    db.prepare('DELETE FROM user_facts WHERE user_id = ?').run(userId);

    // 4. Catatan keuangan
    db.prepare('DELETE FROM expenses WHERE user_id = ?').run(userId);

    // 5. Jurnal suasana hati (moods)
    db.prepare('DELETE FROM moods WHERE user_id = ?').run(userId);

    // 6. Kebiasaan & log habit
    db.prepare(
      `DELETE FROM habit_logs WHERE habit_id IN (SELECT id FROM habits WHERE user_id = ?)`,
    ).run(userId);
    db.prepare('DELETE FROM habits WHERE user_id = ?').run(userId);

    // 7. Kedekatan & game
    db.prepare('DELETE FROM affinity WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM game_scores WHERE user_id = ?').run(userId);

    // 8. Persona custom & chat proaktif
    db.prepare('DELETE FROM custom_personas WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM proactive_settings WHERE user_id = ?').run(userId);

    // 9. Riwayat pesan, ringkasan, dan pemakaian token
    db.prepare('DELETE FROM messages WHERE chat_id = ?').run(userId);
    db.prepare('DELETE FROM summaries WHERE chat_id = ?').run(userId);
    db.prepare('DELETE FROM usage WHERE user_id = ?').run(userId);

    // 10. Profil pengguna di tabel users
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });

  tx();

  return { success: true, userId };
}

/**
 * Teks kebijakan privasi dan pengelolaan data pengguna.
 * @returns {string}
 */
export function getPrivacyPolicyText() {
  return [
    '🔒 *Kebijakan Privasi & Pengelolaan Data*',
    '',
    'Kami menghargai privasi dan kendali penuh atas data pribadimu:',
    '',
    '1. *Data Apa yang Disimpan?*',
    '• Profil dasar Telegram (ID, nama, username) untuk personalisasi sapaan.',
    '• Data yang kamu buat secara sadar: catatan (/note), to-do (/todo), pengingat (/remind), catatan pengeluaran (/catat), dan jurnal mood (/mood).',
    '• Preferensi pengguna: zona waktu, kepribadian aktif, dan frekuensi GIF.',
    '',
    '2. *Di Mana Data Disimpan?*',
    '• Seluruh data disimpan secara lokal pada database SQLite terenkripsi OS di server bot.',
    '• Data kamu *TIDAK PERNAH* dijual, dibagikan, atau dipindahtangankan ke pihak ketiga mana pun.',
    '• File foto/gambar yang dikirimkan untuk analisis AI *TIDAK PERNAH* disimpan ke disk atau database bot (hanya dikirimkan via memori langsung ke gateway model).',
    '',
    '3. *Hak & Kendali Penuh Pengguna:*',
    '• `/export`: Unduh salinan seluruh data pribadimu kapan saja dalam format JSON standar.',
    '• `/deleteme`: Hapus seluruh rekaman data pribadimu secara permanen dari server bot (konfirmasi dua langkah).',
    '• `/forget`: Hapus riwayat percakapan dan ringkasan chat saat ini.',
  ].join('\n');
}
