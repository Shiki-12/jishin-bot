import './setup.js';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/core/db.js';
import schedulesFeature, {
  isValidTimeFormat,
  setSchedule,
  getSchedule,
  getAllUserSchedules,
  disableSchedule,
  buildMorningMessage,
  buildNightMessage,
  processDailySchedules,
} from '../src/features/schedules.js';
import { getZonedParts, zonedPartsToUtcMs } from '../src/core/time_parser.js';

describe('F-13: Pesan Pagi & Malam Terjadwal', () => {
  const TEST_CHAT = 770011;
  const TEST_USER = 770011;
  const TZ = 'Asia/Jakarta';

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM schedules WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM reminders WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM todos WHERE user_id = ?').run(TEST_USER);
  });

  after(() => {
    const db = getDb();
    db.prepare('DELETE FROM schedules WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM reminders WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM todos WHERE user_id = ?').run(TEST_USER);
  });

  describe('Validasi Format Jam', () => {
    it('memvalidasi format HH:mm yang benar', () => {
      assert.equal(isValidTimeFormat('07:00'), true);
      assert.equal(isValidTimeFormat('22:30'), true);
      assert.equal(isValidTimeFormat('00:00'), true);
      assert.equal(isValidTimeFormat('23:59'), true);
    });

    it('menolak format jam yang salah', () => {
      assert.equal(isValidTimeFormat('24:00'), false);
      assert.equal(isValidTimeFormat('12:60'), false);
      assert.equal(isValidTimeFormat('7:00'), false);
      assert.equal(isValidTimeFormat('pagi'), false);
      assert.equal(isValidTimeFormat(''), false);
      assert.equal(isValidTimeFormat(null), false);
    });
  });

  describe('Database Operations & Upsert', () => {
    it('setSchedule dan getSchedule menyimpan konfigurasi dengan benar', () => {
      const res = setSchedule({
        chatId: TEST_CHAT,
        userId: TEST_USER,
        type: 'morning',
        time: '07:00',
        tz: TZ,
      });

      assert.equal(res.time, '07:00');
      const row = getSchedule(TEST_CHAT, TEST_USER, 'morning');
      assert.ok(row);
      assert.equal(row.time, '07:00');
      assert.equal(row.status, 'active');
      assert.equal(row.tz, TZ);
    });

    it('disableSchedule mematikan jadwal aktif', () => {
      setSchedule({
        chatId: TEST_CHAT,
        userId: TEST_USER,
        type: 'night',
        time: '22:30',
        tz: TZ,
      });

      const disabled = disableSchedule({
        chatId: TEST_CHAT,
        userId: TEST_USER,
        type: 'night',
      });
      assert.equal(disabled, true);

      const row = getSchedule(TEST_CHAT, TEST_USER, 'night');
      assert.equal(row.status, 'disabled');
    });

    it('getAllUserSchedules mengembalikan semua jadwal user', () => {
      setSchedule({ chatId: TEST_CHAT, userId: TEST_USER, type: 'morning', time: '06:30', tz: TZ });
      setSchedule({ chatId: TEST_CHAT, userId: TEST_USER, type: 'night', time: '22:00', tz: TZ });

      const all = getAllUserSchedules(TEST_CHAT, TEST_USER);
      assert.equal(all.length, 2);
    });
  });

  describe('Penyusunan Konten Pesan', () => {
    it('buildMorningMessage menyertakan pengingat hari ini dan to-do pending', () => {
      const db = getDb();
      const now = Date.now();
      const parts = getZonedParts(new Date(now), TZ);

      // Buat pengingat jatuh tempo hari ini
      const dueToday = zonedPartsToUtcMs(
        { year: parts.year, month: parts.month, day: parts.day, hour: 14, minute: 0, second: 0 },
        TZ,
      );
      db.prepare(
        `INSERT INTO reminders (chat_id, user_id, text, due_at, tz, repeat, status, created_at, snooze_count)
         VALUES (?, ?, ?, ?, ?, 'none', 'pending', ?, 0)`,
      ).run(TEST_CHAT, TEST_USER, 'rapat perencanaan sprint', dueToday, TZ, now);

      // Buat to-do pending
      db.prepare(
        `INSERT INTO todos (user_id, text, done, created_at)
         VALUES (?, ?, 0, ?)`,
      ).run(TEST_USER, 'beli kopi', now);

      const msg = buildMorningMessage({ userId: TEST_USER, tz: TZ, now });
      assert.ok(msg.includes('rapat perencanaan sprint'));
      assert.ok(msg.includes('14:00'));
      assert.ok(msg.includes('beli kopi'));
    });

    it('buildNightMessage menyertakan to-do selesai hari ini dan ajakan check-in', () => {
      const db = getDb();
      const now = Date.now();
      const parts = getZonedParts(new Date(now), TZ);

      const doneToday = zonedPartsToUtcMs(
        { year: parts.year, month: parts.month, day: parts.day, hour: 10, minute: 0, second: 0 },
        TZ,
      );

      // To-do selesai hari ini
      db.prepare(
        `INSERT INTO todos (user_id, text, done, created_at, done_at)
         VALUES (?, ?, 1, ?, ?)`,
      ).run(TEST_USER, 'review pr teman', now - 3600_000, doneToday);

      const msg = buildNightMessage({ userId: TEST_USER, tz: TZ, now });
      assert.ok(msg.includes('1 to-do'));
      assert.ok(msg.includes('Gimana harimu'));
    });
  });

  describe('Scheduler Idempotency & Dispatch', () => {
    it('mengirim pesan pada jam yang tepat dan tidak mengirim ulang di hari yang sama', async () => {
      // Atur waktu acuan: 2026-11-05 07:05 WIB
      const fakeNow = zonedPartsToUtcMs(
        { year: 2026, month: 11, day: 5, hour: 7, minute: 5, second: 0 },
        TZ,
      );

      // Atur jadwal morning jam 07:00 WIB
      const db = getDb();
      db.prepare(
        `INSERT INTO schedules (chat_id, user_id, type, time, tz, status, last_run_date, created_at)
         VALUES (?, ?, 'morning', '07:00', ?, 'active', NULL, ?)`,
      ).run(TEST_CHAT, TEST_USER, TZ, fakeNow - 3600_000);

      const sentMessages = [];
      const mockBot = {
        api: {
          sendMessage: async (chatId, text, opts) => {
            sentMessages.push({ chatId, text, opts });
          },
        },
      };

      // Putaran 1: harus terkirim
      const count1 = await processDailySchedules(mockBot, fakeNow);
      assert.equal(count1, 1);
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0].chatId, TEST_CHAT);

      // Cek last_run_date terupdate
      const sched = getSchedule(TEST_CHAT, TEST_USER, 'morning');
      assert.equal(sched.last_run_date, '2026-11-05');

      // Putaran 2 di hari yang sama (misal 07:15 WIB): tidak boleh terkirim lagi (idempoten)
      const fakeNowLater = zonedPartsToUtcMs(
        { year: 2026, month: 11, day: 5, hour: 7, minute: 15, second: 0 },
        TZ,
      );
      const count2 = await processDailySchedules(mockBot, fakeNowLater);
      assert.equal(count2, 0);
      assert.equal(sentMessages.length, 1);
    });

    it('menangani bot diblokir (403) dan otomatis mendisable jadwal', async () => {
      const fakeNow = zonedPartsToUtcMs(
        { year: 2026, month: 11, day: 5, hour: 22, minute: 35, second: 0 },
        TZ,
      );

      const db = getDb();
      db.prepare(
        `INSERT INTO schedules (chat_id, user_id, type, time, tz, status, last_run_date, created_at)
         VALUES (?, ?, 'night', '22:30', ?, 'active', NULL, ?)`,
      ).run(TEST_CHAT, TEST_USER, TZ, fakeNow - 1000);

      const mockBotBlocked = {
        api: {
          sendMessage: async () => {
            const err = new Error('Forbidden: bot was blocked by the user');
            err.error_code = 403;
            throw err;
          },
        },
      };

      await processDailySchedules(mockBotBlocked, fakeNow);

      const sched = getSchedule(TEST_CHAT, TEST_USER, 'night');
      assert.equal(sched.status, 'disabled');
    });
  });

  describe('Commands /morning & /night', () => {
    it('/morning 07:00 menyetel jadwal pesan pagi', async () => {
      const replies = [];
      const ctx = {
        chat: { id: TEST_CHAT },
        from: { id: TEST_USER },
        message: { text: '/morning 07:00' },
        reply: async (msg, opts) => replies.push({ msg, opts }),
      };

      const cmd = schedulesFeature.commands.find((c) => c.name === 'morning');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].msg.includes('07:00'));

      const sched = getSchedule(TEST_CHAT, TEST_USER, 'morning');
      assert.equal(sched.status, 'active');
      assert.equal(sched.time, '07:00');
    });

    it('/morning off mematikan jadwal pagi', async () => {
      setSchedule({ chatId: TEST_CHAT, userId: TEST_USER, type: 'morning', time: '07:00', tz: TZ });

      const replies = [];
      const ctx = {
        chat: { id: TEST_CHAT },
        from: { id: TEST_USER },
        message: { text: '/morning off' },
        reply: async (msg) => replies.push(msg),
      };

      const cmd = schedulesFeature.commands.find((c) => c.name === 'morning');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].includes('dimatikan'));

      const sched = getSchedule(TEST_CHAT, TEST_USER, 'morning');
      assert.equal(sched.status, 'disabled');
    });

    it('/schedules menampilkan status pagi dan malam', async () => {
      setSchedule({ chatId: TEST_CHAT, userId: TEST_USER, type: 'morning', time: '07:00', tz: TZ });

      const replies = [];
      const ctx = {
        chat: { id: TEST_CHAT },
        from: { id: TEST_USER },
        reply: async (msg, opts) => replies.push({ msg, opts }),
      };

      const cmd = schedulesFeature.commands.find((c) => c.name === 'schedules');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].msg.includes('07:00'));
      assert.ok(replies[0].msg.includes('*Malam:* Mati'));
    });
  });
});
