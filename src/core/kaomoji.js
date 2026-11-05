/**
 * Palet dan utilitas deteksi ekspresi Kaomoji & Emoji
 */

export const PALETTE = {
  malu: ['(^///^)', '(>///<)', '(//_//)'],
  senang: ['(^_^)', '(^o^)', '(^-^)'],
  girang: ['(^_^)/', '(^o^)/', '(^▽^)'],
  kesal: ['(¬_¬)', '(>_<)', '(-_-#)'],
  sedih: ['(T_T)', '(;_;)', '(._.)'],
  bingung: ['(o_O)', '(?_?)'],
  bosan: ['(-_-)', '(=_=)'],
  kaget: ['(O_O)', '(°o°)'],
  lembut: ['(^_^)', '(^-^)', '(^_^;)'],
};

/**
 * Regex untuk mencocokkan emoji tanpa mengenai angka, tanda pagar (#), atau bintang (*).
 * Sesuai spesifikasi K1: Extended_Pictographic, Emoji_Presentation, variation selector 16, dan ZWJ.
 */
export const EMOJI_REGEX = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu;

/**
 * Regex deteksi kaomoji:
 * Mencocokkan ekspresi wajah dalam tanda kurung yang memuat simbol-simbol wajah khas,
 * serta seluruh pola palet standar, tanpa mencocokkan teks biasa seperti (ok), (10m), (a), (3).
 */
export const KAOMOJI_REGEX = /(?:\((?=[^)\s]*[\^><¬▽°=~;])[^)\s]{2,15}\)(?:\/)?|\((?:T_T|;_;|\._\.|o_O|O_O|\?_\?|-_-(?:#)?|=_=|(?:\/){2}_(?:\/){2})\))/g;

/**
 * Peta emoji ke mood emosi karakter menggunakan escape sequence \\u{...}.
 * Minimal mencakup mood: malu, kesal, bosan, senang, sedih, bingung, kaget.
 */
export const EMOJI_TO_MOOD = {
  // malu (flushed, pleading, monkey, blushing, eyes)
  '\u{1F633}': 'malu',
  '\u{1F97A}': 'malu',
  '\u{1F648}': 'malu',
  '\u{1F979}': 'malu',
  '\u{263A}': 'malu',

  // kesal (pouting, angry, furious, steam, unamused, anger symbol)
  '\u{1F624}': 'kesal',
  '\u{1F621}': 'kesal',
  '\u{1F620}': 'kesal',
  '\u{1F92C}': 'kesal',
  '\u{1F612}': 'kesal',
  '\u{1F4A2}': 'kesal',

  // bosan (expressionless, neutral, roll eyes, sleepy, yawn, sleeping)
  '\u{1F611}': 'bosan',
  '\u{1F610}': 'bosan',
  '\u{1F644}': 'bosan',
  '\u{1F62A}': 'bosan',
  '\u{1F971}': 'bosan',
  '\u{1F634}': 'bosan',

  // senang (grin, smiley, smile, blush, wink, love, heart eyes, sparkles, party)
  '\u{1F600}': 'senang',
  '\u{1F603}': 'senang',
  '\u{1F604}': 'senang',
  '\u{1F601}': 'senang',
  '\u{1F60A}': 'senang',
  '\u{1F609}': 'senang',
  '\u{1F970}': 'senang',
  '\u{1F60D}': 'senang',
  '\u{2728}': 'senang',
  '\u{1F389}': 'senang',

  // girang (laugh, star-struck, joy, rofl, rocket, hands up, clap)
  '\u{1F606}': 'girang',
  '\u{1F929}': 'girang',
  '\u{1F602}': 'girang',
  '\u{1F923}': 'girang',
  '\u{1F680}': 'girang',
  '\u{1F64C}': 'girang',
  '\u{1F44F}': 'girang',

  // sedih (cry, loudly crying, pensive, worried, sweat sad, broken heart, weary)
  '\u{1F622}': 'sedih',
  '\u{1F62D}': 'sedih',
  '\u{1F614}': 'sedih',
  '\u{1F61F}': 'sedih',
  '\u{1F625}': 'sedih',
  '\u{1F494}': 'sedih',
  '\u{1F629}': 'sedih',

  // bingung (thinking, eyebrow, confused, upside-down, monocle)
  '\u{1F914}': 'bingung',
  '\u{1F928}': 'bingung',
  '\u{1F615}': 'bingung',
  '\u{1F643}': 'bingung',
  '\u{1F9D0}': 'bingung',

  // kaget (astonished, open mouth, scream, exploding, hushed, bulb)
  '\u{1F632}': 'kaget',
  '\u{1F62E}': 'kaget',
  '\u{1F631}': 'kaget',
  '\u{1F92F}': 'kaget',
  '\u{1F62F}': 'kaget',
  '\u{1F4A1}': 'kaget',

  // lembut (halo, hugging, pray, cherry blossom, tea, seedling)
  '\u{1F607}': 'lembut',
  '\u{1F917}': 'lembut',
  '\u{1F64F}': 'lembut',
  '\u{1F338}': 'lembut',
  '\u{2615}': 'lembut',
  '\u{1F33F}': 'lembut',
};

/**
 * Ambil satu kaomoji dari palet berdasarkan mood emosi dan generator angka acak.
 */
export function kao(mood, rng = Math.random) {
  const list = PALETTE[mood] || PALETTE.senang;
  const idx = Math.floor(rng() * list.length);
  return list[idx] || list[0];
}

/**
 * Escape karakter HTML aman (termasuk < dan > pada kaomoji seperti (>_<)).
 */
export function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Cek apakah string memuat emoji valid (tanpa keliru mendeteksi angka, #, *).
 */
export function detectEmoji(text) {
  if (!text || typeof text !== 'string') return false;
  return /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/u.test(text);
}

/**
 * Cek apakah string memuat kaomoji valid.
 */
export function detectKaomoji(text) {
  if (!text || typeof text !== 'string') return false;
  return new RegExp(KAOMOJI_REGEX.source, 'u').test(text);
}

/**
 * Dapatkan mood emosi dari karakter emoji.
 */
export function getMoodForEmoji(emoji) {
  if (!emoji) return null;
  if (EMOJI_TO_MOOD[emoji]) return EMOJI_TO_MOOD[emoji];
  const clean = emoji.replace(/[\uFE0F\u200D]/g, '');
  if (EMOJI_TO_MOOD[clean]) return EMOJI_TO_MOOD[clean];
  return null;
}

