import {
  PALETTE,
  EMOJI_REGEX,
  KAOMOJI_REGEX,
  detectEmoji,
  detectKaomoji,
  getMoodForEmoji,
  kao,
  escapeHtml,
} from './kaomoji.js';

export {
  PALETTE,
  EMOJI_REGEX,
  KAOMOJI_REGEX,
  detectEmoji,
  detectKaomoji,
  kao,
  escapeHtml,
};

/**
 * Preferensi mood kaomoji per persona (bukan batasan mutlak).
 */
export const PERSONA_PREFERENCES = {
  tsundere: ['malu', 'kesal'],
  mika: ['malu', 'kesal'],
  kalem: ['lembut', 'senang'],
  rin: ['lembut', 'senang'],
  ceria: ['girang', 'senang'],
  nana: ['girang', 'senang'],
  sarkas: ['bosan', 'kesal'],
  kael: ['bosan', 'kesal'],
  custom: ['senang', 'lembut'],
};

/**
 * Deteksi apakah teks memuat pesan krisis atau nomor layanan darurat.
 * Sesuai ATURAN KERAS 4 & K2: tidak boleh memuat emoji maupun kaomoji.
 */
export function isCrisisText(text) {
  if (!text || typeof text !== 'string') return false;
  if (/119\s*\(?\s*(?:ext|ekstensi)\.?\s*8\s*\)?/i.test(text)) return true;
  if (/\b112\b/.test(text)) return true;
  if (/SEJIWA/i.test(text)) return true;
  if (/1500-?567/.test(text)) return true;
  return false;
}

/**
 * Bersihkan seluruh penanda ekspresi (emoji dan kaomoji) dari teks.
 * Digunakan untuk mode plain, kondisi krisis, dan input TTS suara.
 */
