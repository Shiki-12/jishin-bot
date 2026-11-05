import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  shapeReply,
  cleanMarkers,
  isCrisisText,
} from '../src/core/expression.js';
import {
  detectKaomoji,
  detectEmoji,
  escapeHtml,
} from '../src/core/kaomoji.js';

function createSeededRng(seed = 123456789) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('K2 & K6: Modul Gaya Ekspresi (src/core/expression.js)', () => {
  describe('Aturan Batas: Maksimal 1 Penanda & Tidak Berdampingan', () => {
    it('membatasi maksimal 1 penanda ekspresi saat ada banyak emoji', () => {
      const input = 'H-hah?! Jangan ngomong aneh-aneh, bodoh! 😤 🙄 😳';

      // Uji keep emoji (roll < 0.35)
      const resKeep = shapeReply(input, { mode: 'mixed', persona: 'tsundere', rng: () => 0.1 });
      const emojisKeep = resKeep.match(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu) || [];
      assert.equal(emojisKeep.length, 1);
      assert.equal(detectKaomoji(resKeep), false);

      // Uji convert to kaomoji (0.35 <= roll < 0.75)
      const resKao = shapeReply(input, { mode: 'mixed', persona: 'tsundere', rng: () => 0.5 });
      assert.equal(detectEmoji(resKao), false);
      assert.equal(detectKaomoji(resKao), true);

      // Uji plain (roll >= 0.75)
      const resPlain = shapeReply(input, { mode: 'mixed', persona: 'tsundere', rng: () => 0.9 });
      assert.equal(detectEmoji(resPlain), false);
      assert.equal(detectKaomoji(resPlain), false);
    });

    it('mempertahankan hanya 1 kaomoji jika model sudah menulis kaomoji ganda', () => {
      const input = 'Hmph! (¬_¬) Kamu bikin aku pusing (>_<)';
      const res = shapeReply(input, { mode: 'mixed', persona: 'tsundere' });
      assert.ok(res.includes('(¬_¬)'));
      assert.ok(!res.includes('(>_<)'));
      assert.equal(detectEmoji(res), false);
    });

    it('kaomoji dan emoji tidak pernah muncul bersamaan', () => {
      const testCases = [
        'Hmph (¬_¬) jangan ganggu 😤',
        'Dasar bodoh! 😤 (>_<) B-bukan urusanku!',
        'Halooo! (^_^)/ Senang kenalan! ✨🎉',
        'Bosan... (-_-) 😑 (=_=)',
      ];

      for (const text of testCases) {
        const res = shapeReply(text, { mode: 'mixed', persona: 'tsundere' });
        const hasK = detectKaomoji(res);
        const hasE = detectEmoji(res);
        assert.ok(!(hasK && hasE), `Kaomoji dan emoji tidak boleh bersamaan pada: "${res}"`);
      }
    });
  });

  describe('Dukungan Mode Ekspresi (mixed, emoji, kaomoji, plain, off)', () => {
    const textWithEmoji = 'Aku sedang senang hari ini! 😊 ✨';
    const textWithKaomoji = 'Aku sedang bingung (o_O) banget (?_?)';
    const textWithBoth = 'Aku kesal 😤 (¬_¬) sekali!';

    it('mode "plain" membuang seluruh emoji dan kaomoji', () => {
      const res1 = shapeReply(textWithEmoji, { mode: 'plain' });
      assert.equal(detectEmoji(res1), false);
      assert.equal(detectKaomoji(res1), false);
      assert.equal(res1, 'Aku sedang senang hari ini!');

      const res2 = shapeReply(textWithKaomoji, { mode: 'plain' });
      assert.equal(detectEmoji(res2), false);
      assert.equal(detectKaomoji(res2), false);
      assert.equal(res2, 'Aku sedang bingung banget');

      const res3 = shapeReply(textWithBoth, { mode: 'plain' });
      assert.equal(detectEmoji(res3), false);
      assert.equal(detectKaomoji(res3), false);
      assert.equal(res3, 'Aku kesal sekali!');
    });

    it('mode "emoji" membatasi maks 1 emoji dan membuang kaomoji', () => {
      const res1 = shapeReply(textWithEmoji, { mode: 'emoji' });
      const emojis = res1.match(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu) || [];
      assert.equal(emojis.length, 1);
      assert.equal(detectKaomoji(res1), false);

      const res2 = shapeReply(textWithBoth, { mode: 'emoji' });
      assert.equal(detectKaomoji(res2), false);
      assert.equal(detectEmoji(res2), true);
    });

    it('mode "kaomoji" mengganti emoji jadi kaomoji setara dan membuang emoji berlebih', () => {
      const res1 = shapeReply(textWithEmoji, { mode: 'kaomoji', persona: 'kalem' });
      assert.equal(detectEmoji(res1), false);
      assert.equal(detectKaomoji(res1), true);

      const res2 = shapeReply(textWithBoth, { mode: 'kaomoji', persona: 'tsundere' });
      assert.equal(detectEmoji(res2), false);
      assert.equal(detectKaomoji(res2), true);
    });

    it('mode "off" melewatkan teks apa adanya tanpa perubahan', () => {
      const res1 = shapeReply(textWithBoth, { mode: 'off' });
      assert.equal(res1, textWithBoth);
    });
  });

  describe('Deteksi Situasi Krisis & Layanan Darurat (Aturan 4 & K2)', () => {
    it('isCrisisText mendeteksi nomor 119 ext 8, 112, SEJIWA, dan 1500-567', () => {
      assert.equal(isCrisisText('Telepon 119 (ekstensi 8) sekarang'), true);
      assert.equal(isCrisisText('Hubungi 119 ext 8 ya'), true);
      assert.equal(isCrisisText('Hubungi 119 ekstensi 8'), true);
      assert.equal(isCrisisText('Layanan darurat 112 selalu siaga'), true);
      assert.equal(isCrisisText('Hotline SEJIWA Kemenkes RI'), true);
      assert.equal(isCrisisText('Halo Kemenkes 1500-567'), true);

      assert.equal(isCrisisText('Halo apa kabar hari ini?'), false);
      assert.equal(isCrisisText('Saya punya 1120 apel'), false);
    });

    it('balasan krisis membersihkan SEMUA emoji dan kaomoji secara mutlak', () => {
      const crisisReplies = [
        'Tolong jangan berputus asa... Hubungi 119 (ekstensi 8) ya (T_T) 😢',
        'Aku di sini mendengarkanmu. Telepon layanan darurat 112 sekarang (>_<) 🥺',
        'Kamu berharga. Layanan SEJIWA siap membantumu (^///^) ❤️ ✨',
      ];

      for (const text of crisisReplies) {
        const res = shapeReply(text, { mode: 'mixed', persona: 'tsundere' });
        assert.equal(detectEmoji(res), false, `Emoji masih ditemukan pada balasan krisis: "${res}"`);
        assert.equal(detectKaomoji(res), false, `Kaomoji masih ditemukan pada balasan krisis: "${res}"`);
        assert.ok(!res.includes('😢'));
        assert.ok(!res.includes('(T_T)'));
        assert.ok(!res.includes('(>_<)'));
      }
    });
  });

  describe('Integritas Tag Aksi', () => {
    it('tidak merusak tag aksi seperti [GIF: ...], [WEATHER: ...], dll', () => {
      const input = 'H-hah?! Jangan ngomong aneh-aneh! 😳 [GIF: anime blush]';
      const res = shapeReply(input, { mode: 'mixed', persona: 'tsundere', rng: () => 0.5 });
      assert.ok(res.includes('[GIF: anime blush]'), 'Tag [GIF: ...] harus tetap utuh');
      assert.equal(detectEmoji(res), false);
      assert.equal(detectKaomoji(res), true);
    });

    it('merapikan spasi ganda setelah pembuangan penanda ekspresi', () => {
      const input = 'Halo   kamu   apa kabar  😤   hari ini?';
      const res = shapeReply(input, { mode: 'plain' });
      assert.equal(res, 'Halo kamu apa kabar hari ini?');
      assert.ok(!res.includes('  '));
    });
  });

  describe('Uji Statistik 2000 Percobaan (Seeded RNG)', () => {
    it('persentase tetap emoji, jadi kaomoji, dan hilang berada dalam toleransi 5 poin', () => {
      const rng = createSeededRng(12345);
      const input = 'Aku nggak lagi nunggu chat kamu kok 😤';

      const keepRateExpected = Number(process.env.EMOJI_KEEP_RATE ?? 0.35); // 35%
      const toKaoRateExpected = Number(process.env.EMOJI_TO_KAOMOJI_RATE ?? 0.40); // 40%
      const plainRateExpected = 1.0 - (keepRateExpected + toKaoRateExpected); // 25%

      let keptEmojiCount = 0;
      let toKaomojiCount = 0;
      let plainCount = 0;

      const TOTAL_TRIALS = 2000;

      for (let i = 0; i < TOTAL_TRIALS; i++) {
        const out = shapeReply(input, {
          mode: 'mixed',
          persona: 'tsundere',
          rng,
        });

        const hasK = detectKaomoji(out);
        const hasE = detectEmoji(out);

        // Pastikan tidak pernah muncul keduanya dalam 1 balasan
        assert.ok(!(hasK && hasE), 'Kaomoji dan emoji muncul bersamaan dalam uji statistik');

        if (hasE) {
          keptEmojiCount++;
        } else if (hasK) {
          toKaomojiCount++;
        } else {
          plainCount++;
        }
      }

      assert.equal(keptEmojiCount + toKaomojiCount + plainCount, TOTAL_TRIALS);

      const keepPct = keptEmojiCount / TOTAL_TRIALS;
      const kaoPct = toKaomojiCount / TOTAL_TRIALS;
      const plainPct = plainCount / TOTAL_TRIALS;

      const tolerance = 0.05; // 5 poin persentase

      assert.ok(
        Math.abs(keepPct - keepRateExpected) <= tolerance,
        `Tingkat emoji (${(keepPct * 100).toFixed(2)}%) di luar batas toleransi ${(keepRateExpected * 100)}% ± 5%`,
      );

      assert.ok(
        Math.abs(kaoPct - toKaoRateExpected) <= tolerance,
        `Tingkat kaomoji (${(kaoPct * 100).toFixed(2)}%) di luar batas toleransi ${(toKaoRateExpected * 100)}% ± 5%`,
      );

      assert.ok(
        Math.abs(plainPct - plainRateExpected) <= tolerance,
        `Tingkat plain (${(plainPct * 100).toFixed(2)}%) di luar batas toleransi ${(plainRateExpected * 100)}% ± 5%`,
      );
    });
  });

  describe('Tes TTS & HTML (K6)', () => {
    it('cleanMarkers membersihkan teks untuk input suara TTS', () => {
      const input = 'Halo (>_<) selamat pagi! 🚀 Jangan lupa sarapan ya (^_^)/ ✨';
      const cleaned = cleanMarkers(input);
      assert.equal(detectEmoji(cleaned), false);
      assert.equal(detectKaomoji(cleaned), false);
      assert.equal(cleaned, 'Halo selamat pagi! Jangan lupa sarapan ya');
    });

    it('pesan berformat HTML dengan kaomoji (>_<) tidak menghasilkan HTML rusak', () => {
      const kaomojiMsg = 'Aduh (>_<) sakit!';
      const safeEscaped = escapeHtml(kaomojiMsg);
      const htmlText = `<b>${safeEscaped}</b>`;

      assert.equal(htmlText, '<b>Aduh (&gt;_&lt;) sakit!</b>');
      // Verifikasi bahwa karakter < dan > di dalam kaomoji tidak menjadi tag HTML yang rusak
      const matchesOpen = htmlText.match(/</g) || [];
      const matchesClose = htmlText.match(/>/g) || [];
      assert.equal(matchesOpen.length, 2, 'Hanya boleh ada 2 tag pembuka HTML (<b> dan </b>)');
      assert.equal(matchesClose.length, 2, 'Hanya boleh ada 2 tag penutup HTML (<b> dan </b>)');
    });
  });
});

