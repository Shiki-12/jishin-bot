import {
  translateText,
  summarizeText,
  parseTranslateArgs,
  parseSummarizeArgs,
} from '../core/translator.js';
import { getSetting, getEffectiveExpressionMode } from '../core/settings.js';
import { shapeReply } from '../core/expression.js';
import { getPersonality } from '../personalities/index.js';

/**
 * Kirim balasan dengan aman ke Telegram (membagi pesan jika melebihi 4000 karakter).
 * @param {object} ctx
 * @param {string} fullText
 */
async function safeReply(ctx, fullText) {
  if (fullText.length <= 4000) {
    return await ctx.reply(fullText);
  }

  let remaining = fullText;
  while (remaining.length > 0) {
    const chunk = remaining.slice(0, 3800);
    remaining = remaining.slice(3800);
    await ctx.reply(chunk);
  }
}

export default {
  id: 'translator',

  commands: [
    {
      name: 'terjemah',
      description: 'Terjemahkan teks ke bahasa lain (/terjemah <bahasa> <teks> atau balas pesan)',
      handler: async (ctx) => {
        const rawArgs = ctx.message?.text?.split(/\s+/).slice(1).join(' ').trim() || '';
        const replyText =
          ctx.message?.reply_to_message?.text ||
          ctx.message?.reply_to_message?.caption ||
          '';

        const parsed = parseTranslateArgs(rawArgs, replyText);

        if (parsed.missingLang || (!parsed.text && !parsed.isReply)) {
          await ctx.reply(
            '🌐 Format Perintah Terjemah:\n' +
              '• /terjemah <bahasa> <teks>\n' +
              '  Contoh: /terjemah en Selamat pagi, apa kabarmu?\n' +
              '• Balas (reply) pesan dengan: /terjemah <bahasa>\n' +
              '  Contoh reply: /terjemah en atau /terjemah jepang',
          );
          return;
        }

        if (!parsed.text) {
          await ctx.reply('⚠️ Harap sertakan teks yang ingin diterjemahkan atau balas pesan yang berisi teks!');
          return;
        }

        const personaId = getSetting(ctx, 'persona') || 'tsundere';
        const persona = getPersonality(personaId, ctx);

        try {
          if (typeof ctx.replyWithChatAction === 'function') {
            await ctx.replyWithChatAction('typing').catch(() => {});
          }

          const res = await translateText({
            text: parsed.text,
            targetLang: parsed.targetLang,
          });

          const rawIntro =
            typeof persona.strings?.translateIntro === 'function'
              ? persona.strings.translateIntro(res.targetLang)
              : `Berikut hasil terjemahan ke ${res.targetLang}:`;
          const exprMode = getEffectiveExpressionMode(ctx);
          const intro = shapeReply(rawIntro, { mode: exprMode, persona: persona.id });

          await safeReply(ctx, `${intro}\n\n${res.translatedText}`);
        } catch (err) {
          if (err.message === 'URL_BLOCKED') {
            const blockedMsg =
              persona.strings?.translateUrlBlocked ||
              'Tautan URL tidak dibuka otomatis demi keamanan (proteksi SSRF). Silakan salin dan tempel teksnya secara langsung ya!';
            await ctx.reply(blockedMsg);
            return;
          }

          if (err.message === 'INVALID_LANGUAGE') {
            await ctx.reply(
              `⚠️ Bahasa target "${parsed.targetLang}" tidak dikenali. Contoh: "en", "id", "jepang", "korea", "arab", "mandarin", "jerman", dll.`,
            );
            return;
          }

          console.error('Error saat menerjemahkan:', err);
          await ctx.reply(persona.errorMessage || 'Terjadi kesalahan saat menerjemahkan teks.');
        }
      },
    },
    {
      name: 'rangkum',
      description: 'Rangkum teks panjang atau pesan yang dibalas (/rangkum <teks> atau balas pesan)',
      handler: async (ctx) => {
        const rawArgs = ctx.message?.text?.split(/\s+/).slice(1).join(' ').trim() || '';
        const replyText =
          ctx.message?.reply_to_message?.text ||
          ctx.message?.reply_to_message?.caption ||
          '';

        const parsed = parseSummarizeArgs(rawArgs, replyText);

        if (!parsed.text) {
          await ctx.reply(
            '📝 Format Perintah Rangkum:\n' +
              '• /rangkum <teks panjang>\n' +
              '• Balas (reply) pesan panjang dengan /rangkum',
          );
          return;
        }

        const personaId = getSetting(ctx, 'persona') || 'tsundere';
        const persona = getPersonality(personaId, ctx);

        try {
          if (typeof ctx.replyWithChatAction === 'function') {
            await ctx.replyWithChatAction('typing').catch(() => {});
          }

          const res = await summarizeText({ text: parsed.text });

          const rawIntro =
            persona.strings?.summarizeIntro ||
            'Berikut ringkasan poin-poin pentingnya:';
          const exprMode = getEffectiveExpressionMode(ctx);
          const intro = shapeReply(rawIntro, { mode: exprMode, persona: persona.id });

          await safeReply(ctx, `${intro}\n\n${res.summaryText}`);
        } catch (err) {
          if (err.message === 'URL_BLOCKED') {
            const blockedMsg =
              persona.strings?.summarizeUrlBlocked ||
              'Tautan URL tidak diambil secara otomatis demi keamanan (proteksi SSRF). Silakan salin dan tempel teks artikelnya ke sini ya!';
            await ctx.reply(blockedMsg);
            return;
          }

          if (err.message === 'TEXT_TOO_SHORT') {
            await ctx.reply('⚠️ Teks terlalu pendek untuk dirangkum! Berikan teks artikel atau paragraf yang lebih panjang ya.');
            return;
          }

          console.error('Error saat merangkum:', err);
          await ctx.reply(persona.errorMessage || 'Terjadi kesalahan saat merangkum teks.');
        }
      },
    },
  ],

  tags: [
    {
      name: 'TRANSLATE',
      promptHint:
        'Terjemahkan teks ke bahasa target. Format: [TRANSLATE: bahasa_tujuan | teks]. Contoh: [TRANSLATE: en | Selamat pagi]. Keluarkan tag ini jika user meminta bantuan terjemahan.',
      handle: async (ctx, args) => {
        if (!args || args.length < 2) return;
        const targetLang = args[0]?.trim();
        const text = args.slice(1).join(' | ').trim();
        if (!targetLang || !text) return;

        const personaId = getSetting(ctx, 'persona') || 'tsundere';
        const persona = getPersonality(personaId, ctx);

        try {
          const res = await translateText({ text, targetLang });
          const rawIntro =
            typeof persona.strings?.translateIntro === 'function'
              ? persona.strings.translateIntro(res.targetLang)
              : `Berikut hasil terjemahan ke ${res.targetLang}:`;
          const exprMode = getEffectiveExpressionMode(ctx);
          const intro = shapeReply(rawIntro, { mode: exprMode, persona: persona.id });

          await safeReply(ctx, `${intro}\n\n${res.translatedText}`);
        } catch (err) {
          console.error(`Gagal memproses tag [TRANSLATE]:`, err.message);
        }
      },
    },
    {
      name: 'SUMMARIZE',
      promptHint:
        'Rangkum teks panjang menjadi poin-poin ringkas. Format: [SUMMARIZE: teks]. Contoh: [SUMMARIZE: teks artikel panjang]. Keluarkan tag ini jika user meminta merangkum teks.',
      handle: async (ctx, args) => {
        if (!args || args.length < 1) return;
        const text = args.join(' | ').trim();
        if (!text) return;

        const personaId = getSetting(ctx, 'persona') || 'tsundere';
        const persona = getPersonality(personaId, ctx);

        try {
          const res = await summarizeText({ text });
          const rawIntro =
            persona.strings?.summarizeIntro ||
            'Berikut ringkasan poin-poin pentingnya:';
          const exprMode = getEffectiveExpressionMode(ctx);
          const intro = shapeReply(rawIntro, { mode: exprMode, persona: persona.id });

          await safeReply(ctx, `${intro}\n\n${res.summaryText}`);
        } catch (err) {
          console.error(`Gagal memproses tag [SUMMARIZE]:`, err.message);
        }
      },
    },
  ],
};

