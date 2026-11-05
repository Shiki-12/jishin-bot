import { selectBestPhoto, downloadPhotoAsBase64, buildPhotoPlaceholder } from '../core/vision.js';

export default {
  id: 'vision',
  commands: [
    {
      name: 'vision',
      description: 'Petunjuk fitur baca gambar (vision)',
      handler: async (ctx) => {
        const text =
          '🖼️ *Fitur Baca Gambar (Vision)*\n\n' +
          'Kirimkan foto langsung ke chat (dengan atau tanpa caption).\n' +
          '• Di chat pribadi: Bot akan langsung melihat dan merespons fotomu.\n' +
          '• Di grup: Mention bot atau balas (reply) foto bot agar bot merespons.\n' +
          '• Batas ukuran file: maksimal *20 MB*.\n\n' +
          '_Karakter bot akan mengomentari fotomu sesuai kepribadiannya!_';
        await ctx.reply(text, { parse_mode: 'Markdown' });
      },
    },
  ],
  init: async ({ bot, handleChatMessage }) => {
    if (!bot || typeof bot.on !== 'function') return;

    bot.on('message:photo', async (ctx) => {
      const photos = ctx.message?.photo;
      if (!photos || photos.length === 0) return;

      const isPrivate = ctx.chat.type === 'private';
      const botMention = `@${ctx.me?.username || ''}`;
      let caption = ctx.message.caption || '';

      // Di grup, hanya jawab jika di-mention atau me-reply bot
      if (!isPrivate) {
        const mentioned =
          botMention.length > 1 && caption.toLowerCase().includes(botMention.toLowerCase());
        const repliedToBot = ctx.message.reply_to_message?.from?.id === ctx.me?.id;
        if (!mentioned && !repliedToBot) return;

        if (botMention.length > 1) {
          caption = caption.replace(new RegExp(botMention, 'gi'), '').trim();
        }
      }

      // Pilih resolusi terbaik yang masih dalam batas aman (maks 20 MB)
      const bestPhoto = selectBestPhoto(photos);
      if (!bestPhoto) {
        const tooLarge =
          ctx.persona?.strings?.visionTooLarge ??
          'Ukuran foto terlalu besar atau tidak valid (maksimal 20 MB).';
        await ctx.reply(tooLarge);
        return;
      }

      try {
        await ctx.replyWithChatAction('typing');

        const imageDataUrl = await downloadPhotoAsBase64({
          api: ctx.api,
          botToken: process.env.TELEGRAM_BOT_TOKEN || 'dummy_token',
          fileId: bestPhoto.file_id,
        });

        const placeholder = isPrivate
          ? buildPhotoPlaceholder(caption)
          : `${ctx.from?.first_name || 'User'}: ${
              caption ? `[mengirim foto: ${caption}]` : '[mengirim foto]'
            }`;

        const replyOptions = isPrivate
          ? {}
          : { reply_parameters: { message_id: ctx.message.message_id } };

        if (typeof handleChatMessage === 'function') {
          await handleChatMessage(ctx, caption || 'Foto apa ini?', isPrivate, replyOptions, {
            vision: {
              imageUrl: imageDataUrl,
              caption: caption || 'Foto apa ini? Tolong jelaskan.',
              placeholder,
            },
          });
        }
      } catch (err) {
        console.error('Error saat memproses foto:', err.message);
        const errMsg =
          ctx.persona?.strings?.visionDownloadFailed ??
          'Gagal mengunduh foto dari Telegram... Coba kirim ulang ya!';
        await ctx.reply(errMsg).catch(() => {});
      }
    });
  },
};
