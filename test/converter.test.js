import './setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenizeMath,
  evaluateMath,
  getExchangeRates,
  convertCurrency,
  clearKursCache,
  formatCurrencyAmount,
  getUnitCategory,
  convertUnit,
} from '../src/core/converter.js';
import converterFeature from '../src/features/converter.js';

const MOCK_RATES_RESPONSE = {
  result: 'success',
  base_code: 'USD',
  time_last_update_utc: 'Wed, 04 Nov 2026 00:00:00 +0000',
  rates: {
    USD: 1,
    IDR: 16000,
    EUR: 0.9,
    JPY: 150,
  },
};

describe('F-42: Kurs, Kalkulator Aman, dan Konversi Satuan', () => {
  beforeEach(() => {
    clearKursCache();
  });

  describe('Kalkulator Aman (NO eval / NO Function)', () => {
    it('menghitung operasi aritmetika dasar (+, -, *, /)', () => {
      assert.equal(evaluateMath('2 + 3'), 5);
      assert.equal(evaluateMath('10 - 4'), 6);
      assert.equal(evaluateMath('6 * 7'), 42);
      assert.equal(evaluateMath('20 / 4'), 5);
    });

    it('menghormati prioritas operator (precedence) dan tanda kurung', () => {
      assert.equal(evaluateMath('2 + 3 * 4'), 14);
      assert.equal(evaluateMath('(2 + 3) * 4'), 20);
      assert.equal(evaluateMath('10 - 2 * 3 + 4 / 2'), 6);
      assert.equal(evaluateMath('(10 - (2 * 3) + 4) / 2'), 4);
    });

    it('menghitung pangkat ^ (right-associative) dan modulo %', () => {
      assert.equal(evaluateMath('2 ^ 3'), 8);
      // 2 ^ 3 ^ 2 = 2 ^ (3 ^ 2) = 2 ^ 9 = 512
      assert.equal(evaluateMath('2 ^ 3 ^ 2'), 512);
      assert.equal(evaluateMath('10 % 3'), 1);
      assert.equal(evaluateMath('2 ^ 4 + 7 % 4'), 19);
    });

    it('menangani operator unary positif dan negatif', () => {
      assert.equal(evaluateMath('-5 + 3'), -2);
      assert.equal(evaluateMath('-(2 + 3)'), -5);
      assert.equal(evaluateMath('+7 * -2'), -14);
      assert.equal(evaluateMath('-2 ^ 2'), -4);
      assert.equal(evaluateMath('(-2) ^ 2'), 4);
    });

    it('menghitung angka desimal dan membersihkan precision rounding', () => {
      assert.equal(evaluateMath('0.1 + 0.2'), 0.3);
      assert.equal(evaluateMath('2.5 * 4'), 10);
      assert.equal(evaluateMath('1.25 / 0.5'), 2.5);
    });

    it('menolak pembagian dan modulo dengan nol', () => {
      assert.throws(() => evaluateMath('10 / 0'), /Pembagian dengan nol tidak terdefinisi/);
      assert.throws(() => evaluateMath('15 % 0'), /Operasi modulo dengan nol tidak terdefinisi/);
    });

    it('menolak kurung yang tidak seimbang', () => {
      assert.throws(() => evaluateMath('(2 + 3'), /Kurung tutup "\)" tidak ditemukan/);
      assert.throws(() => evaluateMath('2 + 3)'), /Sintaks matematika tidak lengkap/);
    });

    it('menolak karakter berbahaya / non-matematika (keamanan)', () => {
      assert.throws(() => evaluateMath('eval("2+2")'), /Karakter tidak valid/);
      assert.throws(() => evaluateMath('Function("return 1")()'), /Karakter tidak valid/);
      assert.throws(() => evaluateMath('2 + x'), /Karakter tidak valid/);
      assert.throws(() => evaluateMath('process.exit()'), /Karakter tidak valid/);
      assert.throws(() => evaluateMath(';'), /Karakter tidak valid/);
    });

    it('menolak format angka atau sintaks rusak', () => {
      assert.throws(() => evaluateMath('1.2.3 + 4'), /titik ganda/);
      assert.throws(() => evaluateMath(''), /Ekspresi matematika kosong/);
      assert.throws(() => evaluateMath('2 + * 3'), /Sintaks ekspresi tidak valid/);
    });
  });

  describe('Kurs Mata Uang (open.er-api.com)', () => {
    it('mengambil kurs dan mengonversi nominal mata uang', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => MOCK_RATES_RESPONSE,
      });

      const conv = await convertCurrency(100, 'USD', 'IDR', { fetchFn: mockFetch });

      assert.equal(conv.amount, 100);
      assert.equal(conv.from, 'USD');
      assert.equal(conv.to, 'IDR');
      assert.equal(conv.rate, 16000);
      assert.equal(conv.result, 1600000);
      assert.equal(conv.lastUpdateUtc, 'Wed, 04 Nov 2026 00:00:00 +0000');
    });

    it('menyimpan data kurs di cache 1 jam dan tidak memanggil API berulang', async () => {
      let callCount = 0;
      const mockFetch = async () => {
        callCount++;
        return {
          ok: true,
          status: 200,
          json: async () => MOCK_RATES_RESPONSE,
        };
      };

      await convertCurrency(10, 'USD', 'EUR', { fetchFn: mockFetch, now: 1000 });
      await convertCurrency(50, 'USD', 'JPY', { fetchFn: mockFetch, now: 50000 });

      assert.equal(callCount, 1);
    });

    it('menolak kode mata uang yang tidak valid atau tidak ditemukan', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => MOCK_RATES_RESPONSE,
      });

      await assert.rejects(
        () => convertCurrency(100, 'US', 'IDR', { fetchFn: mockFetch }),
        /Kode mata uang 'US' tidak valid/,
      );

      await assert.rejects(
        () => convertCurrency(100, 'USD', 'XYZ', { fetchFn: mockFetch }),
        /Mata uang tujuan 'XYZ' tidak ditemukan/,
      );
    });

    it('formatCurrencyAmount merender nominal angka dengan benar', () => {
      assert.equal(formatCurrencyAmount(1000000), '1.000.000');
      assert.equal(formatCurrencyAmount(1234.56), '1.234,56');
      assert.equal(formatCurrencyAmount(0), '0');
    });
  });

  describe('Konversi Satuan (Panjang, Berat, Volume, Suhu)', () => {
    it('mengonversi satuan panjang', () => {
      const kmToM = convertUnit(5, 'km', 'm');
      assert.equal(kmToM.result, 5000);
      assert.equal(kmToM.category, 'panjang');

      const mToCm = convertUnit(2.5, 'meter', 'cm');
      assert.equal(mToCm.result, 250);

      const miToKm = convertUnit(1, 'mil', 'km');
      assert.equal(miToKm.result, 1.609344);

      const inToCm = convertUnit(10, 'inci', 'cm');
      assert.equal(inToCm.result, 25.4);
    });

    it('mengonversi satuan berat/massa', () => {
      const kgToG = convertUnit(2, 'kg', 'g');
      assert.equal(kgToG.result, 2000);
      assert.equal(kgToG.category, 'berat');

      const tonToKg = convertUnit(1.5, 'ton', 'kg');
      assert.equal(tonToKg.result, 1500);

      const lbToKg = convertUnit(10, 'lb', 'kg');
      assert.equal(Math.round(lbToKg.result * 100) / 100, 4.54);

      const gToOns = convertUnit(500, 'gram', 'ons');
      assert.equal(gToOns.result, 5); // 500g = 5 ons
    });

    it('mengonversi satuan volume', () => {
      const lToMl = convertUnit(1.5, 'liter', 'ml');
      assert.equal(lToMl.result, 1500);
      assert.equal(lToMl.category, 'volume');

      const galToL = convertUnit(1, 'gal', 'l');
      assert.equal(Math.round(galToL.result * 100) / 100, 3.79);

      const cupToMl = convertUnit(2, 'cup', 'ml');
      assert.equal(cupToMl.result, 480);
    });

    it('mengonversi satuan suhu (Celcius, Fahrenheit, Kelvin, Reamur)', () => {
      // 100 C -> 212 F
      const cToF = convertUnit(100, 'c', 'f');
      assert.equal(cToF.result, 212);
      assert.equal(cToF.category, 'suhu');

      // 32 F -> 0 C
      const fToC = convertUnit(32, 'fahrenheit', 'celcius');
      assert.equal(fToC.result, 0);

      // 0 C -> 273.15 K
      const cToK = convertUnit(0, 'c', 'k');
      assert.equal(cToK.result, 273.15);

      // 80 R -> 100 C
      const rToC = convertUnit(80, 'reamur', 'c');
      assert.equal(rToC.result, 100);
    });

    it('menolak konversi antar kategori yang berbeda', () => {
      assert.throws(
        () => convertUnit(5, 'km', 'kg'),
        /Tidak bisa mengonversi satuan 'panjang' ke 'berat'/,
      );

      assert.throws(
        () => convertUnit(100, 'c', 'liter'),
        /Tidak bisa mengonversi satuan 'suhu' ke 'volume'/,
      );
    });

    it('menolak satuan yang tidak dikenali', () => {
      assert.throws(() => convertUnit(10, 'kucing', 'meter'), /Satuan asal 'kucing' tidak dikenali/);
      assert.throws(() => convertUnit(10, 'meter', 'kucing'), /Satuan tujuan 'kucing' tidak dikenali/);
    });
  });

  describe('Perintah & Tags Fitur Converter', () => {
    it('/hitung memproses ekspresi matematika', async () => {
      const hitungCmd = converterFeature.commands.find((c) => c.name === 'hitung');
      assert.ok(hitungCmd);

      let replyText = '';
      const ctx = {
        message: { text: '/hitung 15 * (4 + 2)' },
        reply: async (text) => {
          replyText = text;
        },
      };

      await hitungCmd.handler(ctx);
      assert.ok(replyText.includes('90'));
      assert.ok(replyText.includes('Hasil Perhitungan'));
    });

    it('/hitung menampilkan panduan jika argumen kosong', async () => {
      const hitungCmd = converterFeature.commands.find((c) => c.name === 'hitung');
      let replyText = '';
      const ctx = {
        message: { text: '/hitung' },
        reply: async (text) => {
          replyText = text;
        },
      };

      await hitungCmd.handler(ctx);
      assert.ok(replyText.includes('Format kalkulator'));
    });

    it('/kurs mengonversi mata uang', async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => MOCK_RATES_RESPONSE,
      });

      try {
        const kursCmd = converterFeature.commands.find((c) => c.name === 'kurs');
        assert.ok(kursCmd);

        let replyText = '';
        const ctx = {
          message: { text: '/kurs 100 USD IDR' },
          replyWithChatAction: async () => {},
          reply: async (text) => {
            replyText = text;
          },
        };

        await kursCmd.handler(ctx);
        assert.ok(replyText.includes('1.600.000'));
        assert.ok(replyText.includes('USD'));
        assert.ok(replyText.includes('IDR'));
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('/konversi mengonversi satuan (mendukung kata hubung "ke")', async () => {
      const konversiCmd = converterFeature.commands.find((c) => c.name === 'konversi');
      assert.ok(konversiCmd);

      let replyText = '';
      const ctx = {
        message: { text: '/konversi 5 km ke mil' },
        reply: async (text) => {
          replyText = text;
        },
      };

      await konversiCmd.handler(ctx);
      assert.ok(replyText.includes('Konversi Satuan (panjang)'));
      assert.ok(replyText.includes('3.10685596'));
    });

    it('tag [CALC: ...] menghitung ekspresi matematika', async () => {
      const calcTag = converterFeature.tags.find((t) => t.name === 'CALC');
      assert.ok(calcTag);

      let replyText = '';
      const ctx = {
        reply: async (text) => {
          replyText = text;
        },
      };

      await calcTag.handle(ctx, ['2 ^ 3 + 4']);
      assert.ok(replyText.includes('12'));
    });

    it('tag [CONVERT: ...] mengonversi satuan', async () => {
      const convertTag = converterFeature.tags.find((t) => t.name === 'CONVERT');
      assert.ok(convertTag);

      let replyText = '';
      const ctx = {
        reply: async (text) => {
          replyText = text;
        },
      };

      await convertTag.handle(ctx, ['100', 'c', 'f']);
      assert.ok(replyText.includes('212'));
    });
  });
});

