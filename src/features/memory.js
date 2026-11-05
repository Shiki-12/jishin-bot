import { InlineKeyboard } from 'grammy';
import { getFacts, deleteFact, clearFacts } from '../core/facts.js';

function getPersona(ctx) {
  return ctx?.persona ?? { strings: {} };
}

/**
 * Render teks daftar fakta dan tombol inline keyboard.
 */
export function renderMemoryView(userId, persona) {
  const p = persona ?? { strings: {} };
  const facts = getFacts(userId, 50);

  if (facts.length === 0) {
    return {
      text:
        p.strings?.memoryEmpty ??
        'Aku belum tahu apa-apa tentang kamu. Jangan sok misterius deh! 🙄',
      keyboard: null,
    };
  }

  const header = p.strings?.memoryHeader ?? '🧠 *Fakta yang kuingat tentangmu:*';
  const lines = [header, ''];

  facts.forEach((f) => {
    lines.push(`• *#${f.id}* — ${f.fact}`);
  });

  lines.push('');
  lines.push('_Ketik `/delfact <id>` atau gunakan tombol di bawah untuk menghapus._');

  const keyboard = new InlineKeyboard();
  // Buat tombol hapus per fakta (maksimal 10 tombol pertama agar ringkas)
  const buttonsToDisplay = facts.slice(0, 8);
  buttonsToDisplay.forEach((f, idx) => {
    keyboard.text(`❌ #${f.id}`, `fact:del:${f.id}`);
    if (idx % 2 === 1) keyboard.row();
  });

  if (buttonsToDisplay.length % 2 !== 0) keyboard.row();
  keyboard.text('🗑️ Hapus Semua Fakta', 'fact:clear_prompt');

  return { text: lines.join('\n'), keyboard };
}

export default {
  id: 'memory',

  commands: [
    {
      name: 'memory',
      description: 'Lihat fakta yang diingat bot tentangmu (/memory)',
      handler: async (ctx) => {
        const p = getPersona(ctx);
        const { text, keyboard } = renderMemoryView(ctx.from.id, p);
        await ctx.reply(text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard ?? undefined,
        });
      },
    },
    {
      name: 'delfact',
      description: 'Hapus fakta tertentu berdasarkan ID (contoh: /delfact 5)',
      handler: async (ctx) => {
        const p = getPersona(ctx);
        const args = ctx.message.text.split(/\s+/).slice(1);
        const factId = Number(args[0]);

        if (!factId || isNaN(factId)) {
          await ctx.reply('Sebutkan ID fakta yang ingin dihapus. Contoh: `/delfact 5`', {
            parse_mode: 'Markdown',
          });
          return;
        }

        const success = deleteFact(ctx.from.id, factId);
        if (!success) {
          await ctx.reply(`Fakta #${factId} tidak ditemukan.`);
          return;
        }

        const template =
          p.strings?.factDeleted ?? 'Fakta #{id} sudah kulupakan. Puas? 🙄';
        await ctx.reply(template.replace('{id}', factId));
      },
    },
    {
      name: 'clearfacts',
      description: 'Hapus semua memori fakta tentang dirimu',
      handler: async (ctx) => {
        const keyboard = new InlineKeyboard()
          .text('⚠️ Ya, Hapus Semua', 'fact:clear_confirmed')
          .text('Batal', 'fact:cancel');

        await ctx.reply(
          'Apakah kamu yakin ingin menghapus *semua* memori fakta tentang dirimu?',
          {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          },
        );
      },
    },
  ],

  callbacks: [
    {
      prefix: 'fact:',
      handler: async (ctx) => {
        const data = ctx.callbackQuery.data;
        const p = getPersona(ctx);

        if (data.startsWith('fact:del:')) {
          const factId = Number(data.slice('fact:del:'.length));
          if (factId) {
            deleteFact(ctx.from.id, factId);
            await ctx.answerCallbackQuery({ text: `Fakta #${factId} dihapus.` }).catch(() => {});
          }

          const { text, keyboard } = renderMemoryView(ctx.from.id, p);
          await ctx
            .editMessageText(text, {
              parse_mode: 'Markdown',
              reply_markup: keyboard ?? undefined,
            })
            .catch(() => {});
          return;
        }

        if (data === 'fact:clear_prompt') {
          await ctx.answerCallbackQuery().catch(() => {});
          const confirmKb = new InlineKeyboard()
            .text('⚠️ Ya, Hapus Semua', 'fact:clear_confirmed')
            .text('Batal', 'fact:cancel');

          await ctx
            .editMessageText(
              'Apakah kamu yakin ingin menghapus *seluruh* fakta tentang dirimu yang kuingat?',
              {
                parse_mode: 'Markdown',
                reply_markup: confirmKb,
              },
            )
            .catch(() => {});
          return;
        }

        if (data === 'fact:clear_confirmed') {
          clearFacts(ctx.from.id);
          await ctx.answerCallbackQuery({ text: 'Semua fakta dihapus.' }).catch(() => {});

          const clearedText =
            p.strings?.factsCleared ??
            'Semua ingatan fakta tentangmu sudah kuhapus bersih. 😤';

          await ctx
            .editMessageText(clearedText, { parse_mode: 'Markdown' })
            .catch(() => {});
          return;
        }

        if (data === 'fact:cancel') {
          await ctx.answerCallbackQuery({ text: 'Dibatalkan.' }).catch(() => {});
          const { text, keyboard } = renderMemoryView(ctx.from.id, p);
          await ctx
            .editMessageText(text, {
              parse_mode: 'Markdown',
              reply_markup: keyboard ?? undefined,
            })
            .catch(() => {});
          return;
        }
      },
    },
  ],
};

