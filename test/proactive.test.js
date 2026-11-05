import './setup.js';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/core/db.js';
import {
  parseQuietHours,
  isQuietTime,
  getProactiveSettings,
  setProactiveEnabled,
  setQuietHours,
  resetProactiveUnreplied,
  getLastUserActivity,
  buildProactiveMessage,
  processProactiveMessages,
} from '../src/core/proactive.js';
import proactiveFeature from '../src/features/proactive.js';
import { tsundere } from '../src/personalities/tsundere.js';

describe('F-22: Mika Chat Duluan (Proaktif)', () => {
  const TEST_USERS = [991100, 991101, 991102];
  const TZ = 'Asia/Jakarta';

  function cleanupDb() {
    const db = getDb();
    const placeholders = TEST_USERS.map(() => '?').join(',');
    db.prepare(`DELETE FROM proactive_settings WHERE user_id IN (${placeholders})`).run(...TEST_USERS);
    db.prepare(`DELETE FROM todos WHERE user_id IN (${placeholders})`).run(...TEST_USERS);
    db.prepare(`DELETE FROM user_facts WHERE user_id IN (${placeholders})`).run(...TEST_USERS);
    db.prepare(`DELETE FROM messages WHERE chat_id IN (${placeholders})`).run(...TEST_USERS);
    db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...TEST_USERS);
  }

  beforeEach(() => {
    cleanupDb();
    const db = getDb();
    for (const uid of TEST_USERS) {
      db.prepare(
        `INSERT INTO users (id, first_name, username, tz, created_at)
         VALUES (?, 'UserTest', 'usertest', 'Asia/Jakarta', ?)`,
      ).run(uid, Date.now() - 24 * 3600_000);
    }
  });

  after(() => {
    cleanupDb();
  });

  describe('Parser & Evaluator Jam Tenang (Quiet Hours)', () => {
    it('parseQuietHours mengurai format HH:mm-HH:mm valid', () => {
      assert.deepEqual(parseQuietHours('22:00-07:00'), {
        quietStart: '22:00',
        quietEnd: '07:00',
      });
      assert.deepEqual(parseQuietHours('23:30 - 06:15'), {
        quietStart: '23:30',
        quietEnd: '06:15',
      });
      assert.deepEqual(parseQuietHours('00:00-08:00'), {
        quietStart: '00:00',
        quietEnd: '08:00',
      });
    });

    it('parseQuietHours menolak format tidak valid', () => {
      assert.equal(parseQuietHours('25:00-07:00'), null);
      assert.equal(parseQuietHours('22:60-07:00'), null);
      assert.equal(parseQuietHours('22:00'), null);
      assert.equal(parseQuietHours('random text'), null);
      assert.equal(parseQuietHours(''), null);
      assert.equal(parseQuietHours(null), null);
    });

    it('isQuietTime mendeteksi jam tenang yang melewati tengah malam (22:00 s.d. 07:00)', () => {
      // 23:00 WIB
      const t1 = new Date('2026-11-04T16:00:00.000Z'); // 23:00 WIB
      assert.equal(isQuietTime(t1.getTime(), TZ, '22:00', '07:00'), true);

      // 04:30 WIB
      const t2 = new Date('2026-11-04T21:30:00.000Z'); // 04:30 WIB
      assert.equal(isQuietTime(t2.getTime(), TZ, '22:00', '07:00'), true);

      // 12:00 WIB (siang)
      const t3 = new Date('2026-11-05T05:00:00.000Z'); // 12:00 WIB
      assert.equal(isQuietTime(t3.getTime(), TZ, '22:00', '07:00'), false);

      // 21:59 WIB (belum masuk jam tenang)
      const t4 = new Date('2026-11-04T14:59:00.000Z'); // 21:59 WIB
      assert.equal(isQuietTime(t4.getTime(), TZ, '22:00', '07:00'), false);
    });

    it('isQuietTime mendeteksi jam tenang dalam satu hari yang sama (13:00 s.d. 15:00)', () => {
      // 14:00 WIB
      const t1 = new Date('2026-11-05T07:00:00.000Z'); // 14:00 WIB
      assert.equal(isQuietTime(t1.getTime(), TZ, '13:00', '15:00'), true);

      // 16:00 WIB
      const t2 = new Date('2026-11-05T09:00:00.000Z'); // 16:00 WIB
      assert.equal(isQuietTime(t2.getTime(), TZ, '13:00', '15:00'), false);
    });
  });

  describe('Pengaturan & Aktivitas Proaktif (Database Operations)', () => {
    it('getProactiveSettings mengembalikan nilai default untuk user baru', () => {
      const s = getProactiveSettings(TEST_USERS[0]);
      assert.equal(s.enabled, 0);
      assert.equal(s.quiet_start, '22:00');
      assert.equal(s.quiet_end, '07:00');
      assert.equal(s.min_idle_hours, 8);
      assert.equal(s.unreplied_count, 0);
    });

    it('setProactiveEnabled mengaktifkan dan mematikan fitur proaktif', () => {
      setProactiveEnabled(TEST_USERS[0], 1);
      assert.equal(getProactiveSettings(TEST_USERS[0]).enabled, 1);

      setProactiveEnabled(TEST_USERS[0], 0);
      assert.equal(getProactiveSettings(TEST_USERS[0]).enabled, 0);
    });

    it('setQuietHours memperbarui jam tenang', () => {
      setQuietHours(TEST_USERS[0], '23:00', '06:00');
      const s = getProactiveSettings(TEST_USERS[0]);
      assert.equal(s.quiet_start, '23:00');
      assert.equal(s.quiet_end, '06:00');
    });

    it('resetProactiveUnreplied mereset counter unreplied_count menjadi 0', () => {
      const db = getDb();
      setProactiveEnabled(TEST_USERS[0], 1);
      db.prepare('UPDATE proactive_settings SET unreplied_count = 2 WHERE user_id = ?').run(TEST_USERS[0]);
      assert.equal(getProactiveSettings(TEST_USERS[0]).unreplied_count, 2);

      resetProactiveUnreplied(TEST_USERS[0]);
      assert.equal(getProactiveSettings(TEST_USERS[0]).unreplied_count, 0);
    });

    it('getLastUserActivity mengambil waktu pesan user terakhir', () => {
      const db = getDb();
      const past = Date.now() - 10 * 3600_000;
      db.prepare(
        'INSERT INTO messages (chat_id, role, text, created_at) VALUES (?, ?, ?, ?)',
      ).run(TEST_USERS[0], 'user', 'Halo Mika', past);

      const lastActivity = getLastUserActivity(TEST_USERS[0]);
      assert.equal(lastActivity, past);
    });
  });

  describe('Penyusunan Konten Pesan (buildProactiveMessage)', () => {
    it('merujuk to-do pending jika ada', () => {
      const db = getDb();
      db.prepare(
        'INSERT INTO todos (user_id, text, done, created_at) VALUES (?, ?, ?, ?)',
      ).run(TEST_USERS[0], 'Beli kado ulang tahun', 0, Date.now());

      const msg = buildProactiveMessage({
        userId: TEST_USERS[0],
        persona: tsundere,
        tz: TZ,
      });

      assert.ok(msg.includes('Beli kado ulang tahun'));
      assert.ok(msg.includes('to-do'));
    });

    it('merujuk fakta stabil user jika tidak ada to-do', () => {
      const db = getDb();
      db.prepare(
        'INSERT INTO user_facts (user_id, fact, created_at) VALUES (?, ?, ?)',
      ).run(TEST_USERS[0], 'suka kopi latte', Date.now());

      const msg = buildProactiveMessage({
        userId: TEST_USERS[0],
        persona: tsundere,
        tz: TZ,
      });

      assert.ok(msg.includes('suka kopi latte'));
    });

    it('mengirim sapaan umum in-character jika tidak ada to-do dan fakta', () => {
      const msg = buildProactiveMessage({
        userId: TEST_USERS[0],
        persona: tsundere,
        tz: TZ,
      });

      assert.ok(
        msg.includes('nggak ada kabar') ||
        msg.includes('ke mana aja') ||
        msg.includes('Masih hidup'),
      );
    });
  });

  describe('Scheduler & Dispatch Logic (processProactiveMessages)', () => {
    it('mengirim pesan proaktif saat semua kriteria terpenuhi', async () => {
      const db = getDb();
      const uid = TEST_USERS[0];
      setProactiveEnabled(uid, 1);

      // Pastikan aktivitas terakhir > 8 jam yang lalu
      const pastTime = Date.now() - 10 * 3600_000;
      db.prepare(
        'INSERT INTO messages (chat_id, role, text, created_at) VALUES (?, ?, ?, ?)',
      ).run(uid, 'user', 'halo', pastTime);

      const sentMessages = [];
      const mockBot = {
        api: {
          sendMessage: async (chatId, text) => {
            sentMessages.push({ chatId, text });
          },
        },
      };

      // Waktu siang: 14:00 WIB (bukan jam tenang)
      const now = new Date('2026-11-05T07:00:00.000Z').getTime(); // 14:00 WIB
      const sentCount = await processProactiveMessages(mockBot, now);

      assert.equal(sentCount, 1);
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0].chatId, uid);

      const s = getProactiveSettings(uid);
      assert.equal(s.unreplied_count, 1);
      assert.equal(s.last_sent_date, '2026-11-05');
    });

    it('tidak mengirim pesan saat jam tenang', async () => {
      const uid = TEST_USERS[0];
      setProactiveEnabled(uid, 1);

      const mockBot = {
        api: {
          sendMessage: async () => {},
        },
      };

      // Waktu malam: 23:30 WIB (jam tenang 22:00 s.d. 07:00)
      const nowNight = new Date('2026-11-05T16:30:00.000Z').getTime(); // 23:30 WIB
      const sentCount = await processProactiveMessages(mockBot, nowNight);

      assert.equal(sentCount, 0);
    });

    it('tidak mengirim lebih dari 1 kali per hari', async () => {
      const uid = TEST_USERS[0];
      setProactiveEnabled(uid, 1);

      const db = getDb();
      // Tandai sudah kirim hari ini
      db.prepare(
        'UPDATE proactive_settings SET last_sent_date = ? WHERE user_id = ?',
      ).run('2026-11-05', uid);

      const mockBot = { api: { sendMessage: async () => {} } };
      const now = new Date('2026-11-05T07:00:00.000Z').getTime();
      const sentCount = await processProactiveMessages(mockBot, now);

      assert.equal(sentCount, 0);
    });

    it('tidak mengirim jika user aktif kurang dari 8 jam lalu', async () => {
      const db = getDb();
      const uid = TEST_USERS[0];
      setProactiveEnabled(uid, 1);

      // User baru chat 1 jam lalu
      const recent = Date.now() - 1 * 3600_000;
      db.prepare(
        'INSERT INTO messages (chat_id, role, text, created_at) VALUES (?, ?, ?, ?)',
      ).run(uid, 'user', 'baru aja chat', recent);

      const mockBot = { api: { sendMessage: async () => {} } };
      const now = Date.now();
      const sentCount = await processProactiveMessages(mockBot, now);

      assert.equal(sentCount, 0);
    });

    it('berhenti otomatis jika user tidak membalas 3 pesan berturut-turut (unreplied_count >= 3)', async () => {
      const db = getDb();
      const uid = TEST_USERS[0];
      setProactiveEnabled(uid, 1);
      db.prepare('UPDATE proactive_settings SET unreplied_count = 3 WHERE user_id = ?').run(uid);

      const mockBot = { api: { sendMessage: async () => {} } };
      const now = new Date('2026-11-05T07:00:00.000Z').getTime();
      const sentCount = await processProactiveMessages(mockBot, now);

      assert.equal(sentCount, 0);
    });

    it('menonaktifkan proaktif jika bot diblokir user (403)', async () => {
      const uid = TEST_USERS[0];
      setProactiveEnabled(uid, 1);

      const mockBot = {
        api: {
          sendMessage: async () => {
            const err = new Error('Forbidden: bot was blocked by the user');
            err.error_code = 403;
            throw err;
          },
        },
      };

      const now = new Date('2026-11-05T07:00:00.000Z').getTime();
      await processProactiveMessages(mockBot, now);

      const s = getProactiveSettings(uid);
      assert.equal(s.enabled, 0);
    });
  });

  describe('Perintah Fitur (Commands)', () => {
    it('/proactive on mengaktifkan fitur', async () => {
      const replies = [];
      const ctx = {
        from: { id: TEST_USERS[0] },
        message: { text: '/proactive on' },
        reply: async (text) => replies.push(text),
        persona: tsundere,
      };

      const cmd = proactiveFeature.commands.find((c) => c.name === 'proactive');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].includes('diaktifkan'));
      assert.equal(getProactiveSettings(TEST_USERS[0]).enabled, 1);
    });

    it('/proactive off mematikan fitur', async () => {
      setProactiveEnabled(TEST_USERS[0], 1);
      const replies = [];
      const ctx = {
        from: { id: TEST_USERS[0] },
        message: { text: '/proactive off' },
        reply: async (text) => replies.push(text),
        persona: tsundere,
      };

      const cmd = proactiveFeature.commands.find((c) => c.name === 'proactive');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].includes('dimatikan'));
      assert.equal(getProactiveSettings(TEST_USERS[0]).enabled, 0);
    });

    it('/proactive tanpa argumen menampilkan status konfigurasi', async () => {
      const replies = [];
      const ctx = {
        from: { id: TEST_USERS[0] },
        message: { text: '/proactive' },
        reply: async (text, opts) => replies.push({ text, opts }),
        persona: tsundere,
      };

      const cmd = proactiveFeature.commands.find((c) => c.name === 'proactive');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].text.includes('Pengaturan Chat Proaktif'));
      assert.ok(replies[0].text.includes('Jam Tenang'));
    });

    it('/quiet mengatur rentang jam tenang valid', async () => {
      const replies = [];
      const ctx = {
        from: { id: TEST_USERS[0] },
        message: { text: '/quiet 23:00-06:00' },
        reply: async (text, opts) => replies.push({ text, opts }),
        persona: tsundere,
      };

      const cmd = proactiveFeature.commands.find((c) => c.name === 'quiet');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].text.includes('23:00'));
      assert.ok(replies[0].text.includes('06:00'));

      const s = getProactiveSettings(TEST_USERS[0]);
      assert.equal(s.quiet_start, '23:00');
      assert.equal(s.quiet_end, '06:00');
    });

    it('/quiet menolak format jam yang salah', async () => {
      const replies = [];
      const ctx = {
        from: { id: TEST_USERS[0] },
        message: { text: '/quiet jam-malam' },
        reply: async (text) => replies.push(text),
        persona: tsundere,
      };

      const cmd = proactiveFeature.commands.find((c) => c.name === 'quiet');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].includes('salah'));
    });
  });
});

