import { getSetting } from '../core/settings.js';
import {
  parseTimerDuration,
  formatDuration,
  createTimer,
  getActiveTimers,
  cancelTimer,
  getActivePomodoro,
  startPomodoro,
  stopPomodoro,
} from '../core/timer.js';

export default {
  id: 'timer',

  commands: [
    {
      name: 'timer',
      description: 'Atur timer hitung mundur (/timer <durasi> [nama] atau /timer untuk melihat daftar)',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const rawText = ctx.message?.text?.trim() || '';
        const parts = rawText.split(/\s+/).slice(1);

        // Jika dipanggil tanpa argumen -> tampilkan daftar timer aktif
        if (parts.length === 0) {
          const active = getActiveTimers(ctx.chat.id);
          if (active.length === 0) {
            const emptyMsg =
              p.strings?.timerListEmpty ??
              '⏱️ Tidak ada timer yang sedang aktif di chat ini.';
            await ctx.reply(emptyMsg);
            return;
          }

          const header =
            p.strings?.timerListHeader ?? '⏱️ *Daftar Timer Aktif:*';
          const lines = active.map(
            (t) =>
              `• *#${t.id}*: ${t.label} (sisa ~${formatDuration(t.remainingMs)})`,
          );
          const footer = '\nKetik `/canceltimer <id>` untuk membatalkan timer.';
          await ctx.reply(`${header}\n\n${lines.join('\n')}${footer}`, {
            parse_mode: 'Markdown',
          });
          return;
        }

        // Subperintah pembatalan: /timer cancel <id>
        if (parts[0].toLowerCase() === 'cancel' && parts[1]) {
          const timerId = parseInt(parts[1], 10);
          const ok = cancelTimer(timerId, ctx.chat.id);
          if (ok) {
            const cancelMsg =
              p.strings?.timerCancelled?.replace('{id}', timerId) ??
              `⏱️ Timer #${timerId} berhasil dibatalkan.`;
            await ctx.reply(cancelMsg);
          } else {
            const notFoundMsg =
              p.strings?.timerNotFound?.replace('{id}', timerId) ??
              `Timer #${timerId} tidak ditemukan atau sudah selesai.`;
            await ctx.reply(notFoundMsg);
          }
          return;
        }

        const durationArg = parts[0];
        const labelArg = parts.slice(1).join(' ').trim() || 'Waktu habis!';

        try {
          const durationMs = parseTimerDuration(durationArg);
          const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
          const timer = createTimer({
            chatId: ctx.chat.id,
            userId: ctx.from?.id,
            durationMs,
            label: labelArg,
            tz,
          });

          const durStr = formatDuration(durationMs);
          const template =
            p.strings?.timerSet ??
            '⏱️ *Timer Dimulai!*\n• Durasi: *{duration}*\n• Label: *{label}*\n• Selesai pada: *{time}* ({tz})';
          const replyText = template
            .replace('{duration}', durStr)
            .replace('{label}', timer.label)
            .replace('{time}', timer.timeStr)
            .replace('{tz}', tz);

          await ctx.reply(replyText, { parse_mode: 'Markdown' });
        } catch (err) {
          await ctx.reply(`⚠️ ${err.message}`);
        }
      },
    },
    {
      name: 'canceltimer',
      description: 'Batalkan timer aktif (/canceltimer <id>)',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const parts = ctx.message?.text?.trim().split(/\s+/) || [];
        const timerId = parseInt(parts[1], 10);

        if (isNaN(timerId)) {
          await ctx.reply('Gunakan format: `/canceltimer <id>`', {
            parse_mode: 'Markdown',
          });
          return;
        }

        const ok = cancelTimer(timerId, ctx.chat.id);
        if (ok) {
          const cancelMsg =
            p.strings?.timerCancelled?.replace('{id}', timerId) ??
            `⏱️ Timer #${timerId} berhasil dibatalkan.`;
          await ctx.reply(cancelMsg);
        } else {
          const notFoundMsg =
            p.strings?.timerNotFound?.replace('{id}', timerId) ??
            `Timer #${timerId} tidak ditemukan atau sudah selesai.`;
          await ctx.reply(notFoundMsg);
        }
      },
    },
    {
      name: 'pomodoro',
      description: 'Mulai atau cek sesi Pomodoro (/pomodoro [work] [break] [cycles], /pomodoro status, /pomodoro stop)',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const rawText = ctx.message?.text?.trim() || '';
        const parts = rawText.split(/\s+/).slice(1);
        const sub = parts[0]?.toLowerCase();

        // 1. Cek status sesi berjalan
        if (sub === 'status') {
          const pom = getActivePomodoro(ctx.chat.id);
          if (!pom) {
            const noActiveMsg =
              p.strings?.pomodoroNoActive ??
              '🍅 Tidak ada sesi Pomodoro yang sedang berjalan di chat ini.';
            await ctx.reply(noActiveMsg);
            return;
          }

          const phaseName = pom.phase === 'work' ? 'Fokus 🧠' : 'Istirahat ☕';
          const remStr = formatDuration(pom.remainingMs);
          const statusMsg =
            p.strings?.pomodoroStatus
              ?.replace('{cycle}', pom.cycle)
              ?.replace('{totalCycles}', pom.totalCycles)
              ?.replace('{phase}', phaseName)
              ?.replace('{remaining}', remStr) ??
            `🍅 *Status Pomodoro:*\n` +
              `• Tahap: *${phaseName}*\n` +
              `• Siklus: *${pom.cycle}/${pom.totalCycles}*\n` +
              `• Sisa waktu: *${remStr}*\n\n` +
              `Ketik \`/stop\` untuk membatalkan sesi.`;

          await ctx.reply(statusMsg, { parse_mode: 'Markdown' });
          return;
        }

        // 2. Berhenti lewat sub-arg: /pomodoro stop
        if (sub === 'stop') {
          const ok = stopPomodoro(ctx.chat.id);
          if (ok) {
            const stopMsg =
              p.strings?.pomodoroStopped ??
              '🍅 Sesi Pomodoro telah dihentikan.';
            await ctx.reply(stopMsg);
          } else {
            const noActiveMsg =
              p.strings?.pomodoroNoActive ??
              '🍅 Tidak ada sesi Pomodoro yang sedang berjalan di chat ini.';
            await ctx.reply(noActiveMsg);
          }
          return;
        }

        // 3. Mulai sesi baru: /pomodoro [work] [break] [cycles]
        let workMin = 25;
        let breakMin = 5;
        let cycles = 4;

        if (parts[0] && /^\d+$/.test(parts[0])) {
          workMin = parseInt(parts[0], 10);
        }
        if (parts[1] && /^\d+$/.test(parts[1])) {
          breakMin = parseInt(parts[1], 10);
        }
        if (parts[2] && /^\d+$/.test(parts[2])) {
          cycles = parseInt(parts[2], 10);
        }

        try {
          const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
          const pom = startPomodoro({
            chatId: ctx.chat.id,
            userId: ctx.from?.id,
            workMin,
            breakMin,
            cycles,
            tz,
          });

          const template =
            p.strings?.pomodoroStarted ??
            `🍅 *Sesi Pomodoro Dimulai!*\n` +
              `• Siklus 1/{cycles}: Fokus selama *{work} menit* (selesai: {time})\n` +
              `• Waktu istirahat: *{break} menit*\n\n` +
              `Tetap fokus dan selesaikan tugasmu! Ketik \`/stop\` kapan saja untuk menghentikan.`;

          const replyText = template
            .replace('{work}', pom.workMin)
            .replace('{break}', pom.breakMin)
            .replace('{cycles}', pom.totalCycles)
            .replace('{time}', pom.timeStr);

          await ctx.reply(replyText, { parse_mode: 'Markdown' });
        } catch (err) {
          await ctx.reply(`⚠️ ${err.message}`);
        }
      },
    },
    {
      name: 'stop',
      description: 'Hentikan sesi Pomodoro yang sedang berjalan',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const ok = stopPomodoro(ctx.chat.id);
        if (ok) {
          const stopMsg =
            p.strings?.pomodoroStopped ??
            '🍅 Sesi Pomodoro telah dihentikan.';
          await ctx.reply(stopMsg);
        } else {
          const noActiveMsg =
            p.strings?.pomodoroNoActive ??
            '🍅 Tidak ada sesi Pomodoro yang sedang berjalan di chat ini.';
          await ctx.reply(noActiveMsg);
        }
      },
    },
  ],

  tags: [
    {
      name: 'TIMER',
      promptHint:
        'Mulai timer hitung mundur. Format: [TIMER: durasi | label] (contoh: [TIMER: 15m | rebus telur], [TIMER: 30s | tahan nafas], [TIMER: 1j 30m | istirahat siang]). Gunakan tag ini jika user meminta dipasangkan timer hitung mundur.',
      handle: async (ctx, args) => {
        const rawDuration = args?.[0]?.trim();
        const label = args?.[1]?.trim() || 'Waktu habis!';
        if (!rawDuration) return;

        try {
          const durationMs = parseTimerDuration(rawDuration);
          const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
          const timer = createTimer({
            chatId: ctx.chat.id,
            userId: ctx.from?.id,
            durationMs,
            label,
            tz,
          });

          const p = ctx.persona ?? { strings: {} };
          const durStr = formatDuration(durationMs);
          const template =
            p.strings?.timerSet ??
            '⏱️ *Timer Dimulai!*\n• Durasi: *{duration}*\n• Label: *{label}*\n• Selesai pada: *{time}* ({tz})';
          const replyText = template
            .replace('{duration}', durStr)
            .replace('{label}', timer.label)
            .replace('{time}', timer.timeStr)
            .replace('{tz}', tz);

          await ctx.reply(replyText, { parse_mode: 'Markdown' });
        } catch (err) {
          console.error(`Gagal memproses tag [TIMER: ${rawDuration}]:`, err.message);
        }
      },
    },
    {
      name: 'POMODORO',
      promptHint:
        'Mulai atau hentikan sesi Pomodoro. Format: [POMODORO: start | work | break | cycles] (contoh: [POMODORO: start | 25 | 5 | 4]) atau [POMODORO: stop]. Gunakan tag ini jika user meminta memulai atau menghentikan sesi fokus/pomodoro.',
      handle: async (ctx, args) => {
        const action = args?.[0]?.trim().toLowerCase();
        const p = ctx.persona ?? { strings: {} };

        if (action === 'stop') {
          const ok = stopPomodoro(ctx.chat.id);
          if (ok) {
            const stopMsg =
              p.strings?.pomodoroStopped ??
              '🍅 Sesi Pomodoro telah dihentikan.';
            await ctx.reply(stopMsg);
          }
          return;
        }

        if (action === 'start') {
          const workMin = parseInt(args?.[1]?.trim(), 10) || 25;
          const breakMin = parseInt(args?.[2]?.trim(), 10) || 5;
          const cycles = parseInt(args?.[3]?.trim(), 10) || 4;

          try {
            const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
            const pom = startPomodoro({
              chatId: ctx.chat.id,
              userId: ctx.from?.id,
              workMin,
              breakMin,
              cycles,
              tz,
            });

            const template =
              p.strings?.pomodoroStarted ??
              `🍅 *Sesi Pomodoro Dimulai!*\n` +
                `• Siklus 1/{cycles}: Fokus selama *{work} menit* (selesai: {time})\n` +
                `• Waktu istirahat: *{break} menit*\n\n` +
                `Tetap fokus dan selesaikan tugasmu! Ketik \`/stop\` kapan saja untuk menghentikan.`;

            const replyText = template
              .replace('{work}', pom.workMin)
              .replace('{break}', pom.breakMin)
              .replace('{cycles}', pom.totalCycles)
              .replace('{time}', pom.timeStr);

            await ctx.reply(replyText, { parse_mode: 'Markdown' });
          } catch (err) {
            console.error('Gagal memproses tag [POMODORO: start]:', err.message);
          }
        }
      },
    },
  ],
};

