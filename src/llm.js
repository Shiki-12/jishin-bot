// Klien untuk API gaya OpenAI (POST {BASE_URL}/chat/completions).
// Dibaca dari .env: LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, LLM_FALLBACK_MODEL.

import { getActiveModel } from './core/admin.js';
import { logger } from './core/logger.js';
import { recordUsage } from './core/usage.js';

export function getBaseUrl() {
  return (process.env.LLM_BASE_URL || 'https://api.xkiro.com/v1').replace(/\/+$/, '');
}

export function getApiKey() {
  return process.env.LLM_API_KEY || '';
}

export function getFallbackModel() {
  return process.env.LLM_FALLBACK_MODEL ?? 'qwen/qwen3.7-flash:free';
}

let lastLlmUsage = {
  model: '',
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  latencyMs: 0,
};

export function getLastLlmUsage() {
  return { ...lastLlmUsage };
}

export function setLastLlmUsage(usage) {
  lastLlmUsage = { ...usage };
}

const MAX_RETRIES = 2; // percobaan ulang per model (jeda 1 detik, lalu 2 detik)
const TIMEOUT_MS = 30_000;
const TEMPERATURE = 0.8;

export class LlmError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

export class VisionUnsupportedError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'VisionUnsupportedError';
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Error sementara (server sibuk, rate limit, jaringan, timeout): layak dicoba ulang.
export const isTemporary = (err) =>
  err.status === undefined || [408, 429, 500, 502, 503, 504].includes(err.status);

export async function callModel(model, messages, { baseUrl, apiKey, timeoutMs } = {}) {
  const url = (baseUrl || getBaseUrl()).replace(/\/+$/, '');
  const key = apiKey || getApiKey();
  const timeout = timeoutMs || TIMEOUT_MS;

  const start = Date.now();
  let res;
  try {
    res = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model, messages, temperature: TEMPERATURE }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (netErr) {
    const latencyMs = Date.now() - start;
    logger.warn('LLM network error', { model, latencyMs, error: netErr.message });
    throw netErr;
  }

  const latencyMs = Date.now() - start;

  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    logger.warn('LLM API error response', { model, status: res.status, latencyMs });
    throw new LlmError(`HTTP ${res.status} ${body}`, res.status);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((part) => part.text ?? '').join('')
    : (content ?? '');

  const promptTokens = Number(data.usage?.prompt_tokens ?? 0);
  const completionTokens = Number(data.usage?.completion_tokens ?? 0);
  const totalTokens = Number(data.usage?.total_tokens ?? (promptTokens + completionTokens));

  setLastLlmUsage({
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    latencyMs,
  });

  logger.info('LLM completion success', {
    model,
    tokens: totalTokens,
    latencyMs,
  });

  // Beberapa model "thinking" menyertakan blok <think>...</think>; buang supaya tidak terkirim.
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * Minta balasan dari LLM, dengan retry dan model cadangan.
 * @param {{ systemPrompt: string, history: {role: string, text: string}[], userText: string, userId?: number, callModelFn?: Function, retryDelayMs?: number, onUsage?: Function }} args
 * @returns {Promise<string>} teks balasan (bisa kosong)
 */
export async function generateReply({
  systemPrompt,
  history = [],
  userText,
  userId = null,
  callModelFn = callModel,
  retryDelayMs,
  onUsage = null,
}) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({
      role: m.role === 'model' ? 'assistant' : m.role,
      content: m.text,
    })),
    { role: 'user', content: userText },
  ];

  const activeModel = getActiveModel();
  const fallbackModel = getFallbackModel();
  const models = [...new Set([activeModel, fallbackModel].filter(Boolean))];
  const retryDelay = Number(retryDelayMs ?? process.env.LLM_RETRY_DELAY_MS ?? 1000);
  let firstError;

  for (const model of models) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await callModelFn(model, messages);

        // Catat pemakaian token jika ada data usage
        const usage = getLastLlmUsage();
        if (usage.model === model && usage.totalTokens > 0) {
          if (userId) {
            recordUsage({
              userId,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
              latencyMs: usage.latencyMs,
              model: usage.model,
            });
          }
          if (typeof onUsage === 'function') {
            onUsage(usage);
          }
        }

        return result;
      } catch (err) {
        firstError ??= err;
        logger.warn(
          `LLM (${model}) gagal percobaan ${attempt + 1}: ${err.message} ${
            isTemporary(err) ? '(sementara)' : '(bukan error sementara)'
          }`,
        );
        if (!isTemporary(err)) break; // ganti ke model berikutnya
        if (attempt < MAX_RETRIES) await sleep(retryDelay * 2 ** attempt);
      }
    }
  }

  throw firstError;
}

/**
 * Minta balasan dari model vision untuk input gambar multimodal (OpenAI format).
 * @param {object} args
 * @param {string} args.systemPrompt
 * @param {Array<{role: string, text: string}>} [args.history]
 * @param {string} [args.caption]
 * @param {string} args.imageDataUrl
 * @param {number} [args.userId]
 * @param {string} [args.model]
 * @param {Function} [args.callModelFn]
 * @param {Function} [args.onUsage]
 * @returns {Promise<string>}
 */
export async function generateVisionReply({
  systemPrompt,
  history = [],
  caption = '',
  imageDataUrl,
  userId = null,
  model = process.env.LLM_VISION_MODEL || process.env.LLM_MODEL || getActiveModel(),
  callModelFn = callModel,
  onUsage = null,
}) {
  const promptText = (caption || '').trim() || 'Foto apa ini? Tolong jelaskan.';
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({
      role: m.role === 'model' ? 'assistant' : m.role,
      content: m.text,
    })),
    {
      role: 'user',
      content: [
        { type: 'text', text: promptText },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ];

  try {
    const result = await callModelFn(model, messages);

    const usage = getLastLlmUsage();
    if (usage.model === model && usage.totalTokens > 0) {
      if (userId) {
        recordUsage({
          userId,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          latencyMs: usage.latencyMs,
          model: usage.model,
        });
      }
      if (typeof onUsage === 'function') {
        onUsage(usage);
      }
    }

    return result;
  } catch (err) {
    const isUnsupported =
      err.status === 400 ||
      err.status === 422 ||
      /vision|image|unsupported|not supported/i.test(err.message);

    if (isUnsupported) {
      throw new VisionUnsupportedError(err.message, err.status || 400);
    }
    throw err;
  }
}

