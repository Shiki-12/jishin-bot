import { getSetting, setSetting } from '../core/settings.js';
import {
  fetchCoordinates,
  getWeatherData,
  formatWeatherReport,
} from '../core/weather.js';

export default {
  id: 'weather',

  commands: [
    {
      name: 'kota',
      description: 'Atur kota domisili default (/kota <nama_kota>)',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const rawArg = ctx.message?.text?.split(/\s+/).slice(1).join(' ').trim();

        if (!rawArg) {
          const currentCity = getSetting(ctx, 'city');
          if (currentCity) {
            await ctx.reply(
              `Kota domisili kamu saat ini: *${currentCity}*.\nKetik \`/kota <nama_baru>\` untuk mengubah.`,
              { parse_mode: 'Markdown' },
            );
          } else {
            await ctx.reply(
              'Belum ada kota yang kamu atur.\nKetik `/kota <nama_kota>` (contoh: `/kota Bandung`).',
              { parse_mode: 'Markdown' },
            );
          }
          return;
        }

        try {
          await ctx.replyWithChatAction('typing');

          // Validasi apakah kota dapat ditemukan di geocoding
          const geo = await fetchCoordinates(rawArg);
          if (!geo) {
            const notFoundMsg =
              p.strings?.cityNotFound?.replace('{city}', rawArg) ??
              `Kota "${rawArg}" tidak ditemukan! Coba periksa kembali ejaan nama kotanya.`;
            await ctx.reply(notFoundMsg);
            return;
          }

          setSetting(ctx, 'city', geo.name);

          const template =
            p.strings?.citySaved ??
            'Kota domisili berhasil diatur ke *{city}*. Sekarang kamu bisa langsung ketik `/cuaca`.';
          const replyText = template.replace('{city}', geo.name);

          await ctx.reply(replyText, { parse_mode: 'Markdown' });
        } catch (err) {
          console.error('Error saat mengatur kota:', err);
          await ctx.reply('Terjadi kesalahan saat memeriksa nama kota. Coba lagi sebentar lagi.');
        }
      },
    },
    {
      name: 'cuaca',
      description: 'Cek prakiraan cuaca kota (/cuaca [nama_kota])',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const rawArg = ctx.message?.text?.split(/\s+/).slice(1).join(' ').trim();
        const targetCity = rawArg || getSetting(ctx, 'city');

        if (!targetCity) {
          await ctx.reply(
            'Kamu belum mengatur kota domisili!\n' +
              'Gunakan `/cuaca <nama_kota>` (contoh: `/cuaca Yogyakarta`)\n' +
              'atau simpan kotamu dengan `/kota <nama_kota>`.',
            { parse_mode: 'Markdown' },
          );
          return;
        }

        try {
          await ctx.replyWithChatAction('typing');

          const weather = await getWeatherData(targetCity);
          if (!weather) {
            const notFoundMsg =
              p.strings?.cityNotFound?.replace('{city}', targetCity) ??
              `Kota "${targetCity}" tidak ditemukan. Coba cek ejaannya lagi ya!`;
            await ctx.reply(notFoundMsg);
            return;
          }

          const report = formatWeatherReport({
            weather,
            personaId: ctx.persona?.id || 'tsundere',
          });

          await ctx.reply(report, { parse_mode: 'Markdown' });
        } catch (err) {
          console.error('Error saat mengambil cuaca:', err);
          const errMsg =
            p.strings?.weatherError ??
            'Gagal mengambil data cuaca saat ini (koneksi timeout). Coba beberapa saat lagi ya!';
          await ctx.reply(errMsg);
        }
      },
    },
  ],

  tags: [
    {
      name: 'WEATHER',
      promptHint:
        'Cek kondisi cuaca saat ini untuk kota tertentu. Format: [WEATHER: nama_kota] (contoh: [WEATHER: Jakarta]). Keluarkan tag ini jika user bertanya cuaca suatu kota.',
      handle: async (ctx, args) => {
        const city = args?.[0]?.trim();
        if (!city) return;

        try {
          const weather = await getWeatherData(city);
          if (weather) {
            const report = formatWeatherReport({
              weather,
              personaId: ctx.persona?.id || 'tsundere',
            });
            await ctx.reply(report, { parse_mode: 'Markdown' });
          }
        } catch (err) {
          console.error(`Gagal memproses tag [WEATHER: ${city}]:`, err.message);
        }
      },
    },
  ],
};

