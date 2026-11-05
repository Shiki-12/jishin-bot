import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidTimezone,
  getSetting,
  setSetting,
  applyGifSetting,
} from '../src/core/settings.js';
import settingsFeature from '../src/features/settings.js';
import { getDb } from '../src/core/db.js';

describe('Settings & Timezone (F-02)', () => {
  it('validasi zona waktu IANA via isValidTimezone', () => {
    assert.equal(isValidTimezone('Asia/Jakarta'), true);
    assert.equal(isValidTimezone('Asia/Makassar'), true);
    assert.equal(isValidTimezone('Asia/Jayapura'), true);
    assert.equal(isValidTimezone('UTC'), true);
    assert.equal(isValidTimezone('Europe/London'), true);

    assert.equal(isValidTimezone('WIB'), false);
    assert.equal(isValidTimezone('Bukan/Zona'), false);
    assert.equal(isValidTimezone(''), false);
    assert.equal(isValidTimezone(null), false);
    assert.equal(isValidTimezone(123), false);
  });

  it('getSetting dan setSetting menyimpan preferensi user di SQLite', () => {
    const testUserId = 771122;
    const db = getDb();
    db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);

    const ctx = {
      chat: { type: 'private', id: testUserId },
      from: { id: testUserId, first_name: 'Tester' },
    };

    // Default tz
    assert.equal(getSetting(ctx, 'tz'), 'Asia/Jakarta');

    // Ubah ke WITA
    setSetting(ctx, 'tz', 'Asia/Makassar');
    assert.equal(getSetting(ctx, 'tz'), 'Asia/Makassar');

    // Ubah frekuensi GIF
    setSetting(ctx, 'gif_freq', 'rare');
    assert.equal(getSetting(ctx, 'gif_freq'), 'rare');

    // Cek di DB langsung
    const row = db.prepare('SELECT tz, gif_freq FROM users WHERE id = ?').get(testUserId);
    assert.equal(row.tz, 'Asia/Makassar');
    assert.equal(row.gif_freq, 'rare');
  });

  it('menolak zona waktu tidak valid saat setSetting', () => {
    const ctx = {
      chat: { type: 'private', id: 554433 },
      from: { id: 554433 },
    };

    assert.throws(
      () => setSetting(ctx, 'tz', 'Zona/Ngawur'),
      /tidak valid/,
    );
  });

  it('applyGifSetting mengubah baris system prompt secara akurat', () => {
    const prompt = '## GIF\nSesekali (sekitar 1 dari 4 balasan), tambahkan tag [GIF: ...]\nContoh: [GIF: blush]\n\n## Contoh gaya';

    const offPrompt = applyGifSetting(prompt, 'off');
    assert.ok(offPrompt.includes('Jangan pernah menggunakan tag [GIF: ...]'));
    assert.ok(!offPrompt.includes('sekitar 1 dari 4 balasan'));

    const rarePrompt = applyGifSetting(prompt, 'rare');
    assert.ok(rarePrompt.includes('sangat jarang (sekitar 1 dari 10 balasan)'));

    const oftenPrompt = applyGifSetting(prompt, 'often');
    assert.ok(oftenPrompt.includes('sering (sekitar 1 dari 2 balasan)'));

    const normalPrompt = applyGifSetting(prompt, 'normal');
    assert.ok(normalPrompt.includes('sekitar 1 dari 4 balasan'));
  });

  it('perintah /timezone memperbarui zona waktu user', async () => {
    const testUserId = 882233;
    const db = getDb();
    db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
    let replyText = '';

    const ctx = {
      chat: { type: 'private', id: testUserId },
      from: { id: testUserId },
      message: { text: '/timezone Asia/Jayapura' },
      reply: async (text) => {
        replyText = text;
      },
    };

    const tzCommand = settingsFeature.commands.find((c) => c.name === 'timezone');
    assert.ok(tzCommand);

    await tzCommand.handler(ctx);

    assert.equal(getSetting(ctx, 'tz'), 'Asia/Jayapura');
    assert.ok(replyText.includes('Asia/Jayapura'));
  });

  it('callback set:val:gif_freq memperbarui frekuensi GIF via inline button', async () => {
    const testUserId = 993344;
    const db = getDb();
    db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
    let answerText = '';

    const ctx = {
      chat: { type: 'private', id: testUserId },
      from: { id: testUserId },
      callbackQuery: { data: 'set:val:gif_freq:often' },
      answerCallbackQuery: async (opts) => {
        answerText = opts?.text ?? '';
      },
      editMessageText: async () => {},
    };

    const cbHandler = settingsFeature.callbacks.find((cb) => cb.prefix === 'set:');
    assert.ok(cbHandler);

    await cbHandler.handler(ctx);

    assert.equal(getSetting(ctx, 'gif_freq'), 'often');
    assert.ok(answerText.length > 0);
  });
});
