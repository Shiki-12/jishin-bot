import { generateReply } from '../llm.js';

export const LANGUAGE_MAP = {
  en: 'Bahasa Inggris (English)',
  eng: 'Bahasa Inggris (English)',
  english: 'Bahasa Inggris (English)',
  inggris: 'Bahasa Inggris (English)',

  id: 'Bahasa Indonesia',
  ind: 'Bahasa Indonesia',
  indonesia: 'Bahasa Indonesia',
  indonesian: 'Bahasa Indonesia',

  ja: 'Bahasa Jepang (Japanese)',
  jp: 'Bahasa Jepang (Japanese)',
  jpn: 'Bahasa Jepang (Japanese)',
  jepang: 'Bahasa Jepang (Japanese)',
  japanese: 'Bahasa Jepang (Japanese)',
  nihongo: 'Bahasa Jepang (Japanese)',

  ko: 'Bahasa Korea (Korean)',
  kr: 'Bahasa Korea (Korean)',
  kor: 'Bahasa Korea (Korean)',
  korea: 'Bahasa Korea (Korean)',
  korean: 'Bahasa Korea (Korean)',
  hangul: 'Bahasa Korea (Korean)',

  zh: 'Bahasa Mandarin (Chinese)',
  cn: 'Bahasa Mandarin (Chinese)',
  chi: 'Bahasa Mandarin (Chinese)',
  zho: 'Bahasa Mandarin (Chinese)',
  mandarin: 'Bahasa Mandarin (Chinese)',
  chinese: 'Bahasa Mandarin (Chinese)',
  tiongkok: 'Bahasa Mandarin (Chinese)',
  cina: 'Bahasa Mandarin (Chinese)',

  ar: 'Bahasa Arab (Arabic)',
  ara: 'Bahasa Arab (Arabic)',
  arab: 'Bahasa Arab (Arabic)',
  arabic: 'Bahasa Arab (Arabic)',

  de: 'Bahasa Jerman (German)',
  ger: 'Bahasa Jerman (German)',
  deu: 'Bahasa Jerman (German)',
  jerman: 'Bahasa Jerman (German)',
  german: 'Bahasa Jerman (German)',

  fr: 'Bahasa Prancis (French)',
  fra: 'Bahasa Prancis (French)',
  fre: 'Bahasa Prancis (French)',
  prancis: 'Bahasa Prancis (French)',
  perancis: 'Bahasa Prancis (French)',
  french: 'Bahasa Prancis (French)',

  es: 'Bahasa Spanyol (Spanish)',
  spa: 'Bahasa Spanyol (Spanish)',
  spanyol: 'Bahasa Spanyol (Spanish)',
  spanish: 'Bahasa Spanyol (Spanish)',

  ru: 'Bahasa Rusia (Russian)',
  rus: 'Bahasa Rusia (Russian)',
  rusia: 'Bahasa Rusia (Russian)',
  russian: 'Bahasa Rusia (Russian)',

  it: 'Bahasa Italia (Italian)',
  ita: 'Bahasa Italia (Italian)',
  italia: 'Bahasa Italia (Italian)',
  italian: 'Bahasa Italia (Italian)',

  pt: 'Bahasa Portugis (Portuguese)',
  por: 'Bahasa Portugis (Portuguese)',
  portugis: 'Bahasa Portugis (Portuguese)',
  portuguese: 'Bahasa Portugis (Portuguese)',

  nl: 'Bahasa Belanda (Dutch)',
  nld: 'Bahasa Belanda (Dutch)',
  dut: 'Bahasa Belanda (Dutch)',
  belanda: 'Bahasa Belanda (Dutch)',
  dutch: 'Bahasa Belanda (Dutch)',

  jv: 'Bahasa Jawa',
  jaw: 'Bahasa Jawa',
  jawa: 'Bahasa Jawa',
  javanese: 'Bahasa Jawa',

  su: 'Bahasa Sunda',
  sun: 'Bahasa Sunda',
  sunda: 'Bahasa Sunda',
  sundanese: 'Bahasa Sunda',

  th: 'Bahasa Thailand (Thai)',
  tha: 'Bahasa Thailand (Thai)',
  thai: 'Bahasa Thailand (Thai)',
  thailand: 'Bahasa Thailand (Thai)',

  vi: 'Bahasa Vietnam (Vietnamese)',
  vie: 'Bahasa Vietnam (Vietnamese)',
  vietnam: 'Bahasa Vietnam (Vietnamese)',
  vietnamese: 'Bahasa Vietnam (Vietnamese)',

  tl: 'Bahasa Tagalog',
  tgl: 'Bahasa Tagalog',
  tagalog: 'Bahasa Tagalog',
  filipino: 'Bahasa Filipino / Tagalog',

  hi: 'Bahasa Hindi',
  hin: 'Bahasa Hindi',
  hindi: 'Bahasa Hindi',
  india: 'Bahasa Hindi',

  tr: 'Bahasa Turki (Turkish)',
  tur: 'Bahasa Turki (Turkish)',
  turki: 'Bahasa Turki (Turkish)',
  turkish: 'Bahasa Turki (Turkish)',
};

