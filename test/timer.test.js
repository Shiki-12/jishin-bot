import './setup.js';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/core/db.js';
import {
  parseTimerDuration,
  formatDuration,
  createTimer,
  getActiveTimers,
  cancelTimer,
  getActivePomodoro,
  startPomodoro,
  stopPomodoro,
  advancePomodoro,
} from '../src/core/timer.js';
import timerFeature from '../src/features/timer.js';
import { processPendingReminders } from '../src/core/scheduler.js';

const TEST_CHAT_TIMER = 9998811;
const TEST_USER_TIMER = 8887711;

describe('F-43: Timer dan Pomodoro', () => {
  const db = getDb();

  beforeEach(() => {
    db.prepare(`DELETE FROM reminders WHERE chat_id = ?`).run(TEST_CHAT_TIMER);
  });

  afterEach(() => {
    db.prepare(`DELETE FROM reminders WHERE chat_id = ?`).run(TEST_CHAT_TIMER);
  });

  describe('Parser & Formatter Durasi Timer', () => {
    it('mem-parse berbagai format durasi yang valid', () => {
      assert.equal(parseTimerDuration('25m'), 25 * 60_000);
      assert.equal(parseTimerDuration('10menit'), 10 * 60_000);
      assert.equal(parseTimerDuration('30s'), 30_000);
      assert.equal(parseTimerDuration('45detik'), 45_000);
      assert.equal(parseTimerDuration('2j'), 2 * 3600_000);
      assert.equal(parseTimerDuration('1jam'), 1 * 3600_000);
      assert.equal(parseTimerDuration('1j30m'), 5400_000);
      assert.equal(parseTimerDuration('1j 30m 10s'), 5410_000);
      assert.equal(parseTimerDuration('45'), 45 * 60_000); // Bare number default menit
    });

    it('menolak format durasi yang tidak valid, kosong, nol, atau negatif', () => {
      assert.throws(() => parseTimerDuration(''), /tidak boleh kosong/);
      assert.throws(() => parseTimerDuration(null), /tidak boleh kosong/);
      assert.throws(() => parseTimerDuration('-5m'), /tidak boleh negatif/);
      assert.throws(() => parseTimerDuration('0m'), /tidak valid/);
      assert.throws(() => parseTimerDuration('0'), /harus lebih dari 0/);
      assert.throws(() => parseTimerDuration('kucing'), /tidak valid/);
    });

    it('menolak durasi melebihi batas maksimal 24 jam', () => {
      assert.throws(() => parseTimerDuration('25j'), /maksimal 24 jam/);
      assert.throws(() => parseTimerDuration('1500m'), /maksimal 24 jam/);
    });

    it('formatDuration menghasilkan teks representasi waktu yang rapi', () => {
      assert.equal(formatDuration(0), '0 detik');
      assert.equal(formatDuration(30_000), '30 detik');
      assert.equal(formatDuration(60_000), '1 menit');
      assert.equal(formatDuration(90_000), '1 menit 30 detik');
      assert.equal(formatDuration(3600_000), '1 jam');
      assert.equal(formatDuration(5400_000), '1 jam 30 menit');
    });
  });

  describe('Operasi Timer Dasar (create, list, cancel)', () => {
    it('membuat timer sekali jalan dan menyimpannya di reminders table', () => {
      const now = 1700000000000;
      const timer = createTimer({
        chatId: TEST_CHAT_TIMER,
        userId: TEST_USER_TIMER,
        durationMs: 15 * 60_000,
        label: 'Rebus mie',
        now,
      });

      assert.ok(timer.id > 0);
      assert.equal(timer.label, 'Rebus mie');
      assert.equal(timer.dueAt, now + 15 * 60_000);

      const active = getActiveTimers(TEST_CHAT_TIMER);
      assert.equal(active.length, 1);
      assert.equal(active[0].id, timer.id);
      assert.equal(active[0].label, 'Rebus mie');
    });

    it('membatalkan timer berdasarkan ID', () => {
      const timer = createTimer({
        chatId: TEST_CHAT_TIMER,
        userId: TEST_USER_TIMER,
        durationMs: 60_000,
        label: 'Tes cancel',
      });

      const ok = cancelTimer(timer.id, TEST_CHAT_TIMER);
      assert.equal(ok, true);

      const active = getActiveTimers(TEST_CHAT_TIMER);
      assert.equal(active.length, 0);

      // Cancel timer yang sudah dibatalkan mengembalikan false
      assert.equal(cancelTimer(timer.id, TEST_CHAT_TIMER), false);
    });
  });

  describe('Pomodoro Engine', () => {
    it('memulai sesi pomodoro dengan parameter default (25/5, 4 siklus)', () => {
      const now = 1700000000000;
      const pom = startPomodoro({
        chatId: TEST_CHAT_TIMER,
        userId: TEST_USER_TIMER,
        now,
      });

      assert.equal(pom.cycle, 1);
      assert.equal(pom.totalCycles, 4);
      assert.equal(pom.workMin, 25);
      assert.equal(pom.breakMin, 5);
      assert.equal(pom.dueAt, now + 25 * 60_000);

      const active = getActivePomodoro(TEST_CHAT_TIMER);
      assert.ok(active);
      assert.equal(active.phase, 'work');
      assert.equal(active.cycle, 1);
      assert.equal(active.totalCycles, 4);
    });

    it('menolak memulai pomodoro jika sudah ada sesi yang berjalan', () => {
      startPomodoro({ chatId: TEST_CHAT_TIMER, userId: TEST_USER_TIMER });
      assert.throws(
        () => startPomodoro({ chatId: TEST_CHAT_TIMER, userId: TEST_USER_TIMER }),
        /Sesi Pomodoro sudah berjalan di chat ini/,
      );
    });

    it('memvalidasi batasan parameter work, break, dan cycles', () => {
      assert.throws(
        () =>
          startPomodoro({
            chatId: TEST_CHAT_TIMER,
            userId: TEST_USER_TIMER,
            workMin: 0,
          }),
        /Durasi fokus/,
      );
      assert.throws(
        () =>
          startPomodoro({
            chatId: TEST_CHAT_TIMER,
            userId: TEST_USER_TIMER,
            breakMin: 70,
          }),
        /Durasi istirahat/,
      );
      assert.throws(
        () =>
          startPomodoro({
            chatId: TEST_CHAT_TIMER,
            userId: TEST_USER_TIMER,
            cycles: 20,
          }),
        /Jumlah siklus Pomodoro/,
      );
    });

    it('menghentikan pomodoro aktif dengan stopPomodoro', () => {
      startPomodoro({ chatId: TEST_CHAT_TIMER, userId: TEST_USER_TIMER });
      assert.ok(getActivePomodoro(TEST_CHAT_TIMER));

      const ok = stopPomodoro(TEST_CHAT_TIMER);
      assert.equal(ok, true);
      assert.equal(getActivePomodoro(TEST_CHAT_TIMER), null);
    });

    it('advancePomodoro memajukan siklus dari fokus ke istirahat lalu ke fokus berikutnya hingga tuntas', () => {
      const now = 1700000000000;
      // Mulai pomodoro 2 siklus: 25/5
      startPomodoro({
        chatId: TEST_CHAT_TIMER,
        userId: TEST_USER_TIMER,
        workMin: 25,
        breakMin: 5,
        cycles: 2,
        now,
      });

      // 1. Ambil baris pengingat siklus 1 (work)
      const work1 = db
        .prepare(`SELECT * FROM reminders WHERE chat_id = ? AND status = 'pending'`)
        .get(TEST_CHAT_TIMER);
      assert.equal(work1.repeat, 'pomodoro:work:1:2:25:5');

      // Majukan saat work1 selesai -> harus masuk break siklus 2
      const step1 = advancePomodoro(work1, now + 25 * 60_000);
      assert.equal(step1.nextPhase, 'break');
      assert.equal(step1.nextCycle, 2);

      // Ambil baris break 2
      const breakRow = db
        .prepare(`SELECT * FROM reminders WHERE id = ?`)
        .get(step1.reminderId);
      assert.equal(breakRow.repeat, 'pomodoro:break:2:2:25:5');

      // Majukan saat breakRow selesai -> harus masuk work siklus 2 (siklus terakhir)
      const step2 = advancePomodoro(breakRow, now + 30 * 60_000);
      assert.equal(step2.nextPhase, 'work');
      assert.equal(step2.cycle, 2);

      // Ambil baris work 2
      const work2 = db
        .prepare(`SELECT * FROM reminders WHERE id = ?`)
        .get(step2.reminderId);
      assert.equal(work2.repeat, 'pomodoro:work:2:2:25:5');

      // Majukan saat work 2 selesai -> harus selesai (finished)
      const step3 = advancePomodoro(work2, now + 55 * 60_000);
      assert.equal(step3.nextPhase, 'finished');
      assert.equal(step3.cycle, 2);
    });
  });

  describe('Integrasi Scheduler F-10', () => {
    it('mengirim pengingat timer tanpa inline keyboard dan menandai status sent', async () => {
      const now = 1700000000000;
      createTimer({
        chatId: TEST_CHAT_TIMER,
        userId: TEST_USER_TIMER,
        durationMs: 60_000,
        label: 'Air mendidih',
        now,
      });

      const messagesSent = [];
      const mockBot = {
        api: {
          sendMessage: async (chatId, text, options) => {
            messagesSent.push({ chatId, text, options });
          },
        },
      };

      // Jalankan scheduler saat due_at tiba
      const count = await processPendingReminders(mockBot, now + 65_000);
      assert.equal(count, 1);
      assert.equal(messagesSent.length, 1);
      assert.ok(messagesSent[0].text.includes('Timer Selesai'));
      assert.ok(messagesSent[0].text.includes('Air mendidih'));
      assert.equal(messagesSent[0].options?.reply_markup, undefined);

      // Pastikan status di DB berubah menjadi 'sent'
      const row = db
        .prepare(`SELECT status FROM reminders WHERE chat_id = ?`)
        .get(TEST_CHAT_TIMER);
      assert.equal(row.status, 'sent');
    });

    it('memajukan siklus pomodoro secara otomatis saat pengingat jatuh tempo', async () => {
      const now = 1700000000000;
      startPomodoro({
        chatId: TEST_CHAT_TIMER,
        userId: TEST_USER_TIMER,
        workMin: 25,
        breakMin: 5,
        cycles: 2,
        now,
      });

      const messagesSent = [];
      const mockBot = {
        api: {
          sendMessage: async (chatId, text, options) => {
            messagesSent.push({ chatId, text, options });
          },
        },
      };

      // 1. Simulasikan 25 menit berlalu
      const count = await processPendingReminders(mockBot, now + 25 * 60_000);
      assert.equal(count, 1);
      assert.ok(messagesSent[0].text.includes('Waktu Fokus Selesai'));

      // Baris pertama sudah 'sent', baris kedua (break) berstatus 'pending'
      const pendingRow = db
        .prepare(`SELECT * FROM reminders WHERE chat_id = ? AND status = 'pending'`)
        .get(TEST_CHAT_TIMER);
      assert.ok(pendingRow);
      assert.equal(pendingRow.repeat, 'pomodoro:break:2:2:25:5');
    });
  });

  describe('Feature Commands & Tags', () => {
    it('/timer menampilkan pesan kosong jika belum ada timer', async () => {
      const timerCmd = timerFeature.commands.find((c) => c.name === 'timer');
      let replyText = '';
      const ctx = {
        chat: { id: TEST_CHAT_TIMER },
        message: { text: '/timer' },
        reply: async (t) => {
          replyText = t;
        },
      };

      await timerCmd.handler(ctx);
      assert.ok(replyText.includes('Tidak ada timer'));
    });

    it('/timer membuat timer baru saat diberi durasi', async () => {
      const timerCmd = timerFeature.commands.find((c) => c.name === 'timer');
      let replyText = '';
      const ctx = {
        chat: { id: TEST_CHAT_TIMER },
        from: { id: TEST_USER_TIMER },
        message: { text: '/timer 15m Rebus ayam' },
        reply: async (t) => {
          replyText = t;
        },
      };

      await timerCmd.handler(ctx);
      assert.ok(replyText.includes('Timer Dimulai'));
      assert.ok(replyText.includes('15 menit'));
      assert.ok(replyText.includes('Rebus ayam'));

      const active = getActiveTimers(TEST_CHAT_TIMER);
      assert.equal(active.length, 1);
    });

    it('/timer tanpa argumen menampilkan daftar timer yang aktif', async () => {
      const timerCmd = timerFeature.commands.find((c) => c.name === 'timer');
      createTimer({
        chatId: TEST_CHAT_TIMER,
        userId: TEST_USER_TIMER,
        durationMs: 300_000,
        label: 'Oven',
      });

      let replyText = '';
      const ctx = {
        chat: { id: TEST_CHAT_TIMER },
        message: { text: '/timer' },
        reply: async (t) => {
          replyText = t;
        },
      };

      await timerCmd.handler(ctx);
      assert.ok(replyText.includes('Daftar Timer Aktif'));
      assert.ok(replyText.includes('Oven'));
    });

    it('/canceltimer membatalkan timer aktif', async () => {
      const timer = createTimer({
        chatId: TEST_CHAT_TIMER,
        userId: TEST_USER_TIMER,
        durationMs: 300_000,
        label: 'Tidur siang',
      });

      const cancelCmd = timerFeature.commands.find((c) => c.name === 'canceltimer');
      let replyText = '';
      const ctx = {
        chat: { id: TEST_CHAT_TIMER },
        message: { text: `/canceltimer ${timer.id}` },
        reply: async (t) => {
          replyText = t;
        },
      };

      await cancelCmd.handler(ctx);
      assert.ok(replyText.includes('berhasil dibatalkan'));
      assert.equal(getActiveTimers(TEST_CHAT_TIMER).length, 0);
    });

    it('/pomodoro memulai sesi, menampilkan status, dan dihentikan dengan /stop', async () => {
      const pomCmd = timerFeature.commands.find((c) => c.name === 'pomodoro');
      const stopCmd = timerFeature.commands.find((c) => c.name === 'stop');

      let replyText = '';
      const ctx = {
        chat: { id: TEST_CHAT_TIMER },
        from: { id: TEST_USER_TIMER },
        message: { text: '/pomodoro 30 10 3' },
        reply: async (t) => {
          replyText = t;
        },
      };

      // 1. Mulai
      await pomCmd.handler(ctx);
      assert.ok(replyText.includes('Sesi Pomodoro Dimulai'));
      assert.ok(replyText.includes('30 menit'));

      // 2. Status
      ctx.message.text = '/pomodoro status';
      await pomCmd.handler(ctx);
      assert.ok(replyText.includes('Status Pomodoro'));
      assert.ok(replyText.includes('1/3'));

      // 3. /stop
      await stopCmd.handler(ctx);
      assert.ok(replyText.includes('telah dihentikan'));
      assert.equal(getActivePomodoro(TEST_CHAT_TIMER), null);
    });

    it('tag [TIMER: ...] membuat timer', async () => {
      const tag = timerFeature.tags.find((t) => t.name === 'TIMER');
      assert.ok(tag);

      let replyText = '';
      const ctx = {
        chat: { id: TEST_CHAT_TIMER },
        from: { id: TEST_USER_TIMER },
        reply: async (t) => {
          replyText = t;
        },
      };

      await tag.handle(ctx, ['20m', 'rebus telur']);
      assert.ok(replyText.includes('Timer Dimulai'));
      assert.ok(replyText.includes('20 menit'));
      assert.ok(replyText.includes('rebus telur'));
    });

    it('tag [POMODORO: start] dan [POMODORO: stop] mengontrol pomodoro', async () => {
      const tag = timerFeature.tags.find((t) => t.name === 'POMODORO');
      assert.ok(tag);

      let replyText = '';
      const ctx = {
        chat: { id: TEST_CHAT_TIMER },
        from: { id: TEST_USER_TIMER },
        reply: async (t) => {
          replyText = t;
        },
      };

      // Start
      await tag.handle(ctx, ['start', '25', '5', '4']);
      assert.ok(replyText.includes('Sesi Pomodoro Dimulai'));
      assert.ok(getActivePomodoro(TEST_CHAT_TIMER));

      // Stop
      await tag.handle(ctx, ['stop']);
      assert.ok(replyText.includes('telah dihentikan'));
      assert.equal(getActivePomodoro(TEST_CHAT_TIMER), null);
    });
  });
});

