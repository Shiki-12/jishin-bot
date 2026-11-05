import { getSetting } from '../core/settings.js';
import {
  addHabit,
  deleteHabit,
  getHabitById,
  logHabit,
  getUserHabitsWithStatus,
  getZonedDateAndMinutes,
} from '../core/habits.js';
import { InlineKeyboard } from 'grammy';

export default {
  id: 'habits',

  commands: [
    {
      name: 'habits',
      description: 'Lihat daftar kebiasaan harian dan streak kamu',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const userId = ctx.from?.id;
        if (!userId) return;

        const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
        const habits = getUserHabitsWithStatus(userId, tz);

        if (habits.length === 0) {
          const emptyMsg =
            p.strings?.habitEmpty ??
            'Kamu belum memiliki daftar kebiasaan harian.\n' +
              'Gunakan `/habit add <nama> [jam]` untuk membuat kebiasaan baru.\n' +
              'Contoh: `/habit add Minum air 2L 08:00` atau `/habit add Olahraga pagi`.';
          await ctx.reply(emptyMsg, { parse_mode: 'Markdown' });
          return;
        }

        const { dateStr } = getZonedDateAndMinutes(new Date(), tz);
        const header = p.strings?.habitHeader ?? '📋 *Daftar Kebiasaan & Streak Kamu:*';

        const lines = habits.map((h) => {
          let statusIcon = '⏳ Belum';
          if (h.todayStatus === 'done') statusIcon = '✅ Selesai';
          if (h.todayStatus === 'skipped') statusIcon = '⏭️ Dilewati';

          const timeInfo = h.remindTime ? ` (⏰ ${h.remindTime})` : '';
          return (
            `• *#${h.id}* ${h.name}${timeInfo}\n` +
            `  Status hari ini: ${statusIcon}\n` +
            `  🔥 Streak: *${h.currentStreak} hari* | 🏆 Rekor: *${h.longestStreak} hari*`
          );
        });

        // Buat tombol inline cepat untuk kebiasaan yang belum selesai hari ini
        const pendingHabits = habits.filter((h) => h.todayStatus === 'pending');
        const keyboard = new InlineKeyboard();

        pendingHabits.slice(0, 5).forEach((h) => {
          keyboard
            .text(`✅ Selesai: #${h.id}`, `hbt:done:${h.id}:${dateStr}`)
            .text(`⏭️ Lewat: #${h.id}`, `hbt:skip:${h.id}:${dateStr}`)
            .row();
        });

        const footer =
          '\n_Ketik `/habit done <id>` atau `/habit skip <id>` untuk mencatat._\n' +
          '_Ketik `/habit del <id>` untuk menghapus kebiasaan._';

        const replyOptions = { parse_mode: 'Markdown' };
        if (pendingHabits.length > 0) {
          replyOptions.reply_markup = keyboard;
        }

        await ctx.reply(`${header}\n\n${lines.join('\n\n')}\n${footer}`, replyOptions);
      },
    },
    {
      name: 'habit',
      description: 'Kelola kebiasaan (/habit add <nama> [jam], /habit done <id>, /habit skip <id>, /habit del <id>)',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const rawText = ctx.message?.text?.trim() || '';
        const parts = rawText.split(/\s+/).slice(1);
        const sub = parts[0]?.toLowerCase();
        const userId = ctx.from?.id;
        if (!userId) return;

        // Jika dipanggil /habit tanpa argumen -> tampilkan /habits
        if (!sub) {
          const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
          const habits = getUserHabitsWithStatus(userId, tz);

          if (habits.length === 0) {
            const emptyMsg =
              p.strings?.habitEmpty ??
              'Kamu belum memiliki daftar kebiasaan harian.\n' +
                'Gunakan `/habit add <nama> [jam]` untuk membuat kebiasaan baru.\n' +
                'Contoh: `/habit add Minum air 2L 08:00`.';
            await ctx.reply(emptyMsg, { parse_mode: 'Markdown' });
            return;
          }

          const { dateStr } = getZonedDateAndMinutes(new Date(), tz);
          const header = p.strings?.habitHeader ?? '📋 *Daftar Kebiasaan & Streak Kamu:*';
          const lines = habits.map((h) => {
            let statusIcon = '⏳ Belum';
            if (h.todayStatus === 'done') statusIcon = '✅ Selesai';
            if (h.todayStatus === 'skipped') statusIcon = '⏭️ Dilewati';

            const timeInfo = h.remindTime ? ` (⏰ ${h.remindTime})` : '';
            return (
              `• *#${h.id}* ${h.name}${timeInfo}\n` +
              `  Status hari ini: ${statusIcon}\n` +
              `  🔥 Streak: *${h.currentStreak} hari* | 🏆 Rekor: *${h.longestStreak} hari*`
            );
          });

          await ctx.reply(`${header}\n\n${lines.join('\n\n')}`, {
            parse_mode: 'Markdown',
          });
          return;
        }

        // Subperintah: add
        if (sub === 'add') {
          const habitRaw = parts.slice(1).join(' ').trim();
          if (!habitRaw) {
            await ctx.reply(
              'Gunakan format: `/habit add <nama_kebiasaan> [HH:mm]`\nContoh: `/habit add Baca buku 21:00`',
              { parse_mode: 'Markdown' },
            );
            return;
          }

          try {
            const habit = addHabit({ userId, name: habitRaw });
            const remindStr = habit.remindTime
              ? ` setiap jam *${habit.remindTime}*`
              : '';
            const template =
              p.strings?.habitAdded ??
              'Kebiasaan baru dicatat: *"{name}"*{remind}. Jangan sampai bolos ya!';
            const replyMsg = template
              .replace('{name}', habit.name)
              .replace('{remind}', remindStr);

            await ctx.reply(replyMsg, { parse_mode: 'Markdown' });
          } catch (err) {
            await ctx.reply(`⚠️ ${err.message}`);
          }
          return;
        }

        // Subperintah: done
        if (sub === 'done') {
          const habitId = parseInt(parts[1], 10);
          if (isNaN(habitId)) {
            await ctx.reply('Gunakan format: `/habit done <id>`');
            return;
          }

          try {
            const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
            const { dateStr } = getZonedDateAndMinutes(new Date(), tz);
            const res = logHabit({ habitId, userId, dateStr, status: 'done' });

            const template =
              p.strings?.habitDone ??
              'Bagus! Kebiasaan *"{name}"* sudah diselesaikan hari ini. 🔥 Streak: *{streak} hari*!';
            let replyMsg = template
              .replace('{name}', res.habit.name)
              .replace('{streak}', res.currentStreak);

            if (res.currentStreak > 1 && res.currentStreak % 3 === 0) {
              const streakTemplate =
                p.strings?.habitStreakCelebrate ??
                '\n🎉 Luar biasa! Kamu berhasil mempertahankan konsistensi {streak} hari berturut-turut!';
              replyMsg += streakTemplate.replace('{streak}', res.currentStreak);
            }

            await ctx.reply(replyMsg, { parse_mode: 'Markdown' });
          } catch (err) {
            await ctx.reply(`⚠️ ${err.message}`);
          }
          return;
        }

        // Subperintah: skip
        if (sub === 'skip') {
          const habitId = parseInt(parts[1], 10);
          if (isNaN(habitId)) {
            await ctx.reply('Gunakan format: `/habit skip <id>`');
            return;
          }

          try {
            const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
            const { dateStr } = getZonedDateAndMinutes(new Date(), tz);
            const res = logHabit({ habitId, userId, dateStr, status: 'skipped' });

            const template =
              p.strings?.habitSkipped ??
              'Kebiasaan *"{name}"* dilewati untuk hari ini. Besok kembali semangat lagi ya!';
            const replyMsg = template.replace('{name}', res.habit.name);
            await ctx.reply(replyMsg, { parse_mode: 'Markdown' });
          } catch (err) {
            await ctx.reply(`⚠️ ${err.message}`);
          }
          return;
        }

        // Subperintah: del
        if (sub === 'del' || sub === 'delete') {
          const habitId = parseInt(parts[1], 10);
          if (isNaN(habitId)) {
            await ctx.reply('Gunakan format: `/habit del <id>`');
            return;
          }

          const ok = deleteHabit(habitId, userId);
          if (ok) {
            const template =
              p.strings?.habitDeleted ??
              'Kebiasaan #{id} berhasil dihapus dari daftar.';
            await ctx.reply(template.replace('{id}', habitId));
          } else {
            const template =
              p.strings?.habitNotFound ??
              'Kebiasaan #{id} tidak ditemukan di daftar milikmu.';
            await ctx.reply(template.replace('{id}', habitId));
          }
          return;
        }

        await ctx.reply(
          'Format perintah tidak dikenal.\nGunakan:\n' +
            '• `/habit add <nama> [jam]`\n' +
            '• `/habit done <id>`\n' +
            '• `/habit skip <id>`\n' +
            '• `/habit del <id>`\n' +
            '• `/habits`',
          { parse_mode: 'Markdown' },
        );
      },
    },
    {
      name: 'delhabit',
      description: 'Hapus kebiasaan berdasarkan ID (/delhabit <id>)',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const parts = ctx.message?.text?.trim().split(/\s+/) || [];
        const habitId = parseInt(parts[1], 10);
        const userId = ctx.from?.id;

        if (isNaN(habitId) || !userId) {
          await ctx.reply('Gunakan format: `/delhabit <id>`');
          return;
        }

        const ok = deleteHabit(habitId, userId);
        if (ok) {
          const template =
            p.strings?.habitDeleted ??
            'Kebiasaan #{id} berhasil dihapus dari daftar.';
          await ctx.reply(template.replace('{id}', habitId));
        } else {
          const template =
            p.strings?.habitNotFound ??
            'Kebiasaan #{id} tidak ditemukan di daftar milikmu.';
          await ctx.reply(template.replace('{id}', habitId));
        }
      },
    },
  ],

  callbacks: [
    {
      prefix: 'hbt:',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const data = ctx.callbackQuery?.data || '';
        // Format: hbt:done:<id>:<date> atau hbt:skip:<id>:<date>
        const parts = data.split(':');
        const action = parts[1];
        const habitId = parseInt(parts[2], 10);
        const dateStr = parts[3];
        const userId = ctx.from?.id;

        if (!userId || isNaN(habitId) || !['done', 'skipped'].includes(action)) {
          await ctx.answerCallbackQuery({ text: 'Data tombol tidak valid.' });
          return;
        }

        try {
          const res = logHabit({ habitId, userId, dateStr, status: action });
          await ctx.answerCallbackQuery({
            text:
              action === 'done'
                ? `Hebat! Streak: ${res.currentStreak} hari!`
                : 'Kebiasaan dilewati.',
          });

          if (action === 'done') {
            const template =
              p.strings?.habitDone ??
              'Bagus! Kebiasaan *"{name}"* sudah selesai hari ini. 🔥 Streak: *{streak} hari*!';
            let text = template
              .replace('{name}', res.habit.name)
              .replace('{streak}', res.currentStreak);

            if (res.currentStreak > 1 && res.currentStreak % 3 === 0) {
              const streakTemplate =
                p.strings?.habitStreakCelebrate ??
                '\n🎉 Luar biasa! Konsistensi {streak} hari berturut-turut!';
              text += streakTemplate.replace('{streak}', res.currentStreak);
            }

            await ctx.editMessageText(text, { parse_mode: 'Markdown' });
          } else {
            const template =
              p.strings?.habitSkipped ??
              'Kebiasaan *"{name}"* dilewati untuk hari ini. Besok kita coba lagi ya!';
            const text = template.replace('{name}', res.habit.name);
            await ctx.editMessageText(text, { parse_mode: 'Markdown' });
          }
        } catch (err) {
          await ctx.answerCallbackQuery({ text: err.message });
        }
      },
    },
  ],

  tags: [
    {
      name: 'HABIT_ADD',
      promptHint:
        'Tambah kebiasaan harian baru. Format: [HABIT_ADD: nama_kebiasaan | HH:mm] (jam opsional). Contoh: [HABIT_ADD: Minum vitamin | 07:00], [HABIT_ADD: Meditasi]. Gunakan tag ini jika user meminta menambahkan rutinitas atau kebiasaan baru.',
      handle: async (ctx, args) => {
        const name = args?.[0]?.trim();
        const time = args?.[1]?.trim() || null;
        const userId = ctx.from?.id;
        if (!name || !userId) return;

        try {
          const habit = addHabit({ userId, name, remindTime: time });
          const p = ctx.persona ?? { strings: {} };
          const remindStr = habit.remindTime
            ? ` setiap jam *${habit.remindTime}*`
            : '';
          const template =
            p.strings?.habitAdded ??
            'Kebiasaan baru dicatat: *"{name}"*{remind}. Jangan cuma rajin di awal ya!';
          const replyMsg = template
            .replace('{name}', habit.name)
            .replace('{remind}', remindStr);

          await ctx.reply(replyMsg, { parse_mode: 'Markdown' });
        } catch (err) {
          console.error('Gagal memproses tag [HABIT_ADD]:', err.message);
        }
      },
    },
    {
      name: 'HABIT_LOG',
      promptHint:
        'Catat status kebiasaan hari ini (selesai atau lewat). Format: [HABIT_LOG: id_kebiasaan | done] atau [HABIT_LOG: id_kebiasaan | skip]. Gunakan jika user menyatakan sudah melakukan atau melewatkan kebiasaannya.',
      handle: async (ctx, args) => {
        const habitId = parseInt(args?.[0]?.trim(), 10);
        const action = args?.[1]?.trim().toLowerCase();
        const userId = ctx.from?.id;
        if (isNaN(habitId) || !userId || !['done', 'skip', 'skipped'].includes(action)) return;

        try {
          const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
          const { dateStr } = getZonedDateAndMinutes(new Date(), tz);
          const status = action === 'skip' ? 'skipped' : 'done';
          const res = logHabit({ habitId, userId, dateStr, status });

          const p = ctx.persona ?? { strings: {} };
          if (status === 'done') {
            const template =
              p.strings?.habitDone ??
              'Bagus! Kebiasaan *"{name}"* selesai hari ini. 🔥 Streak: *{streak} hari*!';
            const text = template
              .replace('{name}', res.habit.name)
              .replace('{streak}', res.currentStreak);
            await ctx.reply(text, { parse_mode: 'Markdown' });
          } else {
            const template =
              p.strings?.habitSkipped ??
              'Kebiasaan *"{name}"* dilewati hari ini.';
            const text = template.replace('{name}', res.habit.name);
            await ctx.reply(text, { parse_mode: 'Markdown' });
          }
        } catch (err) {
          console.error('Gagal memproses tag [HABIT_LOG]:', err.message);
        }
      },
    },
  ],
};

