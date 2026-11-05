import { clearHistory } from '../memory.js';
import { clearSummary } from '../core/facts.js';
import { getPersonality, listPersonalities } from '../personalities/index.js';
import { searchGif } from '../giphy.js';
import { getSetting, getEffectivePersona, getEffectiveExpressionMode } from '../core/settings.js';
import { shapeReply } from '../core/expression.js';
import { isAdmin } from '../core/guards.js';

let activeCommandsGetter = () => [];

function resolvePersona(ctx) {
  if (ctx?.persona) return ctx.persona;
  const { persona } = getEffectivePersona(ctx);
  return persona;
}

export default {
  id: 'core',

  init: async ({ getActiveCommands }) => {
    if (typeof getActiveCommands === 'function') {
      activeCommandsGetter = getActiveCommands;
    }
  },

  commands: [
    {
      name: 'start',
      description: 'Mulai percakapan dengan bot',
      handler: async (ctx) => {
        const persona = resolvePersona(ctx);
        const exprMode = getEffectiveExpressionMode(ctx);
        const greeting = shapeReply(persona.greeting, { mode: exprMode, persona: persona.id });
        const isGroup = ctx.chat?.type && ctx.chat.type !== 'private';
        if (isGroup) {
          const botUser = ctx.me?.username ? `@${ctx.me.username}` : 'bot';
          const groupIntro =
            `${greeting}\n\n` +
            'ℹ️ *Informasi Penggunaan Grup:*\n' +
            `• Bot hanya merespons jika di-mention (${botUser}) atau pesannya di-reply (kecuali admin menyalakan /chatty on).\n` +
            '• Bot menyimpan penyangga 200 pesan teks terakhir di grup ini untuk fitur ringkasan /rangkum_grup.\n' +
            '• Pastikan *Group Privacy* dimatikan di @BotFather atau jadikan bot Admin grup agar bot dapat membaca pesan untuk fitur ringkasan.';
          await ctx.reply(groupIntro, { parse_mode: 'Markdown' });
          return;
        }
        await ctx.reply(greeting);
      },
    },
    {
      name: 'forget',
      description: 'Hapus riwayat percakapan di chat ini',
      handler: async (ctx) => {
        clearHistory(ctx.chat.id);
        clearSummary(ctx.chat.id);
        const persona = resolvePersona(ctx);
        const exprMode = getEffectiveExpressionMode(ctx);
        const rawText =
          persona.strings?.forgetSuccess ??
          'Hah, kamu mau aku lupa semuanya? ...Ya udah, terserah. Aku nggak peduli kok. 🙄';
        const text = shapeReply(rawText, { mode: exprMode, persona: persona.id });
        await ctx.reply(text);
      },
    },
    {
      name: 'about',
      description: 'Info tentang persona dan bot',
      handler: async (ctx) => {
        const { persona, id, source } = getEffectivePersona(ctx);
        const text = `Personality aktif: ${persona.name} (${id}) [sumber: ${source}]\nTersedia: ${listPersonalities().join(', ')}`;
        await ctx.reply(text);
      },
    },
    {
      name: 'help',
      description: 'Lihat daftar perintah yang tersedia',
      handler: async (ctx) => {
        const persona = resolvePersona(ctx);
        const allCommands = activeCommandsGetter();
        const userId = ctx.from?.id;
        const userIsAdmin = isAdmin(userId);

        const publicCommands = allCommands.filter((c) => !c.adminOnly);
        const adminCommands = allCommands.filter((c) => c.adminOnly);

        const header =
          persona.strings?.helpHeader ?? 'Daftar perintah yang bisa kamu pakai:';
        const footer = persona.strings?.helpFooter ?? '';

        const publicList = publicCommands
          .map((c) => `/${c.name} — ${c.description || 'Tidak ada deskripsi'}`)
          .join('\n');

        const parts = [header, '', publicList];

        if (userIsAdmin && adminCommands.length > 0) {
          const adminList = adminCommands
            .map((c) => `/${c.name} — ${c.description || 'Tidak ada deskripsi'}`)
            .join('\n');
          parts.push('', 'Khusus admin:', adminList);
        }

        if (footer) parts.push('', footer);

        await ctx.reply(parts.join('\n'));
      },
    },
  ],

  tags: [
    {
      name: 'GIF',
      minArgs: 1,
      maxArgs: 1,
      maxArgLength: 100,
      promptHint:
        'Kirim animasi GIF jika momennya tepat. Format: [GIF: kata kunci dalam bahasa Inggris]. Contoh: [GIF: anime blush]',
      handle: async (ctx, [query]) => {
        const gifFreq = getSetting(ctx, 'gif_freq', 'normal');
        if (gifFreq === 'off') return;
        try {
          const gifUrl = await searchGif(query);
          if (gifUrl) await ctx.replyWithAnimation(gifUrl);
        } catch (err) {
          console.error('Gagal kirim GIF:', err.message);
        }
      },
    },
  ],
};

