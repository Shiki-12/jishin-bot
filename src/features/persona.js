import { InlineKeyboard } from 'grammy';
import { getSetting, setSetting } from '../core/settings.js';
import { isGroupAdmin } from '../core/groups.js';
import {
  getPersonality,
  listPersonalities,
  upsertCustomPersona,
} from '../personalities/index.js';

export { isGroupAdmin };

export function renderPersonaSelector(currentPersonaId = 'tsundere') {
  const personas = [
    { id: 'tsundere', name: 'Mika (Tsundere)', icon: '🎀' },
    { id: 'kalem', name: 'Rin (Kalem)', icon: '☕' },
    { id: 'ceria', name: 'Nana (Ceria)', icon: '🌟' },
    { id: 'sarkas', name: 'Kael (Sarkas)', icon: '🕶️' },
    { id: 'custom', name: 'Custom Persona', icon: '🎨' },
  ];

  const lines = [
    '🎭 *Ganti Personality Bot*',
    '',
    `Personality aktif saat ini: *${currentPersonaId}*`,
    '',
    'Pilih karakter di bawah untuk langsung mengganti, atau buat karakter khususmu sendiri dengan:',
    '`/persona custom <deskripsi kepribadianmu>`',
  ];

  const keyboard = new InlineKeyboard();
  personas.forEach((p, idx) => {
    const activeMark = p.id === currentPersonaId ? ' ✅' : '';
    keyboard.text(`${p.icon} ${p.name}${activeMark}`, `persona:set:${p.id}`);
    if (idx % 2 === 1) keyboard.row();
  });

  return { text: lines.join('\n'), keyboard };
}

export default {
  id: 'persona',

  commands: [
    {
      name: 'persona',
      description: 'Ganti karakter bot atau buat persona custom (/persona [nama/custom <deskripsi>])',
      handler: async (ctx) => {
        const isAdmin = await isGroupAdmin(ctx);
        if (!isAdmin) {
          await ctx.reply('Hanya admin grup yang dapat mengubah persona bot.');
          return;
        }

        const args = ctx.message.text.split(/\s+/).slice(1);
        const subCommand = args[0]?.toLowerCase();

        // 1. Tampilkan menu selector jika tanpa argumen
        if (!subCommand) {
          const current = getSetting(ctx, 'persona', 'tsundere');
          const { text, keyboard } = renderPersonaSelector(current);
          await ctx.reply(text, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
          return;
        }

        // 2. Persona custom: /persona custom <deskripsi>
        if (subCommand === 'custom') {
          const description = args.slice(1).join(' ').trim();
          if (!description) {
            await ctx.reply(
              'Tuliskan deskripsi karakter yang kamu inginkan. Maksimal 800 karakter.\n\nContoh:\n`/persona custom Asisten ilmuwan jenius yang suka menjelaskan fakta sains dengan analogi kopi.`',
              { parse_mode: 'Markdown' },
            );
            return;
          }

          if (description.length > 800) {
            await ctx.reply(
              `Deskripsi terlalu panjang (${description.length} karakter). Maksimal 800 karakter ya!`,
            );
            return;
          }

          const chatId = ctx.chat.id;
          const userId = ctx.from.id;
          upsertCustomPersona({ chatId, userId, description, name: 'Custom' });
          setSetting(ctx, 'persona', 'custom');

          await ctx.reply(
            '✨ *Persona Custom Berhasil Diaktifkan!*\nAturan keselamatan dan format dasar otomatis diterapkan.',
            { parse_mode: 'Markdown' },
          );
          return;
        }

        // 3. Ganti ke persona bawaan: /persona kalem / ceria / sarkas / tsundere
        const available = listPersonalities();
        if (!available.includes(subCommand)) {
          await ctx.reply(
            `Persona "${subCommand}" tidak ditemukan. Pilihan: ${available.join(', ')}`,
          );
          return;
        }

        setSetting(ctx, 'persona', subCommand);
        let newPersona;
        try {
          newPersona = getPersonality(subCommand, ctx);
        } catch {
          newPersona = { name: subCommand, greeting: 'Halo!' };
        }

        await ctx.reply(
          `Personality bot berhasil diubah ke *${newPersona.name}* (${subCommand})!\n\n_${newPersona.greeting}_`,
          { parse_mode: 'Markdown' },
        );
      },
    },
  ],

  callbacks: [
    {
      prefix: 'persona:set:',
      handler: async (ctx) => {
        const isAdmin = await isGroupAdmin(ctx);
        if (!isAdmin) {
          await ctx.answerCallbackQuery({
            text: 'Hanya admin grup yang boleh mengubah persona.',
            show_alert: true,
          }).catch(() => {});
          return;
        }

        const targetId = ctx.callbackQuery.data.slice('persona:set:'.length);
        const available = listPersonalities();

        if (!available.includes(targetId)) {
          await ctx.answerCallbackQuery({ text: 'Persona tidak valid.' }).catch(() => {});
          return;
        }

        setSetting(ctx, 'persona', targetId);
        let newPersona;
        try {
          newPersona = getPersonality(targetId, ctx);
        } catch {
          newPersona = { name: targetId, greeting: 'Halo!' };
        }

        await ctx.answerCallbackQuery({
          text: `Persona aktif: ${newPersona.name}`,
        }).catch(() => {});

        const { text, keyboard } = renderPersonaSelector(targetId);
        await ctx
          .editMessageText(
            `${text}\n\n_Persona berhasil diubah ke ${newPersona.name}!_`,
            {
              parse_mode: 'Markdown',
              reply_markup: keyboard,
            },
          )
          .catch(() => {});
      },
    },
  ],
};