/**
 * Normalisasi nama atau kode bahasa menjadi nama lengkap bahasa target.
 * @param {string} raw
 * @returns {string|null}
 */
export function normalizeLanguage(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (!cleaned) return null;

  if (LANGUAGE_MAP[cleaned]) {
    return LANGUAGE_MAP[cleaned];
  }

  // Jika berupa alfabet yang valid (2-30 karakter)
  if (/^[\p{L}\s-]+$/u.test(cleaned) && cleaned.length >= 2 && cleaned.length <= 30) {
    const capitalized = cleaned
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    return `Bahasa ${capitalized}`;
  }

  return null;
}

/**
 * Deteksi jika teks murni merupakan URL HTTP/HTTPS tunggal.
 * @param {string} text
 * @returns {boolean}
 */
export function isUrlOnly(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  return /^https?:\/\/[^\s]+$/i.test(trimmed);
}

/**
 * Deteksi jika teks tidak memiliki konten selain tautan URL.
 * Mencegah bot dipaksa mengambil URL luar (proteksi SSRF).
 * @param {string} text
 * @returns {boolean}
 */
export function hasNoSubstanceExceptUrl(text) {
  if (!text || typeof text !== 'string') return false;
  if (!/https?:\/\/[^\s]+/i.test(text)) return false;
  const withoutUrl = text.replace(/https?:\/\/[^\s]+/gi, '').trim();
  if (!withoutUrl) return true;
  const words = withoutUrl.split(/\s+/).filter(Boolean);
  return words.length < 3 && withoutUrl.length < 15;
}

/**
 * Parsing argumen perintah /terjemah (baik langsung maupun via reply).
 * @param {string} [commandArgsStr]
 * @param {string} [replyText]
 * @returns {{ targetLang: string|null, text: string|null, isReply: boolean, missingLang: boolean }}
 */
export function parseTranslateArgs(commandArgsStr = '', replyText = '') {
  const trimmedArgs = (commandArgsStr || '').trim();
  const trimmedReply = (replyText || '').trim();

  // Kasus 1: Membalas (reply) pesan
  if (trimmedReply) {
    if (!trimmedArgs) {
      return {
        targetLang: null,
        text: trimmedReply,
        isReply: true,
        missingLang: true,
      };
    }

    const tokens = trimmedArgs.split(/\s+/);
    if (tokens.length === 1) {
      return {
        targetLang: tokens[0],
        text: trimmedReply,
        isReply: true,
        missingLang: false,
      };
    }

    // Jika user menulis "/terjemah en beberapa kata lain" sambil mereply
    const targetLang = tokens[0];
    const directText = tokens.slice(1).join(' ').trim();
    return {
      targetLang,
      text: directText || trimmedReply,
      isReply: !directText,
      missingLang: false,
    };
  }

  // Kasus 2: Argumen langsung tanpa reply
  if (!trimmedArgs) {
    return {
      targetLang: null,
      text: null,
      isReply: false,
      missingLang: true,
    };
  }

  const tokens = trimmedArgs.split(/\s+/);
  if (tokens.length === 1) {
    return {
      targetLang: tokens[0],
      text: '',
      isReply: false,
      missingLang: false,
    };
  }

  const targetLang = tokens[0];
  const text = tokens.slice(1).join(' ').trim();
  return {
    targetLang,
    text,
    isReply: false,
    missingLang: false,
  };
}

