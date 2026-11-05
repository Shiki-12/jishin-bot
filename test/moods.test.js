import './setup.js';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/core/db.js';
import {
  MOOD_LEVELS,
  hasCrisisSigns,
  formatDateStr,
  recordMood,
  getTodayMood,
  getUserMoodsLast7Days,
  deleteMood,
  renderMoodWeekSummary,
} from '../src/core/moods.js';
import moodsFeature, {
  MEDICAL_DISCLAIMER,
  CRISIS_RESPONSE,
  getPersonaMoodComment,
} from '../src/features/moods.js';
import { buildNightMessage } from '../src/features/schedules.js';
import { tsundere } from '../src/personalities/tsundere.js';

describe('F-24: Mood Check-in & Jurnal', () => {
  const TEST_USER_1 = 667701;
  const TEST_USER_2 = 667702;
  const TZ = 'Asia/Jakarta';

  function cleanupDb() {
    const db = getDb();
    db.prepare('DELETE FROM moods WHERE user_id IN (?, ?)').run(
      TEST_USER_1,
      TEST_USER_2,
    );
  }

  beforeEach(() => {
    cleanupDb();
    const db = getDb();
    db.prepare(
      `INSERT INTO users (id, first_name, username, tz, created_at)
       VALUES (?, 'TesterOne', 'tester1', 'Asia/Jakarta', ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(TEST_USER_1, Date.now());
  });

  after(() => {
    cleanupDb();
  });

  describe('Validasi & Deteksi Krisis', () => {
    it('memvalidasi rentang skor mood 1 sampai 5', () => {
      assert.throws(() => recordMood({ userId: TEST_USER_1, score: 0 }));
      assert.throws(() => recordMood({ userId: TEST_USER_1, score: 6 }));
      assert.throws(() => recordMood({ userId: TEST_USER_1, score: 'abc' }));
      assert.throws(() => recordMood({ userId: TEST_USER_1, score: 3.5 }));
    });

    it('hasCrisisSigns mendeteksi indikasi krisis keselamatan', () => {
      assert.equal(hasCrisisSigns('aku pengen bunuh diri'), true);
      assert.equal(hasCrisisSigns('mau akhiri hidup rasanya'), true);
      assert.equal(hasCrisisSigns('aku capek banget mau mati'), true);
      assert.equal(hasCrisisSigns('hari ini capek banget tapi senang'), false);
    });

    it('formatDateStr menghasilkan format tanggal YYYY-MM-DD sesuai zona waktu', () => {
      const fixedDate = new Date('2026-11-05T03:00:00.000Z'); // 10:00 WIB
      assert.equal(formatDateStr(fixedDate.getTime(), TZ), '2026-11-05');
    });
  });

  describe('Operasi Database (CRUD & Isolasi User)', () => {
    it('recordMood menyimpan skor, catatan, dan tanggal', () => {
      const saved = recordMood({
        userId: TEST_USER_1,
        score: 4,
        note: 'Pekerjaan selesai tepat waktu',
        tz: TZ,
      });

      assert.ok(saved.id);
      assert.equal(saved.user_id, TEST_USER_1);
      assert.equal(saved.score, 4);
      assert.equal(saved.note, 'Pekerjaan selesai tepat waktu');
      assert.equal(saved.date_str, formatDateStr(Date.now(), TZ));
    });

    it('getTodayMood mengambil entri mood terbaru hari ini', () => {
      const now = Date.now();
      recordMood({ userId: TEST_USER_1, score: 2, note: 'pagi lemas', tz: TZ, now: now - 3600_000 });
      recordMood({ userId: TEST_USER_1, score: 4, note: 'siang membaik', tz: TZ, now });

      const today = getTodayMood(TEST_USER_1, TZ, now);
      assert.ok(today);
      assert.equal(today.score, 4);
      assert.equal(today.note, 'siang membaik');
    });

    it('getUserMoodsLast7Days mengambil riwayat dalam 7 hari terakhir', () => {
      const now = Date.now();
      // 2 hari lalu
      recordMood({ userId: TEST_USER_1, score: 3, tz: TZ, now: now - 2 * 24 * 3600_000 });
      // 10 hari lalu (di luar 7 hari)
      recordMood({ userId: TEST_USER_1, score: 5, tz: TZ, now: now - 10 * 24 * 3600_000 });

      const rows = getUserMoodsLast7Days(TEST_USER_1, now);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].score, 3);
    });

    it('deleteMood menghapus catatan dengan isolasi user yang ketat', () => {
      const entry = recordMood({ userId: TEST_USER_1, score: 3, tz: TZ });

      // User 2 tidak bisa menghapus entri User 1
      const failDelete = deleteMood(entry.id, TEST_USER_2);
      assert.equal(failDelete, false);

      // User 1 berhasil menghapus entrinya sendiri
      const successDelete = deleteMood(entry.id, TEST_USER_1);
      assert.equal(successDelete, true);
    });
  });

  describe('Format Ringkasan & Visualisasi Mingguan', () => {
    it('renderMoodWeekSummary menghasilkan diagram visual dan rata-rata skor', () => {
      const now = Date.now();
      const mockMoods = [
        { id: 1, user_id: TEST_USER_1, score: 3, note: 'santai', date_str: '2026-11-03', created_at: now - 2 * 24 * 3600_000 },
        { id: 2, user_id: TEST_USER_1, score: 5, note: 'hebat', date_str: '2026-11-04', created_at: now - 1 * 24 * 3600_000 },
      ];

      const summary = renderMoodWeekSummary(mockMoods, TZ);
      assert.ok(summary.includes('Jurnal Mood 7 Hari Terakhir'));
      assert.ok(summary.includes('4.0'));
      assert.ok(summary.includes('███░░'));
      assert.ok(summary.includes('█████'));
      assert.ok(summary.includes('bukan pengganti diagnosis'));
    });

    it('renderMoodWeekSummary mengembalikan null jika data kosong', () => {
      assert.equal(renderMoodWeekSummary([]), null);
      assert.equal(renderMoodWeekSummary(null), null);
    });
  });

  describe('Perintah Fitur (Commands & Callbacks)', () => {
    it('/mood tanpa argumen menampilkan menu keyboard 1-5 dan disclaimer medis', async () => {
      const replies = [];
      const ctx = {
        from: { id: TEST_USER_1 },
        message: { text: '/mood' },
        reply: async (text, opts) => replies.push({ text, opts }),
      };

      const cmd = moodsFeature.commands.find((c) => c.name === 'mood');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].text.includes('Check-in Mood Harian'));
      assert.ok(replies[0].text.includes('BUKAN pengganti terapi'));
      assert.ok(replies[0].opts.reply_markup);
    });

    it('/mood dengan angka dan catatan menyimpan mood dan merespons in-character', async () => {
      const replies = [];
      const ctx = {
        from: { id: TEST_USER_1 },
        message: { text: '/mood 4 Hari ini produktif banget' },
        reply: async (text, opts) => replies.push({ text, opts }),
        persona: tsundere,
      };

      const cmd = moodsFeature.commands.find((c) => c.name === 'mood');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].text.includes('Mood Tersimpan'));
      assert.ok(replies[0].text.includes('Hari ini produktif banget'));
      assert.ok(replies[0].text.includes('BUKAN pengganti terapi'));

      const saved = getTodayMood(TEST_USER_1);
      assert.equal(saved.score, 4);
    });

    it('/mood mendeteksi krisis dalam catatan dan langsung mengembalikan kontak darurat resmi', async () => {
      const replies = [];
      const ctx = {
        from: { id: TEST_USER_1 },
        message: { text: '/mood 1 aku putus asa pengen bunuh diri aja' },
        reply: async (text) => replies.push(text),
        persona: tsundere,
      };

      const cmd = moodsFeature.commands.find((c) => c.name === 'mood');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].includes('SEJIWA'));
      assert.ok(replies[0].includes('119 (ekstensi 8)'));
      assert.ok(replies[0].includes('112'));
    });

    it('callback mood:set:<score> menyimpan mood dan mengedit pesan', async () => {
      const edits = [];
      const ctx = {
        from: { id: TEST_USER_1 },
        callbackQuery: { data: 'mood:set:5' },
        editMessageText: async (text, opts) => edits.push({ text, opts }),
        answerCallbackQuery: async () => {},
        persona: tsundere,
      };

      const cb = moodsFeature.callbacks.find((c) => c.prefix === 'mood:set:');
      await cb.handler(ctx);

      assert.equal(edits.length, 1);
      assert.ok(edits[0].text.includes('Mood Tersimpan!'));
      assert.ok(edits[0].text.includes('5/5'));

      const saved = getTodayMood(TEST_USER_1);
      assert.equal(saved.score, 5);
    });

    it('/moodweek menampilkan ringkasan 7 hari atau pesan belum ada catatan', async () => {
      // 1. Belum ada catatan
      const emptyReplies = [];
      const ctx1 = {
        from: { id: TEST_USER_1 },
        reply: async (text, opts) => emptyReplies.push({ text, opts }),
      };
      const cmd = moodsFeature.commands.find((c) => c.name === 'moodweek');
      await cmd.handler(ctx1);
      assert.ok(emptyReplies[0].text.includes('Belum ada catatan mood'));

      // 2. Ada catatan
      recordMood({ userId: TEST_USER_1, score: 4, note: 'mantap', tz: TZ });
      const filledReplies = [];
      const ctx2 = {
        from: { id: TEST_USER_1 },
        reply: async (text, opts) => filledReplies.push({ text, opts }),
      };
      await cmd.handler(ctx2);
      assert.ok(filledReplies[0].text.includes('Jurnal Mood 7 Hari Terakhir'));
      assert.ok(filledReplies[0].text.includes('mantap'));
    });
  });

  describe('Integrasi Check-in Malam (F-13)', () => {
    it('buildNightMessage menyertakan ajakan check-in mood jika belum mencatat hari ini', () => {
      const msg = buildNightMessage({
        userId: TEST_USER_1,
        tz: TZ,
        persona: tsundere,
      });

      assert.ok(msg.includes('/mood'));
      assert.ok(msg.includes('check-in perasaanmu'));
    });

    it('buildNightMessage tidak menyertakan ajakan check-in jika sudah mencatat mood hari ini', () => {
      recordMood({ userId: TEST_USER_1, score: 5, tz: TZ });

      const msg = buildNightMessage({
        userId: TEST_USER_1,
        tz: TZ,
        persona: tsundere,
      });

      assert.equal(msg.includes('check-in perasaanmu malam ini: ketik'), false);
    });
  });
});
