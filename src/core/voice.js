import { cleanMarkers } from './expression.js';

export const PERSONA_VOICES = {
  tsundere: 'cute-girl',
  kalem: 'calm-girl',
  ceria: 'energetic-female',
  sarkas: 'normal-male',
  custom: 'cute-girl',
};

export const MAX_VOICE_DURATION_SECONDS = 60;

/**
 * Dapatkan ID suara TTS sesuai persona aktif.
 */
export function getPersonaVoice(personaId) {
  return PERSONA_VOICES[personaId] || PERSONA_VOICES.tsundere;
}

/**
 * Validasi apakah durasi pesan suara melebihi batas maksimal (60 detik).
 */
export function isVoiceTooLong(duration, max = MAX_VOICE_DURATION_SECONDS) {
  return typeof duration === 'number' && duration > max;
}

/**
 * Konversi teks balasan bot menjadi buffer audio MP3 via endpoint TTS gateway.
 * @param {object} options
 * @param {string} options.text Teks yang akan diucapkan
 * @param {string} [options.voice] Nama voice (default: cute-girl)
 * @param {string} [options.model] Nama model TTS (default: xkiro-voice)
 * @param {string} [options.baseUrl] Base URL API OpenAI-compatible
 * @param {string} [options.apiKey] API key gateway
 * @returns {Promise<Buffer|null>}
 */
export async function textToSpeech({
  text,
  voice = 'cute-girl',
  model = process.env.TTS_MODEL || 'xkiro-voice',
  baseUrl = (process.env.LLM_BASE_URL || 'https://api.xkiro.com/v1').replace(/\/+$/, ''),
  apiKey = process.env.LLM_API_KEY,
} = {}) {
  // Buang seluruh emoji dan kaomoji sebelum dikirim ke endpoint TTS (K3)
  const markerCleaned = cleanMarkers(text);
  const cleanText = (markerCleaned || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[[A-Z0-9_]+:[^\]]*\]/gi, '')
    .replace(/[*_`~\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanText) return null;

  // Batasi panjang teks maksimal 250 karakter agar hemat kuota & latensi cepat
  const inputText = cleanText.slice(0, 250);

  const res = await fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: inputText,
      voice,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`TTS HTTP ${res.status}: ${errBody.slice(0, 150)}`);
  }

  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Konversi berkas audio Telegram (OGG/Opus) menjadi teks via endpoint transkripsi STT.
 * @param {object} options
 * @param {Buffer} options.audioBuffer Buffer file audio
 * @param {string} [options.fileName] Nama file audio (default: voice.ogg)
 * @param {string} [options.model] Model transkripsi (default: whisper-1)
 * @param {string} [options.baseUrl] Base URL API OpenAI-compatible
 * @param {string} [options.apiKey] API key gateway
 * @returns {Promise<string>}
 */
export async function speechToText({
  audioBuffer,
  fileName = 'voice.ogg',
  model = process.env.STT_MODEL || 'whisper-1',
  baseUrl = (process.env.STT_BASE_URL || process.env.LLM_BASE_URL || 'https://api.xkiro.com/v1').replace(/\/+$/, ''),
  apiKey = process.env.LLM_API_KEY,
} = {}) {
  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
  formData.append('file', blob, fileName);
  formData.append('model', model);

  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    if (res.status === 404 || /not_found/i.test(errBody)) {
      const err = new Error('STT_NOT_SUPPORTED');
      err.status = 404;
      throw err;
    }
    throw new Error(`STT HTTP ${res.status}: ${errBody.slice(0, 150)}`);
  }

  const data = await res.json();
  return data.text ? data.text.trim() : '';
}
