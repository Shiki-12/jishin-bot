import './setup.js';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/core/db.js';
import {
  computeLevel,
  getAffinity,
  recordInteraction,
  DAILY_POINTS_CAP,
  POINTS_PER_INTERACTION,
} from '../src/core/affinity.js';
import affinityFeature, {
  buildProgressBar,
  renderStatusCard,
} from '../src/features/affinity.js';
import { buildSystemPrompt } from '../src/core/actions.js';

describe('F-20: Sistem Affinity (Level "Dere")', () => {
  const TEST_USER = 440011;
  const TZ = 'Asia/Jakarta';

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM affinity WHERE user_id = ?').run(TEST_USER);
  });

  after(() => {
    const db = getDb();
    db.prepare('DELETE FROM affinity WHERE user_id = ?').run(TEST_USER);
  });

  describe('Level Thresholds & computeLevel', () => {
    it('menghitung level berdasarkan poin secara tepat', () => {
      assert.equal(computeLevel(0), 0);
      assert.equal(computeLevel(19), 0);
      assert.equal(computeLevel(20), 1);
      assert.equal(computeLevel(49), 1);
      assert.equal(computeLevel(50), 2);
      assert.equal(computeLevel(99), 2);
      assert.equal(computeLevel(100), 3);
      assert.equal(computeLevel(199), 3);
      assert.equal(computeLevel(200), 4);
      assert.equal(computeLevel(500), 4);
    });
  });

  describe('Pencatatan Poin & Batas Harian (Anti-Farming)', () => {
    it('menambah poin saat interaksi', () => {
      const now = Date.now();
      const res = recordInteraction(TEST_USER, TZ, now);
      assert.equal(res.points, POINTS_PER_INTERACTION);
      assert.equal(res.gainedToday, POINTS_PER_INTERACTION);
      assert.equal(res.level, 0);

      const aff = getAffinity(TEST_USER, TZ, now);
      assert.equal(aff.points, POINTS_PER_INTERACTION);
      assert.equal(aff.gainedToday, POINTS_PER_INTERACTION);
    });

    it('membatasi penambahan poin maksimal sesuai DAILY_POINTS_CAP', () => {
      const now = Date.now();
      // Lakukan 10 interaksi (10 * 2 = 20 poin potensi), harus dibatasi ke DAILY_POINTS_CAP (15)
      for (let i = 0; i < 10; i++) {
        recordInteraction(TEST_USER, TZ, now);
      }

      const aff = getAffinity(TEST_USER, TZ, now);
      assert.equal(aff.points, DAILY_POINTS_CAP);
      assert.equal(aff.gainedToday, DAILY_POINTS_CAP);

      // Interaksi berikutnya di hari yang sama tidak menambah poin
      const extra = recordInteraction(TEST_USER, TZ, now);
      assert.equal(extra.addedPoints, 0);
      assert.equal(extra.points, DAILY_POINTS_CAP);
    });

    it('mereset gainedToday saat berganti hari', () => {
      const day1 = Date.parse('2026-11-04T12:00:00.000Z');
      const day2 = Date.parse('2026-11-05T12:00:00.000Z');

      // Hari 1: cap penuh
      for (let i = 0; i < 10; i++) {
        recordInteraction(TEST_USER, TZ, day1);
      }
      const aff1 = getAffinity(TEST_USER, TZ, day1);
      assert.equal(aff1.points, DAILY_POINTS_CAP);
      assert.equal(aff1.gainedToday, DAILY_POINTS_CAP);

      // Hari 2: gainedToday kembali 0, poin tetap 15
      const aff2 = getAffinity(TEST_USER, TZ, day2);
      assert.equal(aff2.points, DAILY_POINTS_CAP);
      assert.equal(aff2.gainedToday, 0);

      // Tambah poin di Hari 2
      const res2 = recordInteraction(TEST_USER, TZ, day2);
      assert.equal(res2.points, DAILY_POINTS_CAP + POINTS_PER_INTERACTION);
      assert.equal(res2.gainedToday, POINTS_PER_INTERACTION);
    });
  });

  describe('Peluruhan Sangat Lambat (Gentle Decay)', () => {
    it('tidak berkurang jika tidak aktif kurang dari 7 hari', () => {
      const now = Date.now();
      const db = getDb();
      db.prepare(
        `INSERT INTO affinity (user_id, points, level, last_gain_date, gained_today, last_chat_at)
         VALUES (?, 50, 2, '2026-11-01', 0, ?)`,
      ).run(TEST_USER, now - 6 * 24 * 3600_000); // 6 hari lalu

      const aff = getAffinity(TEST_USER, TZ, now);
      assert.equal(aff.points, 50);
      assert.equal(aff.level, 2);
    });

    it('berkurang 1 poin per 7 hari tanpa interaksi', () => {
      const now = Date.now();
      const db = getDb();
      // 15 hari lalu -> 2 minggu penuh = berkurang 2 poin
      db.prepare(
        `INSERT INTO affinity (user_id, points, level, last_gain_date, gained_today, last_chat_at)
         VALUES (?, 50, 2, '2026-10-20', 0, ?)`,
      ).run(TEST_USER, now - 15 * 24 * 3600_000);

      const aff = getAffinity(TEST_USER, TZ, now);
      assert.equal(aff.points, 48);
    });
  });

  describe('Progress Bar & Status Card', () => {
    it('buildProgressBar menampilkan visual blok dan poin', () => {
      const bar = buildProgressBar(10, 0, 20);
      assert.ok(bar.includes('10/20'));
      assert.ok(bar.includes('█'));
      assert.ok(bar.includes('░'));

      const maxBar = buildProgressBar(250, 200, null);
      assert.ok(maxBar.includes('Level Maksimal'));
    });

    it('renderStatusCard menyertakan level, bar, poin hari ini, dan kutipan persona', () => {
      const aff = {
        level: 2,
        title: 'Mulai luluh',
        points: 65,
        gainedToday: 6,
        dailyCap: 15,
      };

      const dummyPersona = {
        strings: {
          affinityStatus: [
            'Quote 0',
            'Quote 1',
            'Hmph, jangan geer! Aku cuma udah agak terbiasa.',
            'Quote 3',
            'Quote 4',
          ],
        },
      };

      const card = renderStatusCard(aff, dummyPersona);
      assert.ok(card.includes('Level: *2* — *"Mulai luluh"*'));
      assert.ok(card.includes('Total Poin: *65* poin'));
      assert.ok(card.includes('6/15'));
      assert.ok(card.includes('Hmph, jangan geer!'));
    });
  });

  describe('Injeksi System Prompt & Perintah /status', () => {
    it('buildSystemPrompt otomatis menyertakan level affinity user', () => {
      const db = getDb();
      db.prepare(
        `INSERT INTO affinity (user_id, points, level, last_gain_date, gained_today, last_chat_at)
         VALUES (?, 120, 3, '2026-11-05', 4, ?)`,
      ).run(TEST_USER, Date.now());

      const ctx = {
        chat: { id: TEST_USER, type: 'private' },
        from: { id: TEST_USER, first_name: 'Adit' },
      };

      const prompt = buildSystemPrompt({
        persona: { systemPrompt: 'Kamu adalah Mika.' },
        ctx,
      });

      assert.ok(prompt.includes('## Level Kedekatan (Affinity)'));
      assert.ok(prompt.includes('Level 3'));
      assert.ok(prompt.includes('Malu-malu perhatian'));
    });

    it('/status membalas kartu status affinity', async () => {
      const replies = [];
      const ctx = {
        chat: { id: TEST_USER, type: 'private' },
        from: { id: TEST_USER },
        reply: async (text, opts) => replies.push({ text, opts }),
      };

      const cmd = affinityFeature.commands.find((c) => c.name === 'status');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].text.includes('Status Hubungan & Kedekatan'));
      assert.ok(replies[0].text.includes('Jutek banget'));
    });
  });

  describe('Proteksi Poin: Perintah Slash vs Obrolan Biasa', () => {
    it('perintah slash (/start, /status, /about, dll) tidak menambah poin affinity', async () => {
      const now = Date.now();
      const initialAff = getAffinity(TEST_USER, TZ, now);
      assert.equal(initialAff.points, 0);

      // 1. Jalankan /status
      const statusCmd = affinityFeature.commands.find((c) => c.name === 'status');
      await statusCmd.handler({
        chat: { id: TEST_USER, type: 'private' },
        from: { id: TEST_USER },
        reply: async () => {},
      });

      const affAfterStatus = getAffinity(TEST_USER, TZ, now);
      assert.equal(affAfterStatus.points, 0, '/status tidak boleh menambah poin affinity');

      // 2. Jalankan perintah slash lain seperti /start atau /about
      const coreModule = await import('../src/features/core.js');
      const coreCommands = coreModule.default.commands;
      const startCmd = coreCommands.find((c) => c.name === 'start');
      const aboutCmd = coreCommands.find((c) => c.name === 'about');

      await startCmd.handler({
        chat: { id: TEST_USER, type: 'private' },
        from: { id: TEST_USER },
        reply: async () => {},
      });
      await aboutCmd.handler({
        chat: { id: TEST_USER, type: 'private' },
        from: { id: TEST_USER },
        reply: async () => {},
      });

      const affAfterSlash = getAffinity(TEST_USER, TZ, now);
      assert.equal(affAfterSlash.points, 0, 'perintah slash apapun tidak boleh menambah poin affinity');

      // 3. Hanya obrolan biasa (recordInteraction yang dipanggil LLM pipeline) yang menambah poin
      const chatRes = recordInteraction(TEST_USER, TZ, now);
      assert.equal(chatRes.points, POINTS_PER_INTERACTION);
      const affAfterChat = getAffinity(TEST_USER, TZ, now);
      assert.equal(affAfterChat.points, POINTS_PER_INTERACTION, 'hanya obrolan biasa yang menambah poin');
    });
  });
});

