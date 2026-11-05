import './setup.js';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/core/db.js';
import {
  parseHabitArgs,
  dateStrToEpochDay,
  addHabit,
  deleteHabit,
  getHabitById,
  calculateStreaks,
  logHabit,
  getUserHabitsWithStatus,
  processHabitReminders,
} from '../src/core/habits.js';
import habitsFeature from '../src/features/habits.js';

const TEST_USER_HABIT = 7776611;

describe('F-44: Habit Tracker dan Streak Harian', () => {
  const db = getDb();

  beforeEach(() => {
    // Bersihkan data tes
    const habitIds = db
      .prepare(`SELECT id FROM habits WHERE user_id = ?`)
      .all(TEST_USER_HABIT)
      .map((r) => r.id);

    if (habitIds.length > 0) {
      const placeholders = habitIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM habit_logs WHERE habit_id IN (${placeholders})`).run(
        ...habitIds,
      );
    }
    db.prepare(`DELETE FROM habits WHERE user_id = ?`).run(TEST_USER_HABIT);
  });

  afterEach(() => {
    const habitIds = db
      .prepare(`SELECT id FROM habits WHERE user_id = ?`)
      .all(TEST_USER_HABIT)
      .map((r) => r.id);

    if (habitIds.length > 0) {
      const placeholders = habitIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM habit_logs WHERE habit_id IN (${placeholders})`).run(
        ...habitIds,
      );
    }
    db.prepare(`DELETE FROM habits WHERE user_id = ?`).run(TEST_USER_HABIT);
  });

  describe('Parser Argumen & Helper Tanggal', () => {
    it('mem-parse nama dan waktu pengingat dengan format berbeda', () => {
      const p1 = parseHabitArgs('Minum air 2L 08:00');
      assert.equal(p1.name, 'Minum air 2L');
      assert.equal(p1.remindTime, '08:00');

      const p2 = parseHabitArgs('Baca buku 21.30');
      assert.equal(p2.name, 'Baca buku');
      assert.equal(p2.remindTime, '21:30');

      const p3 = parseHabitArgs('Olahraga pagi');
      assert.equal(p3.name, 'Olahraga pagi');
      assert.equal(p3.remindTime, null);
    });

    it('menolak nama kebiasaan kosong atau terlalu panjang', () => {
      assert.throws(() => parseHabitArgs(''), /tidak boleh kosong/);
      assert.throws(() => parseHabitArgs('   '), /tidak boleh kosong/);
      assert.throws(() => parseHabitArgs('a'.repeat(101)), /maksimal 100/);
    });

    it('dateStrToEpochDay mengonversi tanggal kalender secara konsisten', () => {
      const d1 = dateStrToEpochDay('2026-11-05');
      const d2 = dateStrToEpochDay('2026-11-06');
      assert.equal(d2 - d1, 1);

      // Pergantian bulan dan tahun kabisat
      const leap1 = dateStrToEpochDay('2024-02-28');
      const leap2 = dateStrToEpochDay('2024-02-29');
      const leap3 = dateStrToEpochDay('2024-03-01');
      assert.equal(leap2 - leap1, 1);
      assert.equal(leap3 - leap2, 1);

      assert.equal(dateStrToEpochDay('format-salah'), null);
    });
  });

  describe('CRUD Kebiasaan (Habits)', () => {
    it('menambah kebiasaan baru dan menyimpannya di database', () => {
      const habit = addHabit({
        userId: TEST_USER_HABIT,
        name: 'Meditasi',
        remindTime: '06:00',
      });

      assert.ok(habit.id > 0);
      assert.equal(habit.name, 'Meditasi');
      assert.equal(habit.remindTime, '06:00');

      const fetched = getHabitById(habit.id, TEST_USER_HABIT);
      assert.equal(fetched.name, 'Meditasi');
    });

    it('menghapus kebiasaan beserta riwayat logs terkait', () => {
      const habit = addHabit({
        userId: TEST_USER_HABIT,
        name: 'Tidur cepat 22:00',
      });

      logHabit({
        habitId: habit.id,
        userId: TEST_USER_HABIT,
        dateStr: '2026-11-05',
        status: 'done',
      });

      const deleted = deleteHabit(habit.id, TEST_USER_HABIT);
      assert.equal(deleted, true);

      assert.equal(getHabitById(habit.id), null);
      const remainingLogs = db
        .prepare(`SELECT * FROM habit_logs WHERE habit_id = ?`)
        .all(habit.id);
      assert.equal(remainingLogs.length, 0);
    });
  });

  describe('Perhitungan Streak (Current & Longest)', () => {
    it('mengembalikan streak 0 jika belum ada log', () => {
      const habit = addHabit({ userId: TEST_USER_HABIT, name: 'Stretching' });
      const streaks = calculateStreaks(habit.id, '2026-11-05');
      assert.equal(streaks.currentStreak, 0);
      assert.equal(streaks.longestStreak, 0);
    });

    it('menghitung streak 1 jika diselesaikan hari ini', () => {
      const habit = addHabit({ userId: TEST_USER_HABIT, name: 'Minum vitamin' });
      logHabit({
        habitId: habit.id,
        userId: TEST_USER_HABIT,
        dateStr: '2026-11-05',
        status: 'done',
      });

      const streaks = calculateStreaks(habit.id, '2026-11-05');
      assert.equal(streaks.currentStreak, 1);
      assert.equal(streaks.longestStreak, 1);
    });

    it('menjaga streak tetap hidup jika kemarin selesai walau hari ini belum', () => {
      const habit = addHabit({ userId: TEST_USER_HABIT, name: 'Coding' });
      // Selesai tanggal 2026-11-04 (kemarin)
      logHabit({
        habitId: habit.id,
        userId: TEST_USER_HABIT,
        dateStr: '2026-11-04',
        status: 'done',
      });

      // Diperiksa pada tanggal 2026-11-05 (hari ini belum dikerjakan)
      const streaks = calculateStreaks(habit.id, '2026-11-05');
      assert.equal(streaks.currentStreak, 1);
      assert.equal(streaks.longestStreak, 1);
    });

    it('memutuskan streak jika kemarin tidak diselesaikan', () => {
      const habit = addHabit({ userId: TEST_USER_HABIT, name: 'Journaling' });
      // Selesai tanggal 2026-11-03 (2 hari lalu), kemarin (04) terlewat
      logHabit({
        habitId: habit.id,
        userId: TEST_USER_HABIT,
        dateStr: '2026-11-03',
        status: 'done',
      });

      // Hari ini 2026-11-05
      const streaks = calculateStreaks(habit.id, '2026-11-05');
      assert.equal(streaks.currentStreak, 0);
      assert.equal(streaks.longestStreak, 1);
    });

    it('menghitung akumulasi streak berurutan bertahap dan mempertahankan rekor', () => {
      const habit = addHabit({ userId: TEST_USER_HABIT, name: 'Olahraga' });
      const dates = [
        '2026-11-01',
        '2026-11-02',
        '2026-11-03',
        '2026-11-04',
        '2026-11-05',
      ];

      for (const d of dates) {
        logHabit({
          habitId: habit.id,
          userId: TEST_USER_HABIT,
          dateStr: d,
          status: 'done',
        });
      }

      const streaks = calculateStreaks(habit.id, '2026-11-05');
      assert.equal(streaks.currentStreak, 5);
      assert.equal(streaks.longestStreak, 5);
    });

    it('status skipped tidak menambah streak', () => {
      const habit = addHabit({ userId: TEST_USER_HABIT, name: 'Belajar Kanji' });
      logHabit({
        habitId: habit.id,
        userId: TEST_USER_HABIT,
        dateStr: '2026-11-05',
        status: 'skipped',
      });

      const streaks = calculateStreaks(habit.id, '2026-11-05');
      assert.equal(streaks.currentStreak, 0);
    });

    it('logHabit melakukan update jika tanggal sama dicatat ulang', () => {
      const habit = addHabit({ userId: TEST_USER_HABIT, name: 'Puasa' });
      logHabit({
        habitId: habit.id,
        userId: TEST_USER_HABIT,
        dateStr: '2026-11-05',
        status: 'skipped',
      });
      assert.equal(calculateStreaks(habit.id, '2026-11-05').currentStreak, 0);

      // Ubah jadi 'done'
      logHabit({
        habitId: habit.id,
        userId: TEST_USER_HABIT,
        dateStr: '2026-11-05',
        status: 'done',
      });
      assert.equal(calculateStreaks(habit.id, '2026-11-05').currentStreak, 1);
    });
  });

  describe('getUserHabitsWithStatus', () => {
    it('mengambil daftar kebiasaan user beserta status hari ini', () => {
      const habit = addHabit({
        userId: TEST_USER_HABIT,
        name: 'Minum air',
        remindTime: '08:00',
      });

      const listBefore = getUserHabitsWithStatus(TEST_USER_HABIT, 'Asia/Jakarta');
      assert.equal(listBefore.length, 1);
      assert.equal(listBefore[0].todayStatus, 'pending');

      logHabit({
        habitId: habit.id,
        userId: TEST_USER_HABIT,
        dateStr: '2026-11-05',
        status: 'done',
      });

      const listAfter = getUserHabitsWithStatus(
        TEST_USER_HABIT,
        'Asia/Jakarta',
        new Date('2026-11-05T10:00:00+07:00'),
      );
      assert.equal(listAfter[0].todayStatus, 'done');
      assert.equal(listAfter[0].currentStreak, 1);
    });
  });

  describe('Scheduler Pengingat Kebiasaan', () => {
    it('mengirim pengingat jika jam tercapai dan belum dicatat hari ini', async () => {
      const habit = addHabit({
        userId: TEST_USER_HABIT,
        name: 'Minum suplemen',
        remindTime: '09:00',
      });

      const messagesSent = [];
      const mockBot = {
        api: {
          sendMessage: async (chatId, text, options) => {
            messagesSent.push({ chatId, text, options });
          },
        },
      };

      // Simulasikan waktu jam 09:15 WIB pada 2026-11-05
      const nowMs = new Date('2026-11-05T09:15:00+07:00').getTime();
      const count = await processHabitReminders(mockBot, nowMs);

      assert.equal(count, 1);
      assert.equal(messagesSent.length, 1);
      assert.ok(messagesSent[0].text.includes('Pengingat Kebiasaan'));
      assert.ok(messagesSent[0].text.includes('Minum suplemen'));
      assert.ok(messagesSent[0].options.reply_markup);

      // Cek apakah last_remind_date ter-update
      const updated = getHabitById(habit.id);
      assert.equal(updated.last_remind_date, '2026-11-05');

      // Putaran kedua di hari yang sama tidak boleh mengirim ulang
      const count2 = await processHabitReminders(mockBot, nowMs + 60_000);
      assert.equal(count2, 0);
    });

    it('tidak mengirim pengingat jika kebiasaan sudah selesai hari ini', async () => {
      const habit = addHabit({
        userId: TEST_USER_HABIT,
        name: 'Olahraga teratur',
        remindTime: '07:00',
      });

      // Sudah dicatat sebelum jam pengingat tiba
      logHabit({
        habitId: habit.id,
        userId: TEST_USER_HABIT,
        dateStr: '2026-11-05',
        status: 'done',
      });

      const messagesSent = [];
      const mockBot = {
        api: {
          sendMessage: async (chatId, text, options) => {
            messagesSent.push({ chatId, text, options });
          },
        },
      };

      const nowMs = new Date('2026-11-05T07:30:00+07:00').getTime();
      const count = await processHabitReminders(mockBot, nowMs);

      assert.equal(count, 0);
      assert.equal(messagesSent.length, 0);
    });
  });

  describe('Feature Commands & Callbacks & Tags', () => {
    it('/habits menampilkan panduan jika belum ada kebiasaan', async () => {
      const habitsCmd = habitsFeature.commands.find((c) => c.name === 'habits');
      let replyText = '';
      const ctx = {
        from: { id: TEST_USER_HABIT },
        reply: async (t) => {
          replyText = t;
        },
      };

      await habitsCmd.handler(ctx);
      assert.ok(replyText.includes('belum memiliki daftar kebiasaan'));
    });

    it('/habit add membuat kebiasaan baru', async () => {
      const habitCmd = habitsFeature.commands.find((c) => c.name === 'habit');
      let replyText = '';
      const ctx = {
        from: { id: TEST_USER_HABIT },
        message: { text: '/habit add Jalan kaki 30 menit 06:30' },
        reply: async (t) => {
          replyText = t;
        },
      };

      await habitCmd.handler(ctx);
      assert.ok(replyText.includes('Kebiasaan baru dicatat'));
      assert.ok(replyText.includes('Jalan kaki 30 menit'));
      assert.ok(replyText.includes('06:30'));
    });

    it('/habit done menandai kebiasaan selesai', async () => {
      const habit = addHabit({ userId: TEST_USER_HABIT, name: 'Minum madu' });
      const habitCmd = habitsFeature.commands.find((c) => c.name === 'habit');

      let replyText = '';
      const ctx = {
        from: { id: TEST_USER_HABIT },
        message: { text: `/habit done ${habit.id}` },
        reply: async (t) => {
          replyText = t;
        },
      };

      await habitCmd.handler(ctx);
      assert.ok(replyText.includes('Minum madu'));
      assert.ok(replyText.includes('Streak:'));
    });

    it('/habit skip menandai kebiasaan dilewati', async () => {
      const habit = addHabit({ userId: TEST_USER_HABIT, name: 'Lari pagi' });
      const habitCmd = habitsFeature.commands.find((c) => c.name === 'habit');

      let replyText = '';
      const ctx = {
        from: { id: TEST_USER_HABIT },
        message: { text: `/habit skip ${habit.id}` },
        reply: async (t) => {
          replyText = t;
        },
      };

      await habitCmd.handler(ctx);
      assert.ok(replyText.includes('dilewati'));
    });

    it('/delhabit menghapus kebiasaan', async () => {
      const habit = addHabit({ userId: TEST_USER_HABIT, name: 'Hapus tes' });
      const delCmd = habitsFeature.commands.find((c) => c.name === 'delhabit');

      let replyText = '';
      const ctx = {
        from: { id: TEST_USER_HABIT },
        message: { text: `/delhabit ${habit.id}` },
        reply: async (t) => {
          replyText = t;
        },
      };

      await delCmd.handler(ctx);
      assert.ok(replyText.includes('berhasil dihapus'));
      assert.equal(getHabitById(habit.id), null);
    });

    it('callback hbt:done dan hbt:skip memproses tombol inline', async () => {
      const habit = addHabit({ userId: TEST_USER_HABIT, name: 'Tombol habit' });
      const callbackDef = habitsFeature.callbacks.find((c) => c.prefix === 'hbt:');
      assert.ok(callbackDef);

      let answered = '';
      let editedText = '';
      const ctx = {
        from: { id: TEST_USER_HABIT },
        callbackQuery: { data: `hbt:done:${habit.id}:2026-11-05` },
        answerCallbackQuery: async ({ text }) => {
          answered = text;
        },
        editMessageText: async (text) => {
          editedText = text;
        },
      };

      await callbackDef.handler(ctx);
      assert.ok(answered.includes('Streak: 1 hari'));
      assert.ok(editedText.includes('Tombol habit'));
    });

    it('tags [HABIT_ADD: ...] dan [HABIT_LOG: ...] memproses aksi natural LLM', async () => {
      const addTag = habitsFeature.tags.find((t) => t.name === 'HABIT_ADD');
      const logTag = habitsFeature.tags.find((t) => t.name === 'HABIT_LOG');
      assert.ok(addTag);
      assert.ok(logTag);

      let replyAdd = '';
      const ctxAdd = {
        from: { id: TEST_USER_HABIT },
        reply: async (t) => {
          replyAdd = t;
        },
      };

      await addTag.handle(ctxAdd, ['Belajar Bahasa Jepang', '20:00']);
      assert.ok(replyAdd.includes('Belajar Bahasa Jepang'));

      const habits = getUserHabitsWithStatus(TEST_USER_HABIT, 'Asia/Jakarta');
      assert.equal(habits.length, 1);
      const habitId = habits[0].id;

      let replyLog = '';
      const ctxLog = {
        from: { id: TEST_USER_HABIT },
        reply: async (t) => {
          replyLog = t;
        },
      };

      await logTag.handle(ctxLog, [String(habitId), 'done']);
      assert.ok(replyLog.includes('selesai hari ini'));
    });
  });
});

