import './setup.js';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/core/db.js';
import {
  ALLOWED_MOODS,
  isValidMood,
  normalizeMood,
  addSticker,
  deleteSticker,
  getStickerById,
  getStickerByFileId,
  getRandomStickerByMood,
  getStickersCountByMood,
  getTotalStickersCount,
  setAdminAddStickerMode,
  getAdminAddStickerMode,
  clearAdminAddStickerMode,
} from '../src/core/stickers.js';
import stickersFeature from '../src/features/stickers.js';
import { extractActions, buildSystemPrompt } from '../src/core/actions.js';

describe('F-21: Stiker Reaksi & Koleksi Bot', () => {
  const TEST_FILE_1 = 'test_sticker_file_1';
  const TEST_FILE_2 = 'test_sticker_file_2';
  const TEST_FILE_3 = 'test_sticker_file_3';
  const ADMIN_USER_ID = 998877;
  const NORMAL_USER_ID = 332211;

  beforeEach(() => {
    process.env.ADMIN_IDS = String(ADMIN_USER_ID);
    clearAdminAddStickerMode();
    const db = getDb();
    db.prepare("DELETE FROM stickers WHERE file_id LIKE 'test_sticker_%'").run();
  });

  after(() => {
    clearAdminAddStickerMode();
    const db = getDb();
    db.prepare("DELETE FROM stickers WHERE file_id LIKE 'test_sticker_%'").run();
  });

  describe('Validasi & Normalisasi Mood', () => {
    it('menerima seluruh mood yang terdaftar dalam ALLOWED_MOODS', () => {
      for (const mood of ALLOWED_MOODS) {
        assert.equal(isValidMood(mood), true);
        assert.equal(normalizeMood(mood), mood);
        assert.equal(normalizeMood(mood.toUpperCase()), mood);
      }
    });

    it('menolak mood yang tidak valid atau kosong', () => {
      assert.equal(isValidMood('galau'), false);
      assert.equal(isValidMood(''), false);
      assert.equal(isValidMood(null), false);
      assert.equal(normalizeMood('marah_banget'), null);
    });
  });

  describe('Operasi Database Stiker (CRUD)', () => {
    it('menambah stiker baru dan mengambil kembali datanya', () => {
      const added = addSticker({
        fileId: TEST_FILE_1,
        mood: 'senang',
        setName: 'mika_pack',
        emoji: '😊',
      });

      assert.ok(added.id);
      assert.equal(added.file_id, TEST_FILE_1);
      assert.equal(added.mood, 'senang');
      assert.equal(added.set_name, 'mika_pack');
      assert.equal(added.emoji, '😊');

      const byId = getStickerById(added.id);
      assert.equal(byId.file_id, TEST_FILE_1);

      const byFileId = getStickerByFileId(TEST_FILE_1);
      assert.equal(byFileId.id, added.id);
    });

    it('memperbarui stiker saat file_id yang sama ditambahkan ulang (ON CONFLICT)', () => {
      addSticker({
        fileId: TEST_FILE_1,
        mood: 'senang',
        setName: 'pack1',
        emoji: '😊',
      });

      const updated = addSticker({
        fileId: TEST_FILE_1,
        mood: 'malu',
        setName: 'pack2',
        emoji: '😳',
      });

      assert.equal(updated.file_id, TEST_FILE_1);
      assert.equal(updated.mood, 'malu');
      assert.equal(updated.set_name, 'pack2');
      assert.equal(updated.emoji, '😳');
    });

    it('menghapus stiker berdasarkan ID', () => {
      const added = addSticker({
        fileId: TEST_FILE_1,
        mood: 'kesal',
      });

      const deleted = deleteSticker(added.id);
      assert.equal(deleted, true);

      const check = getStickerById(added.id);
      assert.equal(check, null);

      const deleteAgain = deleteSticker(added.id);
      assert.equal(deleteAgain, false);
    });

    it('getRandomStickerByMood mengembalikan stiker acak sesuai mood atau null jika tidak ada', () => {
      addSticker({ fileId: TEST_FILE_1, mood: 'kaget', emoji: '😱' });
      addSticker({ fileId: TEST_FILE_2, mood: 'kaget', emoji: '😲' });

      const sticker = getRandomStickerByMood('kaget');
      assert.ok(sticker);
      assert.equal(sticker.mood, 'kaget');
      assert.ok([TEST_FILE_1, TEST_FILE_2].includes(sticker.file_id));

      const none = getRandomStickerByMood('lelah');
      assert.equal(none, null);
    });

    it('getStickersCountByMood dan getTotalStickersCount menghitung jumlah stiker', () => {
      addSticker({ fileId: TEST_FILE_1, mood: 'senang' });
      addSticker({ fileId: TEST_FILE_2, mood: 'senang' });
      addSticker({ fileId: TEST_FILE_3, mood: 'sedih' });

      const counts = getStickersCountByMood();
      const senangCount = counts.find((c) => c.mood === 'senang')?.count;
      const sedihCount = counts.find((c) => c.mood === 'sedih')?.count;
      const kesalCount = counts.find((c) => c.mood === 'kesal')?.count;

      assert.equal(senangCount, 2);
      assert.equal(sedihCount, 1);
      assert.equal(kesalCount, 0);

      assert.ok(getTotalStickersCount() >= 3);
    });
  });

  describe('State Mode Admin /addsticker', () => {
    it('mengaktifkan, mengambil, dan membatalkan mode admin addsticker', () => {
      setAdminAddStickerMode(ADMIN_USER_ID, 'malu');
      const mode = getAdminAddStickerMode(ADMIN_USER_ID);
      assert.ok(mode);
      assert.equal(mode.mood, 'malu');

      clearAdminAddStickerMode(ADMIN_USER_ID);
      assert.equal(getAdminAddStickerMode(ADMIN_USER_ID), null);
    });

    it('menolak setAdminAddStickerMode dengan mood tidak valid', () => {
      assert.throws(() => setAdminAddStickerMode(ADMIN_USER_ID, 'invalid_mood'));
    });
  });

  describe('Perintah Fitur (Commands)', () => {
    it('/addsticker oleh admin mengaktifkan mode tambah stiker', async () => {
      const replies = [];
      const ctx = {
        from: { id: ADMIN_USER_ID },
        message: { text: '/addsticker senang' },
        reply: async (text) => replies.push(text),
      };

      const cmd = stickersFeature.commands.find((c) => c.name === 'addsticker');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].includes('senang'));
      const active = getAdminAddStickerMode(ADMIN_USER_ID);
      assert.equal(active?.mood, 'senang');
    });

    it('/addsticker oleh non-admin ditolak secara diam (silent rejection)', async () => {
      const replies = [];
      const ctx = {
        from: { id: NORMAL_USER_ID },
        message: { text: '/addsticker senang' },
        reply: async (text) => replies.push(text),
      };

      const cmd = stickersFeature.commands.find((c) => c.name === 'addsticker');
      assert.equal(cmd.adminOnly, true);
      await cmd.handler(ctx);

      assert.equal(replies.length, 0);
      assert.equal(getAdminAddStickerMode(NORMAL_USER_ID), null);
    });

    it('/addsticker dengan format salah membalas petunjuk pilihan mood', async () => {
      const replies = [];
      const ctx = {
        from: { id: ADMIN_USER_ID },
        message: { text: '/addsticker' },
        reply: async (text) => replies.push(text),
      };

      const cmd = stickersFeature.commands.find((c) => c.name === 'addsticker');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].includes('Pilihan mood'));
      assert.ok(replies[0].includes('senang'));
    });

    it('/cancelsticker membatalkan mode tambah stiker aktif', async () => {
      setAdminAddStickerMode(ADMIN_USER_ID, 'semangat');
      const replies = [];
      const ctx = {
        from: { id: ADMIN_USER_ID },
        reply: async (text) => replies.push(text),
      };

      const cmd = stickersFeature.commands.find((c) => c.name === 'cancelsticker');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].includes('dibatalkan'));
      assert.equal(getAdminAddStickerMode(ADMIN_USER_ID), null);
    });

    it('/stickers menampilkan daftar koleksi stiker', async () => {
      addSticker({ fileId: TEST_FILE_1, mood: 'kesal' });
      const replies = [];
      const ctx = {
        from: { id: ADMIN_USER_ID },
        reply: async (text, opts) => replies.push({ text, opts }),
      };

      const cmd = stickersFeature.commands.find((c) => c.name === 'stickers');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].text.includes('Koleksi Stiker Reaksi'));
      assert.ok(replies[0].text.includes('kesal'));
    });

    it('/delsticker menghapus stiker dan menolak non-admin secara diam', async () => {
      const added = addSticker({ fileId: TEST_FILE_1, mood: 'bingung' });

      // Non-admin ditolak
      const unauthReplies = [];
      const nonAdminCtx = {
        from: { id: NORMAL_USER_ID },
        message: { text: `/delsticker ${added.id}` },
        reply: async (text) => unauthReplies.push(text),
      };
      const cmd = stickersFeature.commands.find((c) => c.name === 'delsticker');
      assert.equal(cmd.adminOnly, true);
      await cmd.handler(nonAdminCtx);
      assert.equal(unauthReplies.length, 0);

      // Admin berhasil
      const adminReplies = [];
      const adminCtx = {
        from: { id: ADMIN_USER_ID },
        message: { text: `/delsticker ${added.id}` },
        reply: async (text) => adminReplies.push(text),
      };
      await cmd.handler(adminCtx);
      assert.ok(adminReplies[0].includes('berhasil dihapus'));
      assert.equal(getStickerById(added.id), null);
    });
  });

  describe('Tag Aksi [STICKER: mood] & Mutual Exclusivity', () => {
    it('extractActions mengekstrak tag STICKER secara bersih', () => {
      const raw = 'I-iya deh, dasar bodoh! 😳\n[STICKER: malu]';
      const { text, actions } = extractActions(raw, stickersFeature.tags);

      assert.equal(text, 'I-iya deh, dasar bodoh! 😳');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].name, 'STICKER');
      assert.deepEqual(actions[0].args, ['malu']);
    });

    it('handler tag STICKER memanggil ctx.replyWithSticker jika stiker tersedia', async () => {
      addSticker({ fileId: TEST_FILE_1, mood: 'senang' });
      const stickersSent = [];
      const ctx = {
        replyWithSticker: async (fileId) => stickersSent.push(fileId),
      };

      const tagDef = stickersFeature.tags.find((t) => t.name === 'STICKER');
      await tagDef.handle(ctx, ['senang']);

      assert.equal(stickersSent.length, 1);
      assert.equal(stickersSent[0], TEST_FILE_1);
    });

    it('handler tag STICKER diam (silent no-op) jika tidak ada stiker untuk mood itu', async () => {
      const stickersSent = [];
      const ctx = {
        replyWithSticker: async (fileId) => stickersSent.push(fileId),
      };

      const tagDef = stickersFeature.tags.find((t) => t.name === 'STICKER');
      await tagDef.handle(ctx, ['bingung']);

      assert.equal(stickersSent.length, 0);
    });

    it('memastikan prompt mengandung aturan tidak mengeluarkan STICKER dan GIF bersamaan', () => {
      const dummyPersona = { systemPrompt: 'Kamu Mika.' };
      const ctx = { chat: { id: 123 }, from: { id: 123, first_name: 'Test' } };
      const allTags = [
        { name: 'GIF', promptHint: 'Animasi GIF reaksi' },
        ...stickersFeature.tags,
      ];

      const prompt = buildSystemPrompt({
        persona: dummyPersona,
        tags: allTags,
        ctx,
      });

      assert.ok(prompt.includes('[STICKER: ...]'));
      assert.ok(prompt.includes('[GIF: ...]'));
      assert.ok(prompt.includes('JANGAN pernah mengeluarkan tag [GIF: ...] dan [STICKER: ...] secara bersamaan'));
    });
  });
});

