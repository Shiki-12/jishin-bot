import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseReminderInput,
  computeNextDue,
  getZonedParts,
  zonedPartsToUtcMs,
} from '../src/core/time_parser.js';
import {
  processPendingReminders,
  buildReminderKeyboard,
} from '../src/core/scheduler.js';
import { getDb } from '../src/core/db.js';
import remindersFeature, { insertReminder } from '../src/features/reminders.js';

describe('Reminders Time Parser (F-10) - 25+ Test Cases', () => {
  // Patokan waktu tetap untuk tes deterministik: Rabu, 04 Nov 2026 12:00:00 WIB
  const fixedNow = new Date('2026-11-04T05:00:00.000Z').getTime(); // 12:00 WIB
  const tz = 'Asia/Jakarta';

  // 1-10: Format relatif menit/jam/detik
  it('1. parse 10m', () => {
    const res = parseReminderInput('10m minum obat', tz, fixedNow);
    assert.equal(res.dueAt, fixedNow + 10 * 60_000);
    assert.equal(res.text, 'minum obat');
    assert.equal(res.repeat, null);
  });

  it('2. parse 10 m (spasi)', () => {
    const res = parseReminderInput('10 m minum obat', tz, fixedNow);
    assert.equal(res.dueAt, fixedNow + 10 * 60_000);
    assert.equal(res.text, 'minum obat');
  });

  it('3. parse 10menit', () => {
    const res = parseReminderInput('10menit istirahat', tz, fixedNow);
    assert.equal(res.dueAt, fixedNow + 10 * 60_000);
    assert.equal(res.text, 'istirahat');
  });

  it('4. parse 10 menit (spasi kata)', () => {
    const res = parseReminderInput('10 menit cek email', tz, fixedNow);
    assert.equal(res.dueAt, fixedNow + 10 * 60_000);
    assert.equal(res.text, 'cek email');
  });

  it('5. parse 2j', () => {
    const res = parseReminderInput('2j cek oven', tz, fixedNow);
    assert.equal(res.dueAt, fixedNow + 2 * 3600_000);
    assert.equal(res.text, 'cek oven');
  });

  it('6. parse 2jam', () => {
    const res = parseReminderInput('2jam belajar koding', tz, fixedNow);
    assert.equal(res.dueAt, fixedNow + 2 * 3600_000);
    assert.equal(res.text, 'belajar koding');
  });

  it('7. parse 2 jam (spasi kata)', () => {
    const res = parseReminderInput('2 jam rapat tim', tz, fixedNow);
    assert.equal(res.dueAt, fixedNow + 2 * 3600_000);
    assert.equal(res.text, 'rapat tim');
  });

  it('8. parse 30d (detik)', () => {
    const res = parseReminderInput('30d angkat telepon', tz, fixedNow);
    assert.equal(res.dueAt, fixedNow + 30_000);
    assert.equal(res.text, 'angkat telepon');
  });

  it('9. parse 30 detik (spasi kata)', () => {
    const res = parseReminderInput('30 detik tarik napas', tz, fixedNow);
    assert.equal(res.dueAt, fixedNow + 30_000);
    assert.equal(res.text, 'tarik napas');
  });

  it('10. parse kombinasi relatif: 1j 30m', () => {
    const res = parseReminderInput('1j 30m selesai tugas', tz, fixedNow);
    assert.equal(res.dueAt, fixedNow + 90 * 60_000);
    assert.equal(res.text, 'selesai tugas');
  });

  // 11-15: Jam tetap (hari ini / besok bila sudah lewat)
  it('11. parse jam hari ini yang belum lewat: 17:30 saat sekarang 12:00', () => {
    const res = parseReminderInput('17:30 pulang kantor', tz, fixedNow);
    const parts = getZonedParts(new Date(res.dueAt), tz);
    assert.equal(parts.day, 4);
    assert.equal(parts.hour, 17);
    assert.equal(parts.minute, 30);
    assert.equal(res.text, 'pulang kantor');
  });

  it('12. parse jam yang sudah lewat hari ini (07:00 saat sekarang 12:00) -> otomatis besok', () => {
    const res = parseReminderInput('07:00 sarapan pagi', tz, fixedNow);
    const parts = getZonedParts(new Date(res.dueAt), tz);
    assert.equal(parts.day, 5); // Besok tanggal 5
    assert.equal(parts.hour, 7);
    assert.equal(parts.minute, 0);
  });

  it('13. parse besok 07:00', () => {
    const res = parseReminderInput('besok 07:00 lari pagi', tz, fixedNow);
    const parts = getZonedParts(new Date(res.dueAt), tz);
    assert.equal(parts.day, 5);
    assert.equal(parts.hour, 7);
    assert.equal(parts.minute, 0);
    assert.equal(res.text, 'lari pagi');
  });

  it('14. parse lusa 09:00', () => {
    const res = parseReminderInput('lusa 09:00 servis mobil', tz, fixedNow);
    const parts = getZonedParts(new Date(res.dueAt), tz);
    assert.equal(parts.day, 6);
    assert.equal(parts.hour, 9);
    assert.equal(parts.minute, 0);
  });

  it('15. parse hari ini 23:30', () => {
    const res = parseReminderInput('hari ini 23:30 tidur cepat', tz, fixedNow);
    const parts = getZonedParts(new Date(res.dueAt), tz);
    assert.equal(parts.day, 4);
    assert.equal(parts.hour, 23);
    assert.equal(parts.minute, 30);
  });

  // 16-18: Tanggal lengkap
  it('16. parse tanggal ISO YYYY-MM-DD HH:mm: 2026-12-01 09:00', () => {
    const res = parseReminderInput('2026-12-01 09:00 bayar listrik', tz, fixedNow);
    const parts = getZonedParts(new Date(res.dueAt), tz);
    assert.equal(parts.year, 2026);
    assert.equal(parts.month, 12);
    assert.equal(parts.day, 1);
    assert.equal(parts.hour, 9);
    assert.equal(parts.minute, 0);
    assert.equal(res.text, 'bayar listrik');
  });

  it('17. parse format tanggal Indonesia DD-MM-YYYY HH:mm: 15-11-2026 14:00', () => {
    const res = parseReminderInput('15-11-2026 14:00 seminar', tz, fixedNow);
    const parts = getZonedParts(new Date(res.dueAt), tz);
    assert.equal(parts.day, 15);
    assert.equal(parts.month, 11);
    assert.equal(parts.hour, 14);
  });

  it('18. parse format ISO 8601 lengkap dengan offset', () => {
    const iso = '2026-11-05T07:00:00+07:00';
    const res = parseReminderInput(`${iso} minum obat`, tz, fixedNow);
    assert.equal(res.dueAt, Date.parse(iso));
    assert.equal(res.text, 'minum obat');
  });

  // 19-25: Pengulangan (Repeat)
  it('19. parse tiap hari 06:00', () => {
    const res = parseReminderInput('tiap hari 06:00 minum vitamin', tz, fixedNow);
    assert.equal(res.repeat, 'daily');
    const parts = getZonedParts(new Date(res.dueAt), tz);
    assert.equal(parts.hour, 6);
    assert.equal(parts.minute, 0);
    assert.equal(res.text, 'minum vitamin');
  });

  it('20. parse tiap senin 08:00', () => {
    const res = parseReminderInput('tiap senin 08:00 rapat mingguan', tz, fixedNow);
    assert.equal(res.repeat, 'weekly:1');
    const parts = getZonedParts(new Date(res.dueAt), tz);
    assert.equal(parts.hour, 8);
    assert.equal(res.text, 'rapat mingguan');
  });

  it('21. parse tiap jumat 13:30', () => {
    const res = parseReminderInput('tiap jumat 13:30 evaluasi sprint', tz, fixedNow);
    assert.equal(res.repeat, 'weekly:5');
    const parts = getZonedParts(new Date(res.dueAt), tz);
    assert.equal(parts.hour, 13);
    assert.equal(parts.minute, 30);
  });

  it('22. parse tiap 2 jam', () => {
    const res = parseReminderInput('tiap 2 jam stretching badan', tz, fixedNow);
    assert.equal(res.repeat, 'every:7200');
    assert.equal(res.dueAt, fixedNow + 7200 * 1000);
    assert.equal(res.text, 'stretching badan');
  });

  it('23. parse tiap 30 menit', () => {
    const res = parseReminderInput('tiap 30 menit minum air', tz, fixedNow);
    assert.equal(res.repeat, 'every:1800');
    assert.equal(res.dueAt, fixedNow + 1800 * 1000);
  });

  it('24. parse tiap tgl 1 (default jam 09:00)', () => {
    const res = parseReminderInput('tiap tgl 1 bayar kos', tz, fixedNow);
    assert.equal(res.repeat, 'monthly:1');
    const parts = getZonedParts(new Date(res.dueAt), tz);
    assert.equal(parts.day, 1);
    assert.equal(parts.hour, 9);
    assert.equal(res.text, 'bayar kos');
  });

  it('25. parse tiap tgl 25 15:00', () => {
    const res = parseReminderInput('tiap tgl 25 15:00 gajian', tz, fixedNow);
    assert.equal(res.repeat, 'monthly:25');
    const parts = getZonedParts(new Date(res.dueAt), tz);
    assert.equal(parts.day, 25);
    assert.equal(parts.hour, 15);
  });

  // Kasus aneh & penolakan
  it('26. menolak waktu di masa lalu (> 60 detik)', () => {
    // 2026-11-01 sudah lewat dari fixedNow (4 Nov)
    assert.throws(
      () => parseReminderInput('2026-11-01 09:00 tes', tz, fixedNow),
      /sudah terlewat/,
    );
  });

  it('27. menolak format input acak tanpa waktu yang valid', () => {
    assert.throws(
      () => parseReminderInput('besok tanpa jam tes', tz, fixedNow),
      /tidak dikenali/,
    );
  });
});

