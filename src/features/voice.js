import {
  isVoiceTooLong,
  speechToText,
  getPersonaVoice,
  textToSpeech,
} from '../core/voice.js';
import { getSetting, setSetting } from '../core/settings.js';
import { getPersonality } from '../personalities/index.js';
import { logger } from '../core/logger.js';

export default {
  id: 'voice',

  commands: [
    {
      name: 'voice',
      description: 'Aktifkan atau matikan balasan suara (TTS) bot (/voice [on|off])',
      handler: async (ctx) => {
        const personaId = getSetting(ctx, 'persona') || 'tsundere';
        const persona = getPersonality(personaId, ctx);
        const args = (ctx.message?.text || '').split(/\s+/).slice(1);
        const action = (args[0] || '').toLowerCase();

        if (action === 'on') {
          setSetting(ctx, 'voice_reply', 1);
          const msg =
            persona.strings?.voiceEnabled ??
            '🎤 Balasan pesan suara (TTS) diaktifkan.';
          await ctx.reply(msg);
          return;
        }

        if (action === 'off') {
          setSetting(ctx, 'voice_reply', 0);
          const msg =
            persona.strings?.voiceDisabled ??
            '🔇 Balasan pesan suara (TTS) dinonaktifkan.';
          await ctx.reply(msg);
          return;
        }

        // Tampilkan status saat ini
        const current = getSetting(ctx, 'voice_reply', 0);
        const statusText = current === 1 ? 'aktif (ON)' : 'nonaktif (OFF)';
        await ctx.reply(
          `🎙️ *Pengaturan Balasan Suara (TTS):*\nStatus saat ini: *${statusText}*\n\n` +
            'Gunakan `/voice on` untuk menyalakan atau `/voice off` untuk mematikan.',
          { parse_mode: 'Markdown' },
        );
      },
    },
  ],

  init: async ({ bot, handleChatMessage }) => {
    if (!bot || typeof bot.on !== 'function') return;

    bot.on('message:voice', async (ctx) => {
      const voice = ctx.message?.voice;
      if (!voice) return;

      const persona = ctx.persona;
      const isPrivate = ctx.chat?.type === 'private';

      // Di grup, hanya jawab jika voice me-reply bot
      if (!isPrivate) {
        const repliedToBot = ctx.message.reply_to_message?.from?.id === ctx.me?.id;
        if (!repliedToBot) return;
      }

      // Validasi durasi pesan suara masuk (maksimal 60 detik)
      if (isVoiceTooLong(voice.duration)) {
        const tooLongMsg =
          persona.strings?.voiceTooLong ??
          '⚠️ Durasi pesan suara terlalu panjang! Maksimal 60 detik.';
        await ctx.reply(tooLongMsg).catch(() => {});
        return;
      }

      try {
        await ctx.replyWithChatAction('record_voice').catch(() => {});

        let transcribedText = '';

        if (typeof ctx.speechToTextFn === 'function') {
          // Fungsi mock yang disuntikkan saat pengujian
          transcribedText = await ctx.speechToTextFn(ctx);
        } else {
          // Unduh berkas audio voice dari Telegram
          const file = await ctx.getFile();
          if (!file?.file_path) {
            throw new Error('FILE_PATH_EMPTY');
          }

          const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
          const res = await fetch(fileUrl, { signal: AbortSignal.timeout(15_000) });
          if (!res.ok) {
            throw new Error(`TELEGRAM_FILE_DOWNLOAD_FAIL_${res.status}`);
          }

          const arrayBuf = await res.arrayBuffer();
          const audioBuffer = Buffer.from(arrayBuf);

          transcribedText = await speechToText({ audioBuffer });
        }

        if (!transcribedText) {
          await ctx.reply('...Tidak ada ucapan kata yang terdeteksi dari pesan suaramu.');
          return;
        }

        // Tampilkan konfirmasi hasil transkripsi
        const heardMsg = (
          persona.strings?.voiceHeard ?? '🎙️ Kudengar: *"{text}"*'
        ).replace('{text}', transcribedText);
        await ctx.reply(heardMsg, { parse_mode: 'Markdown' }).catch(() => {});

        // Teruskan transkripsi sebagai pesan chat biasa ke pipeline LLM
        if (typeof handleChatMessage === 'function') {
          const replyOptions = isPrivate
            ? {}
            : { reply_parameters: { message_id: ctx.message.message_id } };
          await handleChatMessage(ctx, transcribedText, isPrivate, replyOptions);
        }
      } catch (err) {
        if (err.message === 'STT_NOT_SUPPORTED' || err.status === 404) {
          const unsupportedMsg =
            persona.strings?.voiceSttUnsupported ??
            '⚠️ Fitur transkripsi suara (STT) belum didukung oleh gateway API saat ini. Silakan kirimkan pesan teks ya.';
          await ctx.reply(unsupportedMsg).catch(() => {});
          return;
        }

        logger.error('Error processing voice message', { error: err.message });
        await ctx.reply(persona.errorMessage).catch(() => {});
      }
    });
  },
};