/**
 * Parsing argumen perintah /rangkum (baik langsung maupun via reply).
 * @param {string} [commandArgsStr]
 * @param {string} [replyText]
 * @returns {{ text: string, isReply: boolean }}
 */
export function parseSummarizeArgs(commandArgsStr = '', replyText = '') {
  const trimmedArgs = (commandArgsStr || '').trim();
  const trimmedReply = (replyText || '').trim();

  if (trimmedReply) {
    const text = trimmedArgs.length > 30 ? trimmedArgs : trimmedReply;
    return {
      text,
      isReply: text === trimmedReply,
    };
  }

  return {
    text: trimmedArgs,
    isReply: false,
  };
}

/**
 * Buat system prompt khusus penerjemahan yang netral tanpa persona.
 * @param {string} targetLanguage
 * @returns {string}
 */
export function buildTranslationSystemPrompt(targetLanguage) {
  return [
    'You are a professional, accurate, and faithful translator.',
    `Translate the user text into ${targetLanguage}.`,
    'Rules:',
    '- Maintain the exact meaning, tone, nuances, and formatting of the original text.',
    '- Do not add introductory remarks, notes, explanations, or quotes around the translation.',
    '- Output ONLY the final translation directly.',
  ].join('\n');
}

/**
 * Buat system prompt khusus perangkuman yang netral tanpa persona.
 * @returns {string}
 */
export function buildSummarySystemPrompt() {
  return [
    'You are an expert executive assistant and summarizer.',
    'Summarize the user text objectively and clearly.',
    'Rules:',
    '- Identify and highlight key ideas, critical context, and action points.',
    '- Format the summary as concise, well-structured bullet points (- point).',
    '- Keep the language matching the primary language of the input text (or Indonesian if mixed).',
    '- Do NOT include filler greetings, introductions, meta-commentary, or personal opinions.',
    '- Output ONLY the bullet points.',
  ].join('\n');
}

/**
 * Terjemahkan teks ke bahasa target menggunakan LLM dengan prompt netral.
 * @param {object} params
 * @param {string} params.text
 * @param {string} params.targetLang
 * @param {Function} [params.generateReplyFn]
 * @returns {Promise<{ targetLang: string, translatedText: string }>}
 */
export async function translateText({
  text,
  targetLang,
  generateReplyFn = generateReply,
}) {
  if (!text || !text.trim()) {
    throw new Error('EMPTY_TEXT');
  }

  if (isUrlOnly(text) || hasNoSubstanceExceptUrl(text)) {
    throw new Error('URL_BLOCKED');
  }

  const normalizedLang = normalizeLanguage(targetLang);
  if (!normalizedLang) {
    throw new Error('INVALID_LANGUAGE');
  }

  const systemPrompt = buildTranslationSystemPrompt(normalizedLang);
  const result = await generateReplyFn({
    systemPrompt,
    history: [],
    userText: text.trim(),
  });

  return {
    targetLang: normalizedLang,
    translatedText: (result || '').trim(),
  };
}

/**
 * Rangkum teks panjang menjadi poin-poin penting menggunakan LLM dengan prompt netral.
 * @param {object} params
 * @param {string} params.text
 * @param {Function} [params.generateReplyFn]
 * @returns {Promise<{ summaryText: string }>}
 */
export async function summarizeText({
  text,
  generateReplyFn = generateReply,
}) {
  if (!text || !text.trim()) {
    throw new Error('EMPTY_TEXT');
  }

  if (isUrlOnly(text) || hasNoSubstanceExceptUrl(text)) {
    throw new Error('URL_BLOCKED');
  }

  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (trimmed.length < 25 && words.length < 5) {
    throw new Error('TEXT_TOO_SHORT');
  }

  const systemPrompt = buildSummarySystemPrompt();
  const result = await generateReplyFn({
    systemPrompt,
    history: [],
    userText: trimmed,
  });

  return {
    summaryText: (result || '').trim(),
  };
}