describe('Scheduler Engine & Idempotency (F-10)', () => {
  const db = getDb();

  it('tidak mengirim pesan ganda meskipun dipanggil berturut-turut (idempoten)', async () => {
    // Bersihkan antrian pengingat user uji untuk pengujian scheduler terisolasi
    db.prepare('DELETE FROM reminders WHERE user_id IN (880011, 880022, 880033, 880044)').run();

    const testChatId = 880011;
    const testUserId = 880011;

    const now = Date.now();
    // Buat pengingat yang jatuh tempo sekarang
    const remId = insertReminder({
      chatId: testChatId,
      userId: testUserId,
      text: 'Uji idempoten',
      dueAt: now - 5000,
      tz: 'Asia/Jakarta',
    });

    let sentMessages = [];
    const mockBot = {
      api: {
        sendMessage: async (chatId, text, opts) => {
          sentMessages.push({ chatId, text, opts });
        },
      },
    };

    // Jalankan scheduler 2 kali berurutan
    const p1 = processPendingReminders(mockBot, now);
    const p2 = processPendingReminders(mockBot, now);

    await Promise.all([p1, p2]);

    // Hanya boleh 1 pesan yang berhasil terkirim untuk testChatId!
    const sentForThisChat = sentMessages.filter((m) => m.chatId === testChatId);
    assert.equal(sentForThisChat.length, 1);
    assert.ok(sentForThisChat[0].text.includes('Uji idempoten'));

    // Status pengingat harus 'sent'
    const updated = db.prepare('SELECT status FROM reminders WHERE id = ?').get(remId);
    assert.equal(updated.status, 'sent');
  });

  it('pengingat berulang menghitung kemunculan berikutnya setelah waktu sekarang', async () => {
    const testChatId = 880022;
    const testUserId = 880022;
    db.prepare('DELETE FROM reminders WHERE user_id = ?').run(testUserId);

    const now = Date.now();
    // Jadwal tiap 10 detik, due 30 detik lalu (terlewat beberapa putaran)
    const remId = insertReminder({
      chatId: testChatId,
      userId: testUserId,
      text: 'Uji berulang',
      dueAt: now - 30_000,
      tz: 'Asia/Jakarta',
      repeat: 'every:10',
    });

    let sentCount = 0;
    const mockBot = {
      api: {
        sendMessage: async () => {
          sentCount++;
        },
      },
    };

    await processPendingReminders(mockBot, now);

    // Dikirim sekali
    assert.equal(sentCount, 1);

    // Status tetap pending, tapi due_at baru harus > now!
    const updated = db.prepare('SELECT status, due_at FROM reminders WHERE id = ?').get(remId);
    assert.equal(updated.status, 'pending');
    assert.ok(updated.due_at > now, 'due_at berikutnya harus di masa depan');
  });

  it('menangani error 403 saat bot diblokir dan menandai status failed', async () => {
    const testChatId = 880033;
    const testUserId = 880033;
    db.prepare('DELETE FROM reminders WHERE user_id = ?').run(testUserId);

    const now = Date.now();
    const remId = insertReminder({
      chatId: testChatId,
      userId: testUserId,
      text: 'Uji blokir',
      dueAt: now - 1000,
      tz: 'Asia/Jakarta',
    });

    const mockBot = {
      api: {
        sendMessage: async () => {
          const err = new Error('Forbidden: bot was blocked by the user');
          err.error_code = 403;
          throw err;
        },
      },
    };

    await processPendingReminders(mockBot, now);

    const updated = db.prepare('SELECT status FROM reminders WHERE id = ?').get(remId);
    assert.equal(updated.status, 'failed');
  });

  it('callback tunda (snooze) dan selesai (done) bekerja mengubah jadwal', async () => {
    const testChatId = 880044;
    const testUserId = 880044;
    db.prepare('DELETE FROM reminders WHERE user_id = ?').run(testUserId);

    const now = Date.now();
    const remId = insertReminder({
      chatId: testChatId,
      userId: testUserId,
      text: 'Uji tombol tunda',
      dueAt: now,
      tz: 'Asia/Jakarta',
    });

    const cbHandler = remindersFeature.callbacks.find((cb) => cb.prefix === 'rem:');
    assert.ok(cbHandler);

    // 1. Uji Tunda 10 Menit
    const snoozeCtx = {
      callbackQuery: {
        data: `rem:snz10:${remId}`,
        message: { text: 'Waktunya minum obat' },
      },
      answerCallbackQuery: async () => {},
      editMessageText: async () => {},
    };

    await cbHandler.handler(snoozeCtx);

    let row = db.prepare('SELECT * FROM reminders WHERE id = ?').get(remId);
    assert.equal(row.status, 'pending');
    assert.equal(row.snooze_count, 1);
    assert.ok(row.due_at >= now + 9 * 60_000);

    // 2. Uji Tombol Selesai (done)
    const doneCtx = {
      callbackQuery: {
        data: `rem:done:${remId}`,
        message: { text: 'Waktunya minum obat' },
      },
      answerCallbackQuery: async () => {},
      editMessageText: async () => {},
    };

    await cbHandler.handler(doneCtx);

    row = db.prepare('SELECT status FROM reminders WHERE id = ?').get(remId);
    assert.equal(row.status, 'sent');
  });
});
