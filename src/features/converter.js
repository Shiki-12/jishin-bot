import {
  evaluateMath,
  convertCurrency,
  convertUnit,
  formatCurrencyAmount,
} from '../core/converter.js';

export default {
  id: 'converter',

  commands: [
    {
      name: 'kurs',
      description: 'Cek konversi kurs mata uang (/kurs 100 usd idr atau /kurs usd idr)',
      handler: async (ctx) => {
        const rawArg = ctx.message?.text?.split(/\s+/).slice(1).join(' ').trim();

        if (!rawArg) {
          await ctx.reply(
            '💱 *Format perintah kurs:*\n' +
              '• `/kurs <nominal> <dari> <ke>` (contoh: `/kurs 100 USD IDR`)\n' +
              '• `/kurs <dari> <ke>` (contoh: `/kurs USD IDR` untuk nominal 1)',
            { parse_mode: 'Markdown' },
          );
          return;
        }

        const parts = rawArg.split(/\s+/);
        let amount = 1;
        let fromCurr = '';
        let toCurr = '';

        if (parts.length === 2) {
          fromCurr = parts[0];
          toCurr = parts[1];
        } else if (parts.length >= 3) {
          const parsed = parseFloat(parts[0].replace(',', '.'));
          if (!isNaN(parsed)) {
            amount = parsed;
            fromCurr = parts[1];
            toCurr = parts[2];
          } else {
            fromCurr = parts[0];
            toCurr = parts[1];
          }
        } else {
          await ctx.reply(
            'Format tidak valid. Contoh: `/kurs 100 USD IDR` atau `/kurs USD IDR`',
            { parse_mode: 'Markdown' },
          );
          return;
        }

        try {
          await ctx.replyWithChatAction('typing');

          const conv = await convertCurrency(amount, fromCurr, toCurr);

          const replyText =
            `💱 *Konversi Mata Uang:*\n` +
            `*${formatCurrencyAmount(conv.amount)} ${conv.from}* = *${formatCurrencyAmount(conv.result)} ${conv.to}*\n\n` +
            `• *Kurs Acuan:* 1 ${conv.from} = ${formatCurrencyAmount(conv.rate)} ${conv.to}\n` +
            `• *Pembaruan:* ${conv.lastUpdateUtc}`;

          await ctx.reply(replyText, { parse_mode: 'Markdown' });
        } catch (err) {
          console.error('Error saat konversi kurs:', err);
          await ctx.reply(`Gagal konversi kurs: ${err.message}`);
        }
      },
    },
    {
      name: 'hitung',
      description: 'Hitung ekspresi matematika (/hitung 15 * (4 + 2) ^ 2)',
      handler: async (ctx) => {
        const expr = ctx.message?.text?.split(/\s+/).slice(1).join(' ').trim();

        if (!expr) {
          await ctx.reply(
            '🔢 *Format kalkulator:*\n' +
              'Gunakan `/hitung <ekspresi>`\n' +
              'Contoh: `/hitung 15 * (4 + 2)` atau `/hitung 2 ^ 3 + 10 % 3`\n\n' +
              '_Operator yang didukung: +, -, *, /, %, ^, dan tanda kurung ()_',
            { parse_mode: 'Markdown' },
          );
          return;
        }

        try {
          const result = evaluateMath(expr);
          await ctx.reply(
            `🔢 *Hasil Perhitungan:*\n\`${expr}\` = *${result}*`,
            { parse_mode: 'Markdown' },
          );
        } catch (err) {
          await ctx.reply(`⚠️ Gagal menghitung: ${err.message}`);
        }
      },
    },
    {
      name: 'konversi',
      description: 'Konversi satuan panjang, berat, suhu, dan volume (/konversi 5 km mil)',
      handler: async (ctx) => {
        const rawArg = ctx.message?.text?.split(/\s+/).slice(1).join(' ').trim();

        if (!rawArg) {
          await ctx.reply(
            '📐 *Format konversi satuan:*\n' +
              'Gunakan `/konversi <nilai> <dari> <ke>`\n\n' +
              'Contoh:\n' +
              '• Panjang: `/konversi 5 km mil` atau `/konversi 100 cm m`\n' +
              '• Berat: `/konversi 2.5 kg lb` atau `/konversi 500 g ons`\n' +
              '• Suhu: `/konversi 100 c f` atau `/konversi 300 k c`\n' +
              '• Volume: `/konversi 1 gal l` atau `/konversi 500 ml cangkir`',
            { parse_mode: 'Markdown' },
          );
          return;
        }

        // Hapus kata 'ke' atau 'to' jika user menuliskan "/konversi 5 km ke mil"
        const tokens = rawArg.split(/\s+/).filter((t) => !['ke', 'to'].includes(t.toLowerCase()));

        if (tokens.length < 3) {
          await ctx.reply('Format salah. Contoh penggunaan: `/konversi 5 km mil`', {
            parse_mode: 'Markdown',
          });
          return;
        }

        const [valStr, fromUnit, toUnit] = tokens;

        try {
          const conv = convertUnit(valStr, fromUnit, toUnit);

          const replyText =
            `📐 *Konversi Satuan (${conv.category}):*\n` +
            `*${conv.value} ${conv.from}* = *${conv.result} ${conv.to}*`;

          await ctx.reply(replyText, { parse_mode: 'Markdown' });
        } catch (err) {
          await ctx.reply(`⚠️ ${err.message}`);
        }
      },
    },
  ],

  tags: [
    {
      name: 'CALC',
      promptHint:
        'Hitung ekspresi matematika. Format: [CALC: ekspresi] (contoh: [CALC: 15 * (4 + 2)]). Keluarkan tag ini jika user meminta bantuan perhitungan.',
      handle: async (ctx, args) => {
        const expr = args?.[0]?.trim();
        if (!expr) return;
        try {
          const result = evaluateMath(expr);
          await ctx.reply(`🔢 *Hasil Perhitungan:*\n\`${expr}\` = *${result}*`, {
            parse_mode: 'Markdown',
          });
        } catch (err) {
          console.error(`Gagal memproses tag [CALC: ${expr}]:`, err.message);
        }
      },
    },
    {
      name: 'KURS',
      promptHint:
        'Cek konversi kurs mata uang. Format: [KURS: nominal | mata_uang_asal | mata_uang_tujuan] (contoh: [KURS: 100 | USD | IDR]).',
      handle: async (ctx, args) => {
        if (!args || args.length < 2) return;
        let amount = 1;
        let fromCurr = '';
        let toCurr = '';

        if (args.length === 2) {
          fromCurr = args[0].trim();
          toCurr = args[1].trim();
        } else {
          amount = parseFloat(args[0].trim().replace(',', '.')) || 1;
          fromCurr = args[1].trim();
          toCurr = args[2].trim();
        }

        try {
          const conv = await convertCurrency(amount, fromCurr, toCurr);
          const replyText =
            `💱 *Konversi Mata Uang:*\n` +
            `*${formatCurrencyAmount(conv.amount)} ${conv.from}* = *${formatCurrencyAmount(conv.result)} ${conv.to}*\n\n` +
            `• *Kurs Acuan:* 1 ${conv.from} = ${formatCurrencyAmount(conv.rate)} ${conv.to}`;
          await ctx.reply(replyText, { parse_mode: 'Markdown' });
        } catch (err) {
          console.error(`Gagal memproses tag [KURS]:`, err.message);
        }
      },
    },
    {
      name: 'CONVERT',
      promptHint:
        'Konversi satuan ukuran. Format: [CONVERT: nilai | satuan_asal | satuan_tujuan] (contoh: [CONVERT: 5 | km | mil]).',
      handle: async (ctx, args) => {
        if (!args || args.length < 3) return;
        const val = args[0].trim();
        const from = args[1].trim();
        const to = args[2].trim();

        try {
          const conv = convertUnit(val, from, to);
          const replyText =
            `📐 *Konversi Satuan (${conv.category}):*\n` +
            `*${conv.value} ${conv.from}* = *${conv.result} ${conv.to}*`;
          await ctx.reply(replyText, { parse_mode: 'Markdown' });
        } catch (err) {
          console.error(`Gagal memproses tag [CONVERT]:`, err.message);
        }
      },
    },
  ],
};

