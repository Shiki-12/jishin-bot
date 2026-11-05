import { InputFile, InlineKeyboard } from 'grammy';
import {
  getUserExportData,
  deleteUserData,
  getPrivacyPolicyText,
} from '../core/export.js';
import { getSetting } from '../core/settings.js';
import { getPersonality } from '../personalities/index.js';

export default {
  id: 'export',

  commands: [
    {
      name: 'export',
      description: 'Unduh seluruh data pribadi yang tersimpan di bot (format JSON)',
      handler: async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) return;

        const personaId = getSetting(ctx, 'persona') || 'tsundere';
        const persona = getPersonality(personaId, ctx);

        try {
          if (typeof ctx.replyWithChatAction === 'function') {
            await ctx.replyWithChatAction('upload_document').catch(() => {});
          }

          const data = getUserExportData(userId);
          const jsonStr = JSON.stringify(data, null, 2);
          const fileBuffer = Buffer.from(jsonStr, 'utf-8');
          const fileName = `data_export_${userId}.json`;

          const caption =
            persona.strings?.exportDone ??
            '📄 Berikut seluruh salinan data pribadimu (format JSON).';

          await ctx.replyWithDocument(new InputFile(fileBuffer, fileName), {
            caption,
          });
        } catch (err) {
          console.error('Gagal mengekspor data user:', err);
          await ctx.reply('⚠️ Gagal mengekspor data saat ini.');
        }
      },
    },
    {
      name: 'deleteme',
      description: 'Hapus seluruh data pribadi secara permanen (konfirmasi dua langkah)',
      handler: async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) return;

        const personaId = getSetting(ctx, 'persona') || 'tsundere';
        const persona = getPersonality(personaId, ctx);

        const warningTemplate =
          persona.strings?.deleteWarning ??
          '⚠️ *Peringatan Penghapusan Data Permanen!*\n\n' +
            'Tindakan ini akan menghapus SELURUH data pribadimu dari bot:\n' +
            '• Catatan, to-do list, dan pengingat\n' +
            '• Catatan pengeluaran & jurnal mood\n' +
            '• Kebiasaan (habits), fakta ingatan AI, poin affinity & skor game\n' +
            '• Profil dan preferensi akun\n\n' +
            '_Data yang sudah dihapus TIDAK DAPAT dipulihkan. Apakah kamu yakin?_';

        const keyboard = new InlineKeyboard()
          .text('🔴 Ya, Hapus Semua Dataku', `delme:confirm:${userId}`)
          .text('❌ Batal', `delme:cancel:${userId}`);

        await ctx.reply(warningTemplate, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      },
    },
    {
      name: 'privacy',
      description: 'Lihat kebijakan privasi dan pengelolaan data pengguna',
      handler: async (ctx) => {
        const text = getPrivacyPolicyText();
        await ctx.reply(text, { parse_mode: 'Markdown' });
      },
    },
  ],

  callbacks: [
    {
      prefix: 'delme:confirm:',
      handler: async (ctx) => {
        const userId = ctx.from?.id;
        const targetId = Number(ctx.callbackQuery.data.slice('delme:confirm:'.length));

        if (!userId || userId !== targetId) {
          await ctx.answerCallbackQuery({
            text: 'Aksi ini hanya dapat dikonfirmasi oleh pemilik akun.',
            show_alert: true,
          }).catch(() => {});
          return;
        }

        const personaId = getSetting(ctx, 'persona') || 'tsundere';
        const persona = getPersonality(personaId, ctx);

        try {
          deleteUserData(userId);

          await ctx.answerCallbackQuery({ text: 'Data berhasil dihapus.' }).catch(() => {});

          const successMsg =
            persona.strings?.deleteSuccess ??
            '✅ *Seluruh data pribadimu telah berhasil dihapus secara permanen.*';

          await ctx.editMessageText(successMsg, { parse_mode: 'Markdown' }).catch(() => {});
        } catch (err) {
          console.error('Gagal menghapus data user:', err);
          await ctx.answerCallbackQuery({ text: 'Terjadi kesalahan saat menghapus data.' }).catch(() => {});
        }
      },
    },
    {
      prefix: 'delme:cancel:',
      handler: async (ctx) => {
        const userId = ctx.from?.id;
        const targetId = Number(ctx.callbackQuery.data.slice('delme:cancel:'.length));

        if (!userId || userId !== targetId) {
          await ctx.answerCallbackQuery({
            text: 'Aksi ini hanya dapat dibatalkan oleh pemilik akun.',
            show_alert: true,
          }).catch(() => {});
          return;
        }

        const personaId = getSetting(ctx, 'persona') || 'tsundere';
        const persona = getPersonality(personaId, ctx);

        await ctx.answerCallbackQuery({ text: 'Dibatalkan.' }).catch(() => {});

        const cancelMsg =
          persona.strings?.deleteCancelled ??
          '❌ *Penghapusan data telah dibatalkan.* Datamu tetap aman.';

        await ctx.editMessageText(cancelMsg, { parse_mode: 'Markdown' }).catch(() => {});
      },
    },
  ],
};