export function cleanMarkers(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(new RegExp(KAOMOJI_REGEX.source, 'gu'), '')
    .replace(new RegExp(EMOJI_REGEX.source, 'gu'), '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,!?:;])/g, '$1')
    .trim();
}

/**
 * Bentuk gaya ekspresi balasan (shapeReply):
 * Menyesuaikan kaomoji dan emoji sesuai mode ('mixed', 'emoji', 'kaomoji', 'plain', 'off').
 *
 * @param {string} text Teks yang akan dibentuk
 * @param {object} [options]
 * @param {string} [options.mode] Mode ekspresi (default dari env EXPRESSION_MODE || 'mixed')
 * @param {string} [options.persona] Persona aktif (tsundere, kalem, ceria, sarkas, dll)
 * @param {function} [options.rng] Generator angka acak deterministik untuk pengujian
 * @returns {string}
 */
export function shapeReply(text, {
  mode,
  persona = 'tsundere',
  rng = Math.random,
} = {}) {
  if (!text || typeof text !== 'string') return text;

  const effectiveMode = mode || process.env.EXPRESSION_MODE || 'mixed';

  // Mode off: lewati apa adanya
  if (effectiveMode === 'off') {
    return text;
  }

  // Lindungi tag aksi (misalnya [GIF: ...], [WEATHER: ...], dll)
  const actionTags = [];
  let workingText = text.replace(/\[[A-Z0-9_]+(?::[^\]]*)?\]/g, (match) => {
    actionTags.push(match);
    return `__ACT_TAG_${actionTags.length - 1}__`;
  });

  // Balasan krisis: buang SEMUA emoji dan kaomoji (Aturan 4 & K2)
  if (isCrisisText(workingText) || effectiveMode === 'plain') {
    workingText = cleanMarkers(workingText);
    return workingText.replace(/__ACT_TAG_(\d+)__/g, (_, idx) => actionTags[Number(idx)]);
  }

  const hasKaomoji = detectKaomoji(workingText);
  const hasEmoji = detectEmoji(workingText);

  // Jika teks polos dari awal (tanpa emoji dan tanpa kaomoji), kembalikan
  if (!hasKaomoji && !hasEmoji) {
    return workingText.replace(/__ACT_TAG_(\d+)__/g, (_, idx) => actionTags[Number(idx)]);
  }

  if (effectiveMode === 'emoji') {
    // Mode emoji: hapus semua kaomoji, sisakan maksimal 1 emoji
    workingText = workingText.replace(new RegExp(KAOMOJI_REGEX.source, 'gu'), '');
    let firstEmoji = true;
    workingText = workingText.replace(new RegExp(EMOJI_REGEX.source, 'gu'), (match) => {
      if (firstEmoji) {
        firstEmoji = false;
        return match;
      }
      return '';
    });
  } else if (effectiveMode === 'kaomoji') {
    // Mode kaomoji: ubah emoji pertama jadi kaomoji (atau pertahankan 1 kaomoji yang ada), buang emoji
    if (hasKaomoji) {
      // Buang semua emoji
      workingText = workingText.replace(new RegExp(EMOJI_REGEX.source, 'gu'), '');
      // Pertahankan tepat 1 kaomoji pertama
      let firstKao = true;
      workingText = workingText.replace(new RegExp(KAOMOJI_REGEX.source, 'gu'), (match) => {
        if (firstKao) {
          firstKao = false;
          return match;
        }
        return '';
      });
    } else {
      // Model hanya menulis emoji: ganti emoji pertama jadi kaomoji setara, buang sisanya
      const firstEmojiMatch = workingText.match(new RegExp(EMOJI_REGEX.source, 'u'));
      const firstEmojiChar = firstEmojiMatch ? firstEmojiMatch[0] : null;

      let mood = getMoodForEmoji(firstEmojiChar);
      if (!mood) {
        const prefs = PERSONA_PREFERENCES[persona?.toLowerCase()] || PERSONA_PREFERENCES.tsundere;
        mood = prefs[Math.floor(rng() * prefs.length)];
      }
      const chosenKao = kao(mood, rng);

      let firstEmoji = true;
      workingText = workingText.replace(new RegExp(EMOJI_REGEX.source, 'gu'), (match, offset) => {
        if (firstEmoji) {
          firstEmoji = false;
          const needLeadingSpace = offset > 0 && !/\s/.test(workingText[offset - 1]);
          return (needLeadingSpace ? ' ' : '') + chosenKao;
        }
        return '';
      });
    }
  } else {
    // Mode default: 'mixed'
    if (hasKaomoji) {
      // Kalau model sudah menulis kaomoji sendiri: pertahankan satu, buang emoji dan kaomoji lainnya
      workingText = workingText.replace(new RegExp(EMOJI_REGEX.source, 'gu'), '');
      let firstKao = true;
      workingText = workingText.replace(new RegExp(KAOMOJI_REGEX.source, 'gu'), (match) => {
        if (firstKao) {
          firstKao = false;
          return match;
        }
        return '';
      });
    } else {
      // Model hanya menulis emoji: terapkan probabilitas campuran
      const keepRate = Number(process.env.EMOJI_KEEP_RATE ?? 0.35);
      const toKaoRate = Number(process.env.EMOJI_TO_KAOMOJI_RATE ?? 0.40);
      const roll = rng();

      if (roll < keepRate) {
        // Pertahankan SATU emoji pertama, buang emoji lainnya
        let firstEmoji = true;
        workingText = workingText.replace(new RegExp(EMOJI_REGEX.source, 'gu'), (match) => {
          if (firstEmoji) {
            firstEmoji = false;
            return match;
          }
          return '';
        });
      } else if (roll < keepRate + toKaoRate) {
        // Ganti emoji pertama jadi kaomoji setara
        const firstEmojiMatch = workingText.match(new RegExp(EMOJI_REGEX.source, 'u'));
        const firstEmojiChar = firstEmojiMatch ? firstEmojiMatch[0] : null;

        let mood = getMoodForEmoji(firstEmojiChar);
        if (!mood) {
          const prefs = PERSONA_PREFERENCES[persona?.toLowerCase()] || PERSONA_PREFERENCES.tsundere;
          mood = prefs[Math.floor(rng() * prefs.length)];
        }
        const chosenKao = kao(mood, rng);

        let firstEmoji = true;
        workingText = workingText.replace(new RegExp(EMOJI_REGEX.source, 'gu'), (match, offset) => {
          if (firstEmoji) {
            firstEmoji = false;
            const needLeadingSpace = offset > 0 && !/\s/.test(workingText[offset - 1]);
            return (needLeadingSpace ? ' ' : '') + chosenKao;
          }
          return '';
        });
      } else {
        // Sisanya (~25%): buang semua emoji (polos)
        workingText = workingText.replace(new RegExp(EMOJI_REGEX.source, 'gu'), '');
      }
    }
  }

  // Rapikan spasi ganda setelah penghapusan
  workingText = workingText
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,!?:;])/g, '$1')
    .trim();

  // Kembalikan tag aksi yang dilindungi
  return workingText.replace(/__ACT_TAG_(\d+)__/g, (_, idx) => actionTags[Number(idx)]);
}
