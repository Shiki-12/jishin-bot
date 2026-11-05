import { getSetting, setSetting } from '../core/settings.js';
import {
  getPrayerData,
  formatPrayerSchedule,
  schedulePrayerRemindersForTarget,
  cancelPrayerRemindersForTarget,
} from '../core/prayer.js';

export default {
  id: 'prayer',

  commands: [
    {
      name: 'sholat',
      description: 'Lihat 5 waktu sholat hari ini (/sholat [kota])',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const rawArg = ctx.message?.text?.split(/\s+/).slice(1).join(' ').trim();
        const targetCity = rawArg || getSetting(ctx, 'city');

        if (!targetCity) {
          const noCityMsg =
            p.strings?.prayerNoCity ??
            'Kamu belum mengatur kota domisili!\n' +
              'Gunakan `/sholat <nama_kota>` (contoh: `/sholat Bandung`)\n' +
              'atau simpan kotamu dengan `/kota <nama_kota>`.';
          await ctx.reply(noCityMsg, { parse_mode: 'Markdown' });
          return;
        }

        try {
          await ctx.replyWithChatAction('typing');

          const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
          const prayerData = await getPrayerData(targetCity);

          if (!prayerData) {
            const notFoundMsg =
              p.strings?.prayerCityNotFound?.replace('{city}', targetCity) ??
              `Jadwal sholat untuk kota "${targetCity}" tidak ditemukan. Coba periksa kembali ejaan nama kotanya.`;
            await ctx.reply(notFoundMsg);
            return;
          }

          const report = formatPrayerSchedule({
            prayerData,
            cityName: targetCity,
            tz,
          });

          await ctx.reply(report, { parse_mode: 'Markdown' });
        } catch (err) {
          console.error('Error saat mengambil jadwal sholat:', err);
          const errMsg =
            p.strings?.prayerError ??
            'Gagal mengambil data jadwal sholat saat ini. Coba beberapa saat lagi ya.';
          await ctx.reply(errMsg);
        }
      },
    },
    {
      name: 'adzan',
      description: 'Atur pengingat adzan otomatis (/adzan on [menit] atau /adzan off)',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const parts = ctx.message?.text?.trim().split(/\s+/) || [];
        const action = parts[1]?.toLowerCase();
        const leadArg = parts[2];

        const isPrivate = ctx.chat?.type === 'private' || !ctx.chat;
        const currentCity = getSetting(ctx, 'city');
        const isAdzanOn = Number(getSetting(ctx, 'adzan', 0)) === 1;
        const currentLead = Number(getSetting(ctx, 'adzan_lead', 10));

        if (!action) {
          if (isAdzanOn && currentCity) {
            const statusMsg =
              p.strings?.adzanStatusActive
                ?.replace('{city}', currentCity)
                ?.replace('{lead}', currentLead) ??
              `🕌 Pengingat adzan saat ini: *Aktif* (${currentLead} menit sebelum waktu sholat) untuk wilayah *${currentCity}*.\n\n` +
                `• Ketik \`/adzan off\` untuk mematikan.\n` +
                `• Ketik \`/adzan on [menit]\` untuk mengubah jeda waktu (contoh: \`/adzan on 5\`).`;
            await ctx.reply(statusMsg, { parse_mode: 'Markdown' });
          } else {
            const statusMsg =
              p.strings?.adzanStatusDisabled ??
              '🕌 Pengingat adzan saat ini: *Mati*.\n\n' +
                'Ketik `/adzan on` untuk mengaktifkan pengingat 10 menit sebelum waktu sholat masuk.';
            await ctx.reply(statusMsg, { parse_mode: 'Markdown' });
          }
          return;
        }

        if (action === 'off') {
          setSetting(ctx, 'adzan', 0);
          cancelPrayerRemindersForTarget(ctx.chat.id, ctx.from?.id);
          const offMsg =
            p.strings?.adzanOff ??
            'Pengingat adzan otomatis telah dimatikan.';
          await ctx.reply(offMsg);
          return;
        }

        if (action === 'on') {
          if (!currentCity) {
            const noCityMsg =
              p.strings?.adzanNoCity ??
              'Kota domisili belum diatur!\nSilakan atur kotamu dulu dengan `/kota <nama_kota>` (contoh: `/kota Surabaya`) sebelum mengaktifkan pengingat adzan.';
            await ctx.reply(noCityMsg, { parse_mode: 'Markdown' });
            return;
          }

          let leadMinutes = currentLead;
          if (leadArg && /^\d+$/.test(leadArg)) {
            leadMinutes = Math.min(60, Math.max(0, parseInt(leadArg, 10)));
          }

          setSetting(ctx, 'adzan', 1);
          setSetting(ctx, 'adzan_lead', leadMinutes);
          setSetting(ctx, 'adzan_last_date', null); // Trigger penjadwalan hari ini

          try {
            await schedulePrayerRemindersForTarget({
              chatId: ctx.chat.id,
              userId: ctx.from?.id,
              isPrivate,
            });
          } catch (err) {
            console.error('Error saat menjadwalkan adzan:', err);
          }

          const template =
            p.strings?.adzanOn ??
            'Pengingat adzan berhasil diaktifkan untuk wilayah *{city}* ({lead} menit sebelum waktu sholat).';
          const replyText = template
            .replace('{city}', currentCity)
            .replace('{lead}', leadMinutes);

          await ctx.reply(replyText, { parse_mode: 'Markdown' });
          return;
        }

        await ctx.reply(
          'Format perintah tidak dikenali.\nGunakan `/adzan on [menit]` atau `/adzan off`.',
          { parse_mode: 'Markdown' },
        );
      },
    },
  ],

  tags: [
    {
      name: 'PRAYER',
      promptHint:
        'Cek jadwal sholat hari ini untuk kota tertentu. Format: [PRAYER: nama_kota] (contoh: [PRAYER: Jakarta]). Keluarkan tag ini jika user menanyakan jadwal sholat atau waktu adzan.',
      handle: async (ctx, args) => {
        const city = args?.[0]?.trim() || getSetting(ctx, 'city');
        if (!city) return;

        try {
          const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
          const prayerData = await getPrayerData(city);
          if (prayerData) {
            const report = formatPrayerSchedule({
              prayerData,
              cityName: city,
              tz,
            });
            await ctx.reply(report, { parse_mode: 'Markdown' });
          }
        } catch (err) {
          console.error(`Gagal memproses tag [PRAYER: ${city}]:`, err.message);
        }
      },
    },
  ],
};

