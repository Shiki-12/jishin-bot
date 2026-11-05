import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE,
  kao,
  escapeHtml,
  detectKaomoji,
  detectEmoji,
  EMOJI_REGEX,
  KAOMOJI_REGEX,
} from '../src/core/kaomoji.js';

describe('K1: Modul Kaomoji & Deteksi Simbol (src/core/kaomoji.js)', () => {
  describe('Integritas & Keamanan Palet Kaomoji', () => {
    const requiredMoods = [
      'malu',
      'senang',
      'girang',
      'kesal',
      'sedih',
      'bingung',
      'bosan',
      'kaget',
      'lembut',
    ];

    it('memiliki seluruh 9 mood dasar', () => {
      for (const mood of requiredMoods) {
        assert.ok(Array.isArray(PALETTE[mood]), `Mood '${mood}' harus berupa array`);
        assert.ok(PALETTE[mood].length >= 2, `Mood '${mood}' harus memiliki minimal 2 pilihan kaomoji`);
      }
    });

    it('hanya memuat karakter aman (tanpa backslash, backtick, atau emoji)', () => {
      for (const [mood, list] of Object.entries(PALETTE)) {
        for (const item of list) {
          assert.equal(typeof item, 'string');
          assert.ok(!item.includes('\\'), `Kaomoji '${item}' tidak boleh memuat backslash`);
          assert.ok(!item.includes('`'), `Kaomoji '${item}' tidak boleh memuat backtick`);
          assert.ok(!detectEmoji(item), `Kaomoji '${item}' pada mood '${mood}' tidak boleh dihitung sebagai emoji`);
        }
      }
    });

    it('fungsi kao() mengembalikan kaomoji yang tepat dan mendukung rng', () => {
      const firstMalu = kao('malu', () => 0.0);
      assert.equal(firstMalu, PALETTE.malu[0]);

      const lastMalu = kao('malu', () => 0.999);
      assert.equal(lastMalu, PALETTE.malu[PALETTE.malu.length - 1]);

      const fallback = kao('unknown_mood_xyz');
      assert.ok(typeof fallback === 'string');
      assert.ok(detectKaomoji(fallback));
    });
  });

  describe('escapeHtml', () => {
    it('meng-escape (>_<) menjadi (&gt;_&lt;)', () => {
      assert.equal(escapeHtml('(>_<)'), '(&gt;_&lt;)');
    });

    it('meng-escape karakter & < > " \' secara lengkap', () => {
      const input = '<div class="test" data-val=\'abc\'>Tom & Jerry > Spike</div>';
      const expected = '&lt;div class=&quot;test&quot; data-val=&#39;abc&#39;&gt;Tom &amp; Jerry &gt; Spike&lt;/div&gt;';
      assert.equal(escapeHtml(input), expected);
    });

    it('mengembalikan string kosong jika input bukan string', () => {
      assert.equal(escapeHtml(null), '');
      assert.equal(escapeHtml(undefined), '');
      assert.equal(escapeHtml(123), '');
    });
  });

  describe('Deteksi Kaomoji (detectKaomoji)', () => {
    it('mendeteksi contoh kaomoji valid sesuai spesifikasi K1', () => {
      const validExamples = [
        '(^///^)',
        '(>_<)',
        '(T_T)',
        '(-_-)',
        '(>///<)',
        '(//_//)',
        '(^_^)',
        '(^_^)/',
        '(^o^)/',
        '(°o°)',
        '(¬_¬)',
        '(;_;)',
        '(._.)',
        '(o_O)',
        '(?_?)',
        '(=_=)',
        '(O_O)',
      ];

      for (const k of validExamples) {
        assert.equal(detectKaomoji(k), true, `Gagal mendeteksi kaomoji valid: ${k}`);
        assert.equal(detectKaomoji(`Halo apa kabar ${k} hari ini`), true, `Gagal mendeteksi dalam kalimat: ${k}`);
      }
    });

    it('menolak teks biasa dalam tanda kurung yang bukan kaomoji (ok, 10m, a, 3, dll)', () => {
      const nonKaomojis = [
        '(ok)',
        '(10m)',
        '(a)',
        '(3)',
        '(1)',
        '(user_id)',
        '(contoh)',
        '(WIB)',
        '(WITA)',
        '(Asia/Jakarta)',
        '(Rp 50.000)',
      ];

      for (const nk of nonKaomojis) {
        assert.equal(detectKaomoji(nk), false, `Salah mendeteksi bukan kaomoji sebagai kaomoji: ${nk}`);
        assert.equal(detectKaomoji(`Pesan ${nk} terkirim`), false, `Salah mendeteksi dalam kalimat: ${nk}`);
      }
    });
  });

  describe('Deteksi Emoji (detectEmoji & EMOJI_REGEX)', () => {
    it('tidak mendeteksi angka biasa, tanda pagar (#), atau bintang (*)', () => {
      const nonEmojis = [
        '0',
        '1',
        '2',
        '5',
        '9',
        '12345',
        '#',
        '*',
        '#tag',
        '#123',
        '*bold*',
        '2026-11-05',
        '10m',
        '100%',
        'nomor 1 dunia',
      ];

      for (const str of nonEmojis) {
        assert.equal(detectEmoji(str), false, `Angka / simbol '${str}' keliru dideteksi sebagai emoji`);
      }
    });

    it('mendeteksi emoji pictographic dan variasinya secara akurat', () => {
      const emojis = [
        '😊',
        '✨',
        '😤',
        '🙄',
        '😳',
        '🎉',
        '🚀',
        '☕',
        '🌿',
        '❤️',
        '🙈',
        '🥺',
      ];

      for (const emo of emojis) {
        assert.equal(detectEmoji(emo), true, `Emoji '${emo}' gagal dideteksi`);
        assert.equal(detectEmoji(`Halo ${emo} kawan`), true, `Emoji '${emo}' gagal dideteksi dalam teks`);
      }
    });
  });
});

