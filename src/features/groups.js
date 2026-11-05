import {
  isGroupAdmin,
  getGroupSettings,
  setGroupSetting,
  getGroupMessages,
  summarizeGroupMessages,
} from '../core/groups.js';
import { getSetting } from '../core/settings.js';
import { getPersonality } from '../personalities/index.js';

export default {
  id: 'groups',

  init: async ({ bot }) => {
    if (!bot || typeof bot.on !== 'function') return;

    // Handler event saat anggota baru bergabung ke grup
    bot.on('message:new_chat_members', async (ctx) => {
      if (!ctx.chat || ctx.chat.type === 'private') return;

      const newMembers = ctx.message.new_chat_members || [];
      const settings = getGroupSettings(ctx.chat.id);
      const personaId = getSetting(ctx, 'persona') || 'tsundere';
      const persona = getPersonality(personaId, ctx);

      for (const member of newMembers) {
        // Jika yang bergabung adalah bot sendiri
        if (member.id === ctx.me?.id) {
          const introMsg =
            `${persona.greeting}\n\n` +
            'ℹ️ *Informasi Penggunaan Grup:*\n' +
            `• Bot hanya merespons jika di-mention (@${ctx.me?.username}) atau pesannya di-reply (kecuali admin mengaktifkan /chatty on).\n` +
            '• Bot menyimpan penyangga 200 pesan teks terakhir untuk fitur ringkasan /rangkum_grup.\n' +
            '• Pastikan *Group Privacy* dimatikan di @BotFather atau jadikan bot Admin grup agar bot dapat membaca pesan.';
          await ctx.reply(introMsg, { parse_mode: 'Markdown' }).catch(() => {});
          continue;
        }

        // Jika anggota baru adalah pengguna manusia & fitur welcome aktif
        if (settings.welcome_enabled) {
          const groupTitle = ctx.chat.title || 'grup';
          const name = member.first_name || 'Teman';
          const template =
            persona.strings?.groupWelcome ??
            'Selamat datang di {group}, {name}!';
          const welcomeText = template
            .replace('{name}', name)
            .replace('{group}', groupTitle);

          await ctx.reply(welcomeText).catch(() => {});
        }
      }
    });
  },

  commands: [
    {
      name: 'rangkum_grup',
      description: 'Rangkum obrolan grup beberapa pesan terakhir (/rangkum_grup [jumlah])',
      handler: async (ctx) => {
        if (!ctx.chat || ctx.chat.type === 'private') {
          const personaId = getSetting(ctx, 'persona') || 'tsundere';
          const persona = getPersonality(personaId, ctx);
          const notGroupMsg =
            persona.strings?.notGroupChat ??
            'Perintah ini hanya dapat digunakan di dalam grup chat.';
          await ctx.reply(notGroupMsg);
          return;
        }

        const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
        const count = args[0] ? Number(args[0]) : 30;

        const personaId = getSetting(ctx, 'persona') || 'tsundere';
        const persona = getPersonality(personaId, ctx);

        const messages = getGroupMessages(ctx.chat.id, count);

        if (messages.length < 3) {
          await ctx.reply(
            '⚠️ Belum cukup riwayat pesan di grup ini untuk dirangkum (minimal butuh 3 pesan).\n' +
              'Pesan obrolan grup baru akan tercatat saat bot aktif berada di grup ini (maksimal 200 pesan terakhir).',
          );
          return;
        }

        try {
          if (typeof ctx.replyWithChatAction === 'function') {
            await ctx.replyWithChatAction('typing').catch(() => {});
          }

          const summarize = ctx.summarizeGroupMessagesFn || summarizeGroupMessages;
          const res = await summarize({ messages });

          const introTemplate =
            persona.strings?.groupSummaryIntro ??
            '📊 Ringkasan {count} pesan terakhir di grup ini:';
          const intro = introTemplate.replace('{count}', res.messageCount);

          await ctx.reply(`${intro}\n\n${res.summaryText}`);
        } catch (err) {
          console.error('Gagal merangkum grup:', err);
          await ctx.reply(
            persona.errorMessage || 'Terjadi kesalahan saat merangkum obrolan grup.',
          );
        }
      },
    },
    {
      name: 'chatty',
      description: 'Aktifkan/nonaktifkan peluang bot nimbrung otomatis di grup (/chatty [on|off])',
      handler: async (ctx) => {
        if (!ctx.chat || ctx.chat.type === 'private') {
          const personaId = getSetting(ctx, 'persona') || 'tsundere';
          const persona = getPersonality(personaId, ctx);
          await ctx.reply(
            persona.strings?.notGroupChat ?? 'Perintah ini khusus untuk grup.',
          );
          return;
        }

        const isAdmin = await isGroupAdmin(ctx);
        const personaId = getSetting(ctx, 'persona') || 'tsundere';
        const persona = getPersonality(personaId, ctx);

        if (!isAdmin) {
          await ctx.reply(
            persona.strings?.notGroupAdmin ??
              'Hanya admin grup yang dapat mengatur mode chatty.',
          );
          return;
        }

        const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
        const mode = args[0]?.toLowerCase();

        if (mode === 'on') {
          setGroupSetting(ctx.chat.id, { chatty: 1 });
          await ctx.reply(
            persona.strings?.chattyEnabled ??
              'Mode chatty diaktifkan! Bot akan sesekali nimbrung obrolan grup (~5% peluang).',
          );
          return;
        }

        if (mode === 'off') {
          setGroupSetting(ctx.chat.id, { chatty: 0 });
          await ctx.reply(
            persona.strings?.chattyDisabled ??
              'Mode chatty dinonaktifkan. Bot hanya merespons jika di-mention atau di-reply.',
          );
          return;
        }

        const current = getGroupSettings(ctx.chat.id);
        const statusStr = current.chatty ? 'Aktif (ON)' : 'Mati (OFF)';
        await ctx.reply(
          `💬 *Status Mode Chatty:*\n` +
            `• Status: *${statusStr}*\n` +
            `• Peluang respon: *${Math.round(current.chatty_prob * 100)}%*\n` +
            `• Cooldown: *1 menit*\n\n` +
            `Ubah setelan: \`/chatty on\` atau \`/chatty off\` (khusus admin).`,
          { parse_mode: 'Markdown' },
        );
      },
    },
    {
      name: 'welcome',
      description: 'Aktifkan/nonaktifkan sapaan anggota baru di grup (/welcome [on|off])',
      handler: async (ctx) => {
        if (!ctx.chat || ctx.chat.type === 'private') {
          const personaId = getSetting(ctx, 'persona') || 'tsundere';
          const persona = getPersonality(personaId, ctx);
          await ctx.reply(
            persona.strings?.notGroupChat ?? 'Perintah ini khusus untuk grup.',
          );
          return;
        }

        const isAdmin = await isGroupAdmin(ctx);
        const personaId = getSetting(ctx, 'persona') || 'tsundere';
        const persona = getPersonality(personaId, ctx);

        if (!isAdmin) {
          await ctx.reply(
            persona.strings?.notGroupAdmin ??
              'Hanya admin grup yang dapat mengatur sapaan anggota baru.',
          );
          return;
        }

        const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
        const mode = args[0]?.toLowerCase();

        if (mode === 'on') {
          setGroupSetting(ctx.chat.id, { welcome_enabled: 1 });
          await ctx.reply(
            persona.strings?.welcomeEnabled ??
              'Sapaan anggota baru berhasil diaktifkan.',
          );
          return;
        }

        if (mode === 'off') {
          setGroupSetting(ctx.chat.id, { welcome_enabled: 0 });
          await ctx.reply(
            persona.strings?.welcomeDisabled ??
              'Sapaan anggota baru dinonaktifkan.',
          );
          return;
        }

        const current = getGroupSettings(ctx.chat.id);
        const statusStr = current.welcome_enabled ? 'Aktif (ON)' : 'Mati (OFF)';
        await ctx.reply(
          `👋 *Status Sapaan Anggota Baru:*\n` +
            `• Status: *${statusStr}*\n\n` +
            `Ubah setelan: \`/welcome on\` atau \`/welcome off\` (khusus admin).`,
          { parse_mode: 'Markdown' },
        );
      },
    },
  ],
};
