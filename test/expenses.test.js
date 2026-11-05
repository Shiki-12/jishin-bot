import './setup.js';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/core/db.js';
import {
  parseExpenseAmount,
  formatRupiah,
  categorizeExpense,
  addExpense,
  getExpenseById,
  deleteExpense,
  updateExpenseCategory,
  getExpensesSummary,
  generateExpensesCsv,
  escapeCsvField,
} from '../src/core/expenses.js';
import expensesFeature, { buildCategoryKeyboard } from '../src/features/expenses.js';

const TEST_USER_EXP = 6665511;

describe('F-45: Catat Pengeluaran (Expenses)', () => {
  const db = getDb();

  beforeEach(() => {
    db.prepare(`DELETE FROM expenses WHERE user_id = ?`).run(TEST_USER_EXP);
  });

  afterEach(() => {
    db.prepare(`DELETE FROM expenses WHERE user_id = ?`).run(TEST_USER_EXP);
  });

  describe('Parser Nominal (parseExpenseAmount) & Formatter', () => {
    it('mem-parse berbagai format nominal sesuai spesifikasi (25k, 25rb, 25.000, 1,5jt, 1.5 juta)', () => {
      // Wajib sesuai spesifikasi F-45:
      assert.equal(parseExpenseAmount('25k'), 25000);
      assert.equal(parseExpenseAmount('25rb'), 25000);
      assert.equal(parseExpenseAmount('25.000'), 25000);
      assert.equal(parseExpenseAmount('1,5jt'), 1500000);
      assert.equal(parseExpenseAmount('1.5 juta'), 1500000);
      assert.equal(parseExpenseAmount('1,5 juta'), 1500000);
    });

    it('mem-parse variasi suffix dan prefix mata uang lainnya', () => {
      assert.equal(parseExpenseAmount('25000'), 25000);
      assert.equal(parseExpenseAmount('100rb'), 100000);
      assert.equal(parseExpenseAmount('100k'), 100000);
      assert.equal(parseExpenseAmount('2,5k'), 2500);
      assert.equal(parseExpenseAmount('2.5k'), 2500);
      assert.equal(parseExpenseAmount('1.500.000'), 1500000);
      assert.equal(parseExpenseAmount('10jt'), 10000000);
      assert.equal(parseExpenseAmount('2 miliar'), 2000000000);

      // Prefix Rp / IDR
      assert.equal(parseExpenseAmount('Rp 25.000'), 25000);
      assert.equal(parseExpenseAmount('rp. 1,5jt'), 1500000);
      assert.equal(parseExpenseAmount('IDR 50k'), 50000);
    });

    it('menolak input tidak valid, kosong, nol, atau negatif', () => {
      assert.throws(() => parseExpenseAmount(''), /tidak boleh kosong/);
      assert.throws(() => parseExpenseAmount(null), /tidak boleh kosong/);
      assert.throws(() => parseExpenseAmount('-25k'), /tidak boleh negatif/);
      assert.throws(() => parseExpenseAmount('0'), /lebih dari 0/);
      assert.throws(() => parseExpenseAmount('abc'), /tidak valid/);
      assert.throws(() => parseExpenseAmount('2 triliun'), /maksimal 1 triliun/);
    });

    it('formatRupiah memformat nominal ke string mata uang Indonesia', () => {
      assert.equal(formatRupiah(25000), 'Rp\u00a025.000'.replace(/\u00a0/, ' '));
      assert.equal(formatRupiah(1500000), 'Rp\u00a01.500.000'.replace(/\u00a0/, ' '));
      assert.equal(formatRupiah(0), 'Rp\u00a00'.replace(/\u00a0/, ' '));
    });
  });

  describe('Kategorisasi Otomatis (categorizeExpense)', () => {
    it('mendeteksi kategori berdasarkan kata kunci keterangan', () => {
      assert.equal(categorizeExpense('makan siang nasi padang'), 'makanan');
      assert.equal(categorizeExpense('kopi kenangan susu'), 'makanan');
      assert.equal(categorizeExpense('isi bensin pertalite motor'), 'transport');
      assert.equal(categorizeExpense('ongkos ojol gojek'), 'transport');
      assert.equal(categorizeExpense('belanja sabun mandi di alfamart'), 'belanja');
      assert.equal(categorizeExpense('beli baju kemeja di shopee'), 'belanja');
      assert.equal(categorizeExpense('bayar listrik pln dan wifi indihome'), 'tagihan');
      assert.equal(categorizeExpense('nonton bioskop xxi sama teman'), 'hiburan');
      assert.equal(categorizeExpense('beli obat pusing dan vitamin di apotek'), 'kesehatan');
      assert.equal(categorizeExpense('sumbangan sosial sukarela'), 'lainnya');
    });
  });

  describe('CRUD Pengeluaran (Expenses)', () => {
    it('menambah catatan pengeluaran ke database', () => {
      const exp = addExpense({
        userId: TEST_USER_EXP,
        amount: '25k',
        note: 'makan bakso',
      });

      assert.ok(exp.id > 0);
      assert.equal(exp.amount, 25000);
      assert.equal(exp.category, 'makanan');
      assert.equal(exp.note, 'makan bakso');

      const saved = getExpenseById(exp.id, TEST_USER_EXP);
      assert.equal(saved.amount, 25000);
    });

    it('mengubah kategori pengeluaran dengan updateExpenseCategory', () => {
      const exp = addExpense({
        userId: TEST_USER_EXP,
        amount: 50000,
        category: 'lainnya',
        note: 'beli bensin',
      });

      const ok = updateExpenseCategory(exp.id, TEST_USER_EXP, 'transport');
      assert.equal(ok, true);

      const updated = getExpenseById(exp.id, TEST_USER_EXP);
      assert.equal(updated.category, 'transport');

      // Menolak kategori tidak valid
      assert.throws(
        () => updateExpenseCategory(exp.id, TEST_USER_EXP, 'kucing'),
        /tidak valid/,
      );
    });

    it('menghapus catatan pengeluaran dengan deleteExpense', () => {
      const exp = addExpense({
        userId: TEST_USER_EXP,
        amount: 10000,
        note: 'jajan es teh',
      });

      const ok = deleteExpense(exp.id, TEST_USER_EXP);
      assert.equal(ok, true);

      const deleted = getExpenseById(exp.id);
      assert.equal(deleted, null);
    });
  });

  describe('Rekap Pengeluaran (getExpensesSummary)', () => {
    it('menghitung total dan rincian per kategori untuk periode hari, minggu, bulan', () => {
      const now = new Date('2026-11-05T12:00:00+07:00').getTime();

      // Tambah beberapa transaksi di hari ini
      addExpense({
        userId: TEST_USER_EXP,
        amount: 30000,
        category: 'makanan',
        note: 'sarapan',
        now,
      });
      addExpense({
        userId: TEST_USER_EXP,
        amount: 20000,
        category: 'transport',
        note: 'bensin',
        now,
      });
      addExpense({
        userId: TEST_USER_EXP,
        amount: 50000,
        category: 'makanan',
        note: 'makan siang',
        now,
      });

      const summaryHari = getExpensesSummary({
        userId: TEST_USER_EXP,
        period: 'hari',
        tz: 'Asia/Jakarta',
        now,
      });

      assert.equal(summaryHari.totalAmount, 100000);
      assert.equal(summaryHari.totalCount, 3);
      assert.equal(summaryHari.breakdown.length, 2);

      const makanan = summaryHari.breakdown.find((b) => b.category === 'makanan');
      assert.equal(makanan.amount, 80000);
      assert.equal(makanan.count, 2);
      assert.equal(makanan.percentage, 80);

      const transport = summaryHari.breakdown.find((b) => b.category === 'transport');
      assert.equal(transport.amount, 20000);
      assert.equal(transport.count, 1);
      assert.equal(transport.percentage, 20);

      // Rekap minggu dan bulan juga harus mencakup transaksi hari ini
      const summaryMinggu = getExpensesSummary({
        userId: TEST_USER_EXP,
        period: 'minggu',
        tz: 'Asia/Jakarta',
        now,
      });
      assert.equal(summaryMinggu.totalAmount, 100000);

      const summaryBulan = getExpensesSummary({
        userId: TEST_USER_EXP,
        period: 'bulan',
        tz: 'Asia/Jakarta',
        now,
      });
      assert.equal(summaryBulan.totalAmount, 100000);
    });

    it('mengembalikan summary kosong jika tidak ada transaksi', () => {
      const summary = getExpensesSummary({
        userId: TEST_USER_EXP,
        period: 'hari',
      });
      assert.equal(summary.totalAmount, 0);
      assert.equal(summary.totalCount, 0);
      assert.equal(summary.breakdown.length, 0);
    });
  });

  describe('Ekspor CSV (generateExpensesCsv & escapeCsvField)', () => {
    it('meng-escape teks CSV dengan koma, tanda kutip, atau baris baru', () => {
      assert.equal(escapeCsvField('normal'), 'normal');
      assert.equal(escapeCsvField('beli nasi, es teh'), '"beli nasi, es teh"');
      assert.equal(escapeCsvField('beli "roti" bakar'), '"beli ""roti"" bakar"');
      assert.equal(escapeCsvField('baris 1\nbaris 2'), '"baris 1\nbaris 2"');
    });

    it('menghasilkan dokumen CSV yang valid dari data database', () => {
      const now = new Date('2026-11-05T10:00:00+07:00').getTime();
      addExpense({
        userId: TEST_USER_EXP,
        amount: 25000,
        category: 'makanan',
        note: 'nasi padang, es teh',
        now,
      });

      const csv = generateExpensesCsv(TEST_USER_EXP, 'Asia/Jakarta');
      const lines = csv.split('\n');

      assert.equal(lines[0], 'ID,Tanggal,Kategori,Nominal,Keterangan');
      assert.ok(lines[1].includes('makanan,25000,"nasi padang, es teh"'));
    });
  });

  describe('Feature Commands & Callbacks & Action Tags', () => {
    it('/catat menyimpan pengeluaran dan membalas dengan tombol inline kategori', async () => {
      const catatCmd = expensesFeature.commands.find((c) => c.name === 'catat');
      let replyText = '';
      let replyOptions = null;

      const ctx = {
        from: { id: TEST_USER_EXP },
        message: { text: '/catat 25k makan siang ayam bakar' },
        reply: async (t, opt) => {
          replyText = t;
          replyOptions = opt;
        },
      };

      await catatCmd.handler(ctx);
      assert.ok(replyText.includes('Pengeluaran Dicatat'));
      assert.ok(replyText.includes('25.000'));
      assert.ok(replyText.includes('Makanan'));
      assert.ok(replyOptions?.reply_markup);

      const list = db
        .prepare(`SELECT * FROM expenses WHERE user_id = ?`)
        .all(TEST_USER_EXP);
      assert.equal(list.length, 1);
    });

    it('/catat menampilkan petunjuk jika argumen kosong', async () => {
      const catatCmd = expensesFeature.commands.find((c) => c.name === 'catat');
      let replyText = '';
      const ctx = {
        from: { id: TEST_USER_EXP },
        message: { text: '/catat' },
        reply: async (t) => {
          replyText = t;
        },
      };

      await catatCmd.handler(ctx);
      assert.ok(replyText.includes('Format perintah'));
    });

    it('/rekap menampilkan laporan ringkasan pengeluaran', async () => {
      addExpense({
        userId: TEST_USER_EXP,
        amount: 35000,
        category: 'transport',
        note: 'bensin',
      });

      const rekapCmd = expensesFeature.commands.find((c) => c.name === 'rekap');
      let replyText = '';
      const ctx = {
        from: { id: TEST_USER_EXP },
        message: { text: '/rekap' },
        reply: async (t) => {
          replyText = t;
        },
      };

      await rekapCmd.handler(ctx);
      assert.ok(replyText.includes('Rekap Pengeluaran'));
      assert.ok(replyText.includes('Transport'));
      assert.ok(replyText.includes('35.000'));
    });

    it('/hapuscatat menghapus transaksi berdasarkan ID', async () => {
      const exp = addExpense({
        userId: TEST_USER_EXP,
        amount: 15000,
        note: 'parkir',
      });

      const hapusCmd = expensesFeature.commands.find((c) => c.name === 'hapuscatat');
      let replyText = '';
      const ctx = {
        from: { id: TEST_USER_EXP },
        message: { text: `/hapuscatat ${exp.id}` },
        reply: async (t) => {
          replyText = t;
        },
      };

      await hapusCmd.handler(ctx);
      assert.ok(replyText.includes('berhasil dihapus'));
      assert.equal(getExpenseById(exp.id), null);
    });

    it('/exportcsv mengirim dokumen CSV jika ada data', async () => {
      addExpense({
        userId: TEST_USER_EXP,
        amount: 20000,
        note: 'jajan',
      });

      const exportCmd = expensesFeature.commands.find((c) => c.name === 'exportcsv');
      let docSent = null;
      let optSent = null;

      const ctx = {
        from: { id: TEST_USER_EXP },
        replyWithDocument: async (doc, opt) => {
          docSent = doc;
          optSent = opt;
        },
        reply: async () => {},
      };

      await exportCmd.handler(ctx);
      assert.ok(docSent);
      assert.ok(optSent?.caption.includes('rekap pengeluaran'));
    });

    it('callback exp:cat:<id>:<category> mengubah kategori pengeluaran via tombol', async () => {
      const exp = addExpense({
        userId: TEST_USER_EXP,
        amount: 50000,
        category: 'lainnya',
        note: 'isi e-toll',
      });

      const callbackDef = expensesFeature.callbacks.find((c) => c.prefix === 'exp:');
      assert.ok(callbackDef);

      let answered = '';
      let editedText = '';
      const ctx = {
        from: { id: TEST_USER_EXP },
        callbackQuery: { data: `exp:cat:${exp.id}:transport` },
        answerCallbackQuery: async ({ text }) => {
          answered = text;
        },
        editMessageText: async (text) => {
          editedText = text;
        },
      };

      await callbackDef.handler(ctx);
      assert.ok(answered.includes('Transport'));
      assert.ok(editedText.includes('Transport'));

      const updated = getExpenseById(exp.id);
      assert.equal(updated.category, 'transport');
    });

    it('tag [EXPENSE: ...] memproses pencatatan dari bahasa natural LLM', async () => {
      const expenseTag = expensesFeature.tags.find((t) => t.name === 'EXPENSE');
      assert.ok(expenseTag);

      let replyText = '';
      const ctx = {
        from: { id: TEST_USER_EXP },
        reply: async (t) => {
          replyText = t;
        },
      };

      await expenseTag.handle(ctx, ['45000', 'makanan', 'ayam geprek']);
      assert.ok(replyText.includes('Pengeluaran Dicatat'));
      assert.ok(replyText.includes('45.000'));
      assert.ok(replyText.includes('Makanan'));

      const saved = db
        .prepare(`SELECT * FROM expenses WHERE user_id = ?`)
        .get(TEST_USER_EXP);
      assert.equal(saved.amount, 45000);
      assert.equal(saved.category, 'makanan');
    });
  });
});

