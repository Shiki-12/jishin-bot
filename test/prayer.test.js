import './setup.js';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/core/db.js';
import {
  cleanTiming,
  getTimezoneLabel,
  fetchPrayerTimes,
  getPrayerData,
  clearPrayerCache,
  formatPrayerSchedule,
  schedulePrayerRemindersForTarget,
  cancelPrayerRemindersForTarget,
  syncDailyPrayerReminders,
  METHOD_KEMENAG,
} from '../src/core/prayer.js';
import { processPendingReminders } from '../src/core/scheduler.js';
import prayerFeature from '../src/features/prayer.js';

const MOCK_PRAYER_API_RESPONSE = {
  code: 200,
  status: 'OK',
  data: {
    timings: {
      Fajr: '04:05 (WIB)',
      Sunrise: '05:26',
      Dhuhr: '11:36',
      Asr: '14:55',
      Sunset: '17:47',
      Maghrib: '17:47',
      Isha: '18:59',
      Imsak: '03:55 (WIB)',
      Midnight: '23:36',
    },
    date: {
      readable: '05 Nov 2026',
      hijri: {
        date: '25-05-1448',
        day: '25',
        month: { en: 'Jumādá al-ūlá' },
        year: '1448',
      },
      gregorian: {
        date: '05-11-2026',
        day: '05',
        month: { en: 'November' },
        year: '2026',
      },
    },
    meta: {
      timezone: 'Asia/Jakarta',
      method: {
        id: 20,
        name: 'Kementerian Agama Republik Indonesia',
      },
    },
  },
};

