import {
  ALLOWED_MOODS,
  isValidMood,
  normalizeMood,
  deleteSticker,
  getStickersCountByMood,
  getTotalStickersCount,
  getRandomStickerByMood,
  setAdminAddStickerMode,
  getAdminAddStickerMode,
  clearAdminAddStickerMode,
} from '../core/stickers.js';
import { isAdmin } from '../core/guards.js';

export default {
  id: 'stickers',

  commands: [
    {
      name: 'addsticker',
      description: 'Tambah stiker reaksi bot (khusus admin)',
      adminOnly: true,
      handler: async (ctx) => {
        const userId = ctx.from?.id;
        if (!isAdmin(userId)) {
          return;
        }

        const text = ctx.message?.text ?? '';
        const parts = text.split(/\s+/).slice(1);
        const moodArg = parts[0];

        if (!moodArg || !isValidMood(moodArg)) {
          const listMoods = ALLOWED_MOODS.join(', ');
          await ctx.reply(
            `Format salah! Gunakan: /addsticker <mood>\n\nPilihan mood yang tersedia:\n${listMoods}`,
          );
          return;
        }

        const mood = normalizeMood(moodArg);
        setAdminAddStickerMode(userId, mood);

        const msg =
          ctx.persona?.strings?.stickerModeActive?.replace('{mood}', mood) ??
          `Mode tambah stiker aktif untuk mood "${mood}".\nKirim satu atau beberapa stiker sekarang ke bot ini.\nKetik /cancelsticker jika sudah selesai.`;
        await ctx.reply(msg);
      },
    },

    {
      name: 'cancelsticker',
      description: 'Batalkan mode tambah stiker',
      adminOnly: true,
      handler: async (ctx) => {
        const userId = ctx.from?.id;
        if (!isAdmin(userId)) {
          return;
        }

        const activeMode = getAdminAddStickerMode(userId);
        if (!activeMode) {
          await ctx.reply('Kamu tidak sedang dalam mode tambah stiker.');
          return;
        }
        clearAdminAddStickerMode(userId);
        const msg =
          ctx.persona?.strings?.stickerModeCancelled ??
          'Mode tambah stiker dibatalkan.';
        await ctx.reply(msg);
      },
    },

    {
      name: 'stickers',
      description: 'Lihat koleksi stiker reaksi per mood',
      handler: async (ctx) => {
        const counts = getStickersCountByMood();
        const total = getTotalStickersCount();

        if (total === 0) {
          const emptyMsg =
            ctx.persona?.strings?.stickersEmpty ??
            'Belum ada stiker yang tersimpan di bot ini.';
          const adminHint = isAdmin(ctx.from?.id)
            ? '\n\nAdmin: Gunakan /addsticker <mood> untuk mulai mengoleksi stiker.'
            : '';
          await ctx.reply(emptyMsg + adminHint);
          return;
        }

        const lines = counts.map((item) => `- *${item.mood}*: ${item.count} stiker`);
        let response = `🎨 *Koleksi Stiker Reaksi*\n\n${lines.join('\n')}\n\n*Total:* ${total} stiker`;
        if (isAdmin(ctx.from?.id)) {
          response +=
            '\n\n_Admin tips:_\n- `/addsticker <mood>` untuk tambah stiker\n- `/delsticker <id>` untuk hapus stiker';
        }
        await ctx.reply(response, { parse_mode: 'Markdown' });
      },
    },

    {
      name: 'delsticker',
      description: 'Hapus stiker berdasarkan ID (khusus admin)',
      adminOnly: true,
      handler: async (ctx) => {
        const userId = ctx.from?.id;
        if (!isAdmin(userId)) {
          return;
        }

        const text = ctx.message?.text ?? '';
        const parts = text.split(/\s+/).slice(1);
        const id = Number(parts[0]);

        if (!parts[0] || isNaN(id)) {
          await ctx.reply('Format salah! Gunakan: /delsticker <id>');
          return;
        }

        const deleted = deleteSticker(id);
        if (deleted) {
          await ctx.reply(`Stiker #${id} berhasil dihapus.`);
        } else {
          await ctx.reply(`Stiker #${id} tidak ditemukan.`);
        }
      },
    },
  ],

  tags: [
    {
      name: 'STICKER',
      minArgs: 1,
      maxArgs: 1,
      maxArgLength: 50,
      promptHint:
        'Kirim stiker reaksi sesuai mood (senang, kesal, malu, sedih, bingung, kaget, semangat, lelah). Format: [STICKER: mood]. Gunakan hanya sesekali. JANGAN pernah gunakan bersamaan dengan [GIF: ...] dalam satu balasan.',
      handle: async (ctx, args) => {
        const mood = args[0];
        const sticker = getRandomStickerByMood(mood);
        if (sticker?.file_id) {
          try {
            await ctx.replyWithSticker(sticker.file_id);
          } catch (err) {
            console.error(`Gagal mengirim stiker [${mood}]:`, err.message);
          }
        }
      },
    },
  ],
};

