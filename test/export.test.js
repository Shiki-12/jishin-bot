import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getUserExportData,
  deleteUserData,
  getPrivacyPolicyText,
} from '../src/core/export.js';
import exportFeature from '../src/features/export.js';
import { getDb } from '../src/core/db.js';

test('F-61: Ekspor dan Hapus Data (Privasi & GDPR Compliance)', async (t) => {
  const db = getDb();
  const testUserId = 7700991;

  // Bersihkan data user test terlebih dahulu
  deleteUserData(testUserId);

  await t.test('Kebijakan Privasi (getPrivacyPolicyText & /privacy)', async () => {
    const text = getPrivacyPolicyText();
    assert.ok(typeof text === 'string');
    assert.match(text, /Kebijakan Privasi/i);
    assert.match(text, /\/export/);
    assert.match(text, /\/deleteme/);
    assert.match(text, /\/forget/);

    const privacyCmd = exportFeature.commands.find((c) => c.name === 'privacy');
    let repliedMsg = '';
    const ctx = {
      reply: async (msg) => {
        repliedMsg = msg;
      },
    };
    await privacyCmd.handler(ctx);
    assert.equal(repliedMsg, text);
  });

  await t.test('Ekspor Seluruh Data Pengguna (getUserExportData)', () => {
    // Sisipkan dummy data di berbagai tabel
    const now = Date.now();

    db.prepare(
      `INSERT INTO users (id, first_name, username, tz, persona, lang, city, created_at)
       VALUES (?, 'Budi', 'budi_test', 'Asia/Jakarta', 'tsundere', 'id', 'Jakarta', ?)`,
    ).run(testUserId, now);

    db.prepare(
      `INSERT INTO notes (user_id, text, tags, created_at)
       VALUES (?, 'Catatan rahasia penting', 'tag1,tag2', ?)`,
    ).run(testUserId, now);

    db.prepare(
      `INSERT INTO todos (user_id, text, done, created_at)
       VALUES (?, 'Beli kopi susu', 0, ?)`,
    ).run(testUserId, now);

    db.prepare(
      `INSERT INTO reminders (chat_id, user_id, text, due_at, tz, repeat, status, created_at)
       VALUES (?, ?, 'Rapat mingguan', ?, 'Asia/Jakarta', 'none', 'pending', ?)`,
    ).run(testUserId, testUserId, now + 3600000, now);

    db.prepare(
      `INSERT INTO user_facts (user_id, fact, created_at)
       VALUES (?, 'Pengguna menyukai kopi hitam tanpa gula', ?)`,
    ).run(testUserId, now);

    db.prepare(
      `INSERT INTO expenses (user_id, amount, category, note, created_at)
       VALUES (?, 25000, 'makan', 'Nasi padang', ?)`,
    ).run(testUserId, now);

    db.prepare(
      `INSERT INTO moods (user_id, score, note, date_str, created_at)
       VALUES (?, 5, 'Sangat produktif', '2026-11-05', ?)`,
    ).run(testUserId, now);

    const habitRes = db
      .prepare(
        `INSERT INTO habits (user_id, name, remind_time, created_at)
         VALUES (?, 'Olahraga pagi', '06:00', ?)`,
      )
      .run(testUserId, now);

    db.prepare(
      `INSERT INTO habit_logs (habit_id, date, status, created_at)
       VALUES (?, '2026-11-05', 'done', ?)`,
    ).run(habitRes.lastInsertRowid, now);

    db.prepare(
      `INSERT INTO affinity (user_id, points, level, last_gain_date, gained_today, last_chat_at)
       VALUES (?, 35, 2, '2026-11-05', 5, ?)`,
    ).run(testUserId, now);

    db.prepare(
      `INSERT INTO game_scores (user_id, chat_id, points, wins, losses, draws, updated_at)
       VALUES (?, ?, 10, 3, 1, 1, ?)`,
    ).run(testUserId, testUserId, now);

    db.prepare(
      `INSERT INTO custom_personas (chat_id, user_id, name, description, created_at)
       VALUES (?, ?, 'Bot Helper', 'Asisten ramah', ?)`,
    ).run(testUserId, testUserId, now);

    db.prepare(
      `INSERT INTO proactive_settings (user_id, enabled, quiet_start, quiet_end, created_at)
       VALUES (?, 1, '22:00', '07:00', ?)`,
    ).run(testUserId, now);

    // Ambil data ekspor
    const exported = getUserExportData(testUserId);

    assert.ok(exported.export_metadata);
    assert.equal(exported.export_metadata.user_id, testUserId);
    assert.equal(exported.export_metadata.format_version, '1.0');

    assert.equal(exported.user_profile.first_name, 'Budi');
    assert.equal(exported.user_profile.username, 'budi_test');

    assert.equal(exported.notes.length, 1);
    assert.equal(exported.notes[0].text, 'Catatan rahasia penting');

    assert.equal(exported.todos.length, 1);
    assert.equal(exported.todos[0].text, 'Beli kopi susu');

    assert.equal(exported.reminders.length, 1);
    assert.equal(exported.reminders[0].text, 'Rapat mingguan');

    assert.equal(exported.memory_facts.length, 1);
    assert.equal(exported.memory_facts[0].fact, 'Pengguna menyukai kopi hitam tanpa gula');

    assert.equal(exported.expenses.length, 1);
    assert.equal(exported.expenses[0].amount, 25000);

    assert.equal(exported.moods.length, 1);
    assert.equal(exported.moods[0].score, 5);

    assert.equal(exported.habits.length, 1);
    assert.equal(exported.habits[0].name, 'Olahraga pagi');
    assert.equal(exported.habits[0].logs.length, 1);
    assert.equal(exported.habits[0].logs[0].status, 'done');

    assert.ok(exported.affinity);
    assert.equal(exported.affinity.points, 35);

    assert.equal(exported.game_scores.length, 1);
    assert.equal(exported.game_scores[0].wins, 3);

    assert.ok(exported.custom_persona);
    assert.equal(exported.custom_persona.name, 'Bot Helper');

    assert.ok(exported.proactive_settings);
    assert.equal(exported.proactive_settings.enabled, 1);
  });

  await t.test('Perintah /export Menghasilkan File Dokumen JSON', async () => {
    let documentSent = null;
    let documentOptions = null;
    let actionTriggered = null;

    const ctx = {
      from: { id: testUserId },
      chat: { id: testUserId, type: 'private' },
      reply: async () => {},
      replyWithChatAction: async (action) => {
        actionTriggered = action;
      },
      replyWithDocument: async (doc, opts) => {
        documentSent = doc;
        documentOptions = opts;
      },
    };

    const exportCmd = exportFeature.commands.find((c) => c.name === 'export');
    await exportCmd.handler(ctx);

    assert.equal(actionTriggered, 'upload_document');
    assert.ok(documentSent);
    assert.ok(documentOptions?.caption);

    // Periksa nama file dan isi dokumen
    assert.equal(documentSent.filename, `data_export_${testUserId}.json`);
    const parsedData = JSON.parse(documentSent.fileData.toString('utf-8'));
    assert.equal(parsedData.export_metadata.user_id, testUserId);
    assert.equal(parsedData.user_profile.username, 'budi_test');
  });

  await t.test('Perintah /deleteme Menampilkan Pesan Konfirmasi & Tombol Inline', async () => {
    let replyText = '';
    let replyOpts = null;

    const ctx = {
      from: { id: testUserId },
      chat: { id: testUserId, type: 'private' },
      reply: async (text, opts) => {
        replyText = text;
        replyOpts = opts;
      },
    };

    const deletemeCmd = exportFeature.commands.find((c) => c.name === 'deleteme');
    await deletemeCmd.handler(ctx);

    assert.match(replyText, /Peringatan Penghapusan Data Permanen/i);
    assert.ok(replyOpts?.reply_markup);

    // Cek ada tombol konfirmasi dan batal
    const buttons = replyOpts.reply_markup.inline_keyboard.flat();
    assert.ok(buttons.some((b) => b.callback_data === `delme:confirm:${testUserId}`));
    assert.ok(buttons.some((b) => b.callback_data === `delme:cancel:${testUserId}`));
  });

  await t.test('Callback Pembatalan (delme:cancel:)', async () => {
    const cancelCb = exportFeature.callbacks.find((c) => c.prefix === 'delme:cancel:');

    // 1. Ditolak jika user berbeda
    let alertText = '';
    const unauthorizedCtx = {
      from: { id: 9999999 }, // user lain
      callbackQuery: { data: `delme:cancel:${testUserId}` },
      answerCallbackQuery: async (opts) => {
        alertText = opts.text;
      },
      editMessageText: async () => {},
    };
    await cancelCb.handler(unauthorizedCtx);
    assert.match(alertText, /hanya dapat dibatalkan oleh pemilik akun/i);

    // 2. Berhasil jika pemilik akun
    let editedText = '';
    const authorizedCtx = {
      from: { id: testUserId },
      callbackQuery: { data: `delme:cancel:${testUserId}` },
      answerCallbackQuery: async () => {},
      editMessageText: async (text) => {
        editedText = text;
      },
    };
    await cancelCb.handler(authorizedCtx);
    assert.match(editedText, /dibatalkan/i);

    // Pastikan data tidak terhapus
    const noteCount = db
      .prepare('SELECT count(*) as c FROM notes WHERE user_id = ?')
      .get(testUserId).c;
    assert.equal(noteCount, 1);
  });

  await t.test('Callback Konfirmasi Penghapusan (delme:confirm:) & deleteUserData', async () => {
    const confirmCb = exportFeature.callbacks.find((c) => c.prefix === 'delme:confirm:');

    // 1. Ditolak jika user berbeda
    let alertText = '';
    const unauthorizedCtx = {
      from: { id: 9999999 },
      callbackQuery: { data: `delme:confirm:${testUserId}` },
      answerCallbackQuery: async (opts) => {
        alertText = opts.text;
      },
      editMessageText: async () => {},
    };
    await confirmCb.handler(unauthorizedCtx);
    assert.match(alertText, /hanya dapat dikonfirmasi oleh pemilik akun/i);

    // 2. Berhasil jika pemilik akun
    let editedText = '';
    const authorizedCtx = {
      from: { id: testUserId },
      callbackQuery: { data: `delme:confirm:${testUserId}` },
      answerCallbackQuery: async () => {},
      editMessageText: async (text) => {
        editedText = text;
      },
    };
    await confirmCb.handler(authorizedCtx);
    assert.match(editedText, /dihapus secara permanen/i);

    // Verifikasi seluruh tabel bersih dari testUserId
    assert.equal(
      db.prepare('SELECT count(*) as c FROM users WHERE id = ?').get(testUserId).c,
      0,
    );
    assert.equal(
      db.prepare('SELECT count(*) as c FROM notes WHERE user_id = ?').get(testUserId).c,
      0,
    );
    assert.equal(
      db.prepare('SELECT count(*) as c FROM todos WHERE user_id = ?').get(testUserId).c,
      0,
    );
    assert.equal(
      db.prepare('SELECT count(*) as c FROM reminders WHERE user_id = ?').get(testUserId).c,
      0,
    );
    assert.equal(
      db.prepare('SELECT count(*) as c FROM user_facts WHERE user_id = ?').get(testUserId).c,
      0,
    );
    assert.equal(
      db.prepare('SELECT count(*) as c FROM expenses WHERE user_id = ?').get(testUserId).c,
      0,
    );
    assert.equal(
      db.prepare('SELECT count(*) as c FROM moods WHERE user_id = ?').get(testUserId).c,
      0,
    );
    assert.equal(
      db.prepare('SELECT count(*) as c FROM habits WHERE user_id = ?').get(testUserId).c,
      0,
    );
    assert.equal(
      db.prepare(
        `SELECT count(*) as c FROM habit_logs WHERE habit_id IN (SELECT id FROM habits WHERE user_id = ?)`,
      ).get(testUserId).c,
      0,
    );
    assert.equal(
      db.prepare('SELECT count(*) as c FROM affinity WHERE user_id = ?').get(testUserId).c,
      0,
    );
    assert.equal(
      db.prepare('SELECT count(*) as c FROM game_scores WHERE user_id = ?').get(testUserId).c,
      0,
    );
    assert.equal(
      db.prepare('SELECT count(*) as c FROM custom_personas WHERE user_id = ?').get(testUserId).c,
      0,
    );
    assert.equal(
      db.prepare('SELECT count(*) as c FROM proactive_settings WHERE user_id = ?').get(testUserId).c,
      0,
    );
  });
});