describe('F-41: Jadwal Sholat (Aladhan API & Adzan Reminders)', () => {
  const TEST_USER = 771122;
  const TEST_CHAT = 771122;
  let origFetch;

  beforeEach(() => {
    clearPrayerCache();
    origFetch = globalThis.fetch;
    const db = getDb();
    db.prepare('DELETE FROM reminders WHERE user_id IN (?, 999111)').run(TEST_USER);
    db.prepare('DELETE FROM users WHERE id IN (?, 999111)').run(TEST_USER);
    db.prepare('DELETE FROM chats WHERE id IN (?, 999111)').run(TEST_CHAT);
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  describe('cleanTiming & getTimezoneLabel', () => {
    it('membersihkan format waktu dari akhiran timezone atau karakter ekstra', () => {
      assert.equal(cleanTiming('04:05 (WIB)'), '04:05');
      assert.equal(cleanTiming('11:36'), '11:36');
      assert.equal(cleanTiming(''), '');
      assert.equal(cleanTiming(null), '');
    });

    it('menghasilkan singkatan zona waktu yang tepat untuk Indonesia', () => {
      assert.equal(getTimezoneLabel('Asia/Jakarta'), 'WIB');
      assert.equal(getTimezoneLabel('Asia/Makassar'), 'WITA');
      assert.equal(getTimezoneLabel('Asia/Jayapura'), 'WIT');
      assert.equal(getTimezoneLabel('UTC'), 'UTC');
    });
  });

  describe('fetchPrayerTimes & API Integration', () => {
    it('mengambil jadwal sholat dengan metode Kemenag RI (id: 20)', async () => {
      let requestedUrl = null;
      const mockFetch = async (url) => {
        requestedUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => MOCK_PRAYER_API_RESPONSE,
        };
      };

      const result = await fetchPrayerTimes('Jakarta', {
        fetchFn: mockFetch,
      });

      assert.ok(result);
      assert.equal(result.city, 'Jakarta');
      assert.equal(result.timings.Fajr, '04:05');
      assert.equal(result.timings.Dhuhr, '11:36');
      assert.equal(result.timings.Asr, '14:55');
      assert.equal(result.timings.Maghrib, '17:47');
      assert.equal(result.timings.Isha, '18:59');
      assert.equal(result.timings.Imsak, '03:55');
      assert.ok(requestedUrl.includes(`method=${METHOD_KEMENAG}`));
      assert.ok(requestedUrl.includes('address=Jakarta'));
    });

    it('mengembalikan null jika kota tidak ditemukan (HTTP 400 / 404)', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 400,
      });

      const result = await fetchPrayerTimes('KotaFiktif123', {
        fetchFn: mockFetch,
      });
      assert.equal(result, null);
    });

    it('melemparkan error jika server API mengalami error 500', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 500,
      });

      await assert.rejects(
        () => fetchPrayerTimes('Bandung', { fetchFn: mockFetch }),
        /Aladhan HTTP error: 500/,
      );
    });
  });

  describe('getPrayerData & In-Memory Cache (1 hari per kota)', () => {
    it('menyimpan hasil di cache dan tidak memanggil API berulang untuk kota & tanggal sama', async () => {
      let fetchCount = 0;
      const mockFetch = async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => MOCK_PRAYER_API_RESPONSE,
        };
      };

      const res1 = await getPrayerData('Surabaya', { fetchFn: mockFetch, now: 1_000_000 });
      const res2 = await getPrayerData('Surabaya', { fetchFn: mockFetch, now: 1_100_000 });

      assert.ok(res1);
      assert.ok(res2);
      assert.equal(fetchCount, 1);
    });

    it('mengambil ulang jika tanggal berbeda', async () => {
      let fetchCount = 0;
      const mockFetch = async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => MOCK_PRAYER_API_RESPONSE,
        };
      };

      await getPrayerData('Bandung', { dateStr: '05-11-2026', fetchFn: mockFetch });
      await getPrayerData('Bandung', { dateStr: '06-11-2026', fetchFn: mockFetch });

      assert.equal(fetchCount, 2);
    });
  });

  describe('formatPrayerSchedule', () => {
    it('merender jadwal sholat lengkap secara netral dan sopan', () => {
      const output = formatPrayerSchedule({
        prayerData: {
          city: 'Jakarta',
          timings: {
            Fajr: '04:05',
            Sunrise: '05:26',
            Dhuhr: '11:36',
            Asr: '14:55',
            Maghrib: '17:47',
            Isha: '18:59',
            Imsak: '03:55',
          },
          date: {
            readable: '05 Nov 2026',
            hijri: { day: '25', month: { en: 'Jumādá al-ūlá' }, year: '1448' },
          },
        },
        cityName: 'Jakarta',
        tz: 'Asia/Jakarta',
      });

      assert.ok(output.includes('Jadwal Sholat untuk Jakarta'));
      assert.ok(output.includes('*Subuh:* `04:05` WIB'));
      assert.ok(output.includes('*Dzuhur:* `11:36` WIB'));
      assert.ok(output.includes('*Ashar:* `14:55` WIB'));
      assert.ok(output.includes('*Maghrib:* `17:47` WIB'));
      assert.ok(output.includes('*Isya:* `18:59` WIB'));
      assert.ok(output.includes('*Imsak:* `03:55` WIB'));
      assert.ok(output.includes('Metode: Kemenag RI'));
    });
  });

  describe('Pengingat Adzan Otomatis & Penjadwalan Harian', () => {
    const testNow = Date.UTC(2026, 10, 5, 4, 0, 0); // 2026-11-05 11:00 WIB (sebelum Dzuhur 11:36 WIB)

    beforeEach(() => {
      const db = getDb();
      db.prepare(`
        INSERT INTO users (id, first_name, username, tz, city, adzan, adzan_lead, adzan_last_date, created_at)
        VALUES (?, 'Budi', 'budi', 'Asia/Jakarta', 'Jakarta', 1, 10, NULL, ?)
      `).run(TEST_USER, testNow);
    });

    it('menjadwalkan sholat yang belum lewat hari ini dengan selisih waktu lead', async () => {
      const db = getDb();
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => MOCK_PRAYER_API_RESPONSE,
      });

      const count = await schedulePrayerRemindersForTarget({
        chatId: TEST_CHAT,
        userId: TEST_USER,
        isPrivate: true,
        now: testNow, // 11:00 WIB
        fetchFn: mockFetch,
      });

      // Pada jam 11:00 WIB, Subuh (04:05 - 10m = 03:55) sudah lewat.
      // Sisa 4 sholat mendatang: Dzuhur, Ashar, Maghrib, Isya.
      assert.equal(count, 4);

      const reminders = db
        .prepare(`SELECT * FROM reminders WHERE user_id = ? ORDER BY due_at ASC`)
        .all(TEST_USER);
      assert.equal(reminders.length, 4);

      // Dzuhur: 11:36 WIB - 10m = 11:26 WIB
      const dzuhurReminder = reminders.find((r) => r.text.includes('Dzuhur'));
      assert.ok(dzuhurReminder);
      assert.ok(dzuhurReminder.text.startsWith('🕌 Pengingat Sholat:'));
      assert.ok(dzuhurReminder.text.includes('10 menit lagi masuk waktu Dzuhur'));

      // Kolom adzan_last_date terupdate ke 2026-11-05
      const user = db.prepare(`SELECT adzan_last_date FROM users WHERE id = ?`).get(TEST_USER);
      assert.equal(user.adzan_last_date, '2026-11-05');
    });

    it('bersifat idempoten dan tidak menduplikasi pengingat jika dipanggil berulang', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => MOCK_PRAYER_API_RESPONSE,
      });

      const count1 = await schedulePrayerRemindersForTarget({
        chatId: TEST_CHAT,
        userId: TEST_USER,
        isPrivate: true,
        now: testNow,
        fetchFn: mockFetch,
      });
      assert.equal(count1, 4);

      const count2 = await schedulePrayerRemindersForTarget({
        chatId: TEST_CHAT,
        userId: TEST_USER,
        isPrivate: true,
        now: testNow,
        fetchFn: mockFetch,
      });
      assert.equal(count2, 0); // Tidak ada penambahan baru
    });

    it('membatalkan pengingat yang pending saat adzan dimatikan (/adzan off)', async () => {
      const db = getDb();
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => MOCK_PRAYER_API_RESPONSE,
      });

      await schedulePrayerRemindersForTarget({
        chatId: TEST_CHAT,
        userId: TEST_USER,
        isPrivate: true,
        now: testNow,
        fetchFn: mockFetch,
      });

      const cancelled = cancelPrayerRemindersForTarget(TEST_CHAT, TEST_USER);
      assert.equal(cancelled, 4);

      const pending = db
        .prepare(`SELECT count(*) as count FROM reminders WHERE user_id = ? AND status = 'pending'`)
        .get(TEST_USER).count;
      assert.equal(pending, 0);
    });

    it('syncDailyPrayerReminders memproses seluruh user dengan adzan aktif', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => MOCK_PRAYER_API_RESPONSE,
      });

      const scheduled = await syncDailyPrayerReminders(null, {
        now: testNow,
        fetchFn: mockFetch,
      });
      assert.equal(scheduled, 4);
    });
  });

  describe('Pengiriman Pengingat Netral di Scheduler F-10', () => {
    it('mengirim pengingat berawalan 🕌 tanpa template persona tsundere/sarkas dan tanpa tombol tunda', async () => {
      const db = getDb();
      const prayerText = '🕌 Pengingat Sholat: 10 menit lagi masuk waktu Subuh (04:05 WIB) untuk wilayah Jakarta.';
      const now = Date.now();

      db.prepare(`
        INSERT INTO reminders (chat_id, user_id, text, due_at, tz, repeat, status, created_at)
        VALUES (999111, 999111, ?, ?, 'Asia/Jakarta', NULL, 'pending', ?)
      `).run(prayerText, now - 5000, now - 60000);

      let sentMessage = null;
      let sentOptions = null;
      const mockBot = {
        api: {
          sendMessage: async (chatId, text, options) => {
            if (chatId === 999111) {
              sentMessage = text;
              sentOptions = options;
            }
          },
        },
      };

      await processPendingReminders(mockBot, now);

      assert.ok(sentMessage);
      assert.equal(sentMessage, prayerText);
      assert.ok(!sentMessage.includes('Hei bodoh'));
      assert.ok(!sentMessage.includes('B-bukan berarti aku peduli'));
      assert.equal(sentOptions?.reply_markup, undefined); // Tidak ada tombol snooze yang mengganggu
    });
  });

  describe('Perintah Fitur Prayer (/sholat dan /adzan)', () => {
    it('/sholat memberitahu jika belum ada kota yang diatur', async () => {
      const sholatCmd = prayerFeature.commands.find((c) => c.name === 'sholat');
      assert.ok(sholatCmd);

      let replyText = '';
      const ctx = {
        chat: { id: TEST_CHAT, type: 'private' },
        from: { id: TEST_USER },
        message: { text: '/sholat' },
        replyWithChatAction: async () => {},
        reply: async (text) => {
          replyText = text;
        },
      };

      await sholatCmd.handler(ctx);
      assert.ok(replyText.includes('belum mengatur kota domisili'));
    });

    it('/sholat <kota> mengambil jadwal untuk kota yang diminta', async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => MOCK_PRAYER_API_RESPONSE,
      });

      const sholatCmd = prayerFeature.commands.find((c) => c.name === 'sholat');

      let replyText = '';
      const ctx = {
        chat: { id: TEST_CHAT, type: 'private' },
        from: { id: TEST_USER },
        message: { text: '/sholat Bandung' },
        replyWithChatAction: async () => {},
        reply: async (text) => {
          replyText = text;
        },
      };

      await sholatCmd.handler(ctx);
      assert.ok(replyText.includes('Jadwal Sholat untuk Bandung'));
      assert.ok(replyText.includes('*Subuh:* `04:05`'));
    });

    it('/adzan status menampilkan mati jika belum diatur', async () => {
      const adzanCmd = prayerFeature.commands.find((c) => c.name === 'adzan');
      let replyText = '';
      const ctx = {
        chat: { id: TEST_CHAT, type: 'private' },
        from: { id: TEST_USER },
        message: { text: '/adzan' },
        reply: async (text) => {
          replyText = text;
        },
      };

      await adzanCmd.handler(ctx);
      assert.ok(replyText.includes('*Mati*'));
    });

    it('/adzan on meminta atur kota terlebih dahulu jika belum ada kota', async () => {
      const adzanCmd = prayerFeature.commands.find((c) => c.name === 'adzan');
      let replyText = '';
      const ctx = {
        chat: { id: TEST_CHAT, type: 'private' },
        from: { id: TEST_USER },
        message: { text: '/adzan on' },
        reply: async (text) => {
          replyText = text;
        },
      };

      await adzanCmd.handler(ctx);
      assert.ok(replyText.includes('Kota domisili belum diatur'));
    });

    it('/adzan on berhasil mengaktifkan pengingat jika kota sudah diatur', async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => MOCK_PRAYER_API_RESPONSE,
      });

      const db = getDb();
      db.prepare(`
        INSERT INTO users (id, first_name, username, tz, city, created_at)
        VALUES (?, 'Test', 'test', 'Asia/Jakarta', 'Jakarta', ?)
      `).run(TEST_USER, Date.now());

      const adzanCmd = prayerFeature.commands.find((c) => c.name === 'adzan');

      let replyText = '';
      const ctx = {
        chat: { id: TEST_CHAT, type: 'private' },
        from: { id: TEST_USER },
        message: { text: '/adzan on 15' },
        reply: async (text) => {
          replyText = text;
        },
      };

      await adzanCmd.handler(ctx);
      assert.ok(replyText.includes('berhasil diaktifkan'));
      assert.ok(replyText.includes('Jakarta'));
      assert.ok(replyText.includes('15 menit'));

      const user = db.prepare(`SELECT adzan, adzan_lead FROM users WHERE id = ?`).get(TEST_USER);
      assert.equal(user.adzan, 1);
      assert.equal(user.adzan_lead, 15);
    });

    it('/adzan off mematikan pengingat adzan', async () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO users (id, first_name, username, tz, city, adzan, created_at)
        VALUES (?, 'Test', 'test', 'Asia/Jakarta', 'Jakarta', 1, ?)
      `).run(TEST_USER, Date.now());

      const adzanCmd = prayerFeature.commands.find((c) => c.name === 'adzan');

      let replyText = '';
      const ctx = {
        chat: { id: TEST_CHAT, type: 'private' },
        from: { id: TEST_USER },
        message: { text: '/adzan off' },
        reply: async (text) => {
          replyText = text;
        },
      };

      await adzanCmd.handler(ctx);
      assert.ok(replyText.includes('dimatikan'));

      const user = db.prepare(`SELECT adzan FROM users WHERE id = ?`).get(TEST_USER);
      assert.equal(user.adzan, 0);
    });

    it('tag [PRAYER: kota] membalas jadwal sholat', async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => MOCK_PRAYER_API_RESPONSE,
      });

      const prayerTag = prayerFeature.tags.find((t) => t.name === 'PRAYER');
      assert.ok(prayerTag);

      let replyText = '';
      const ctx = {
        chat: { id: TEST_CHAT, type: 'private' },
        from: { id: TEST_USER },
        reply: async (text) => {
          replyText = text;
        },
      };

      await prayerTag.handle(ctx, ['Medan']);
      assert.ok(replyText.includes('Jadwal Sholat untuk Medan'));
    });
  });
});
