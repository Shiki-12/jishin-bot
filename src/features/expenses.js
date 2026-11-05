import { InputFile, InlineKeyboard } from 'grammy';
import { getSetting } from '../core/settings.js';
import {
  parseExpenseAmount,
  formatRupiah,
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  addExpense,
  getExpenseById,
  deleteExpense,
  updateExpenseCategory,
  getExpensesSummary,
  generateExpensesCsv,
} from '../core/expenses.js';

/**
 * Buat inline keyboard untuk koreksi kategori pengeluaran.
 */
export function buildCategoryKeyboard(expenseId) {
  return new InlineKeyboard()
    .text('🍜 Makanan', `exp:cat:${expenseId}:makanan`)
    .text('🚗 Transport', `exp:cat:${expenseId}:transport`)
    .text('🛍️ Belanja', `exp:cat:${expenseId}:belanja`)
    .row()
    .text('📄 Tagihan', `exp:cat:${expenseId}:tagihan`)
    .text('🎮 Hiburan', `exp:cat:${expenseId}:hiburan`)
    .text('💊 Kesehatan', `exp:cat:${expenseId}:kesehatan`)
    .row()
    .text('📦 Lainnya', `exp:cat:${expenseId}:lainnya`);
}

export default {
  id: 'expenses',

  commands: [
    {
      name: 'catat',
      description: 'Catat pengeluaran (/catat <nominal> <keterangan>, contoh: /catat 25k makan siang)',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const userId = ctx.from?.id;
        if (!userId) return;

        const raw = ctx.message?.text?.trim() || '';
        const parts = raw.split(/\s+/).slice(1);

        if (parts.length === 0) {
          await ctx.reply(
            'Format perintah: `/catat <nominal> <keterangan>`\n' +
              'Contoh:\n' +
              '• `/catat 25k makan siang`\n' +
              '• `/catat 50rb bensin pertalite`\n' +
              '• `/catat 1,5jt bayar kosan`\n' +
              '• `/catat 25.000 belanja sabun`',
            { parse_mode: 'Markdown' },
          );
          return;
        }

        const amountRaw = parts[0];
        const noteRaw = parts.slice(1).join(' ').trim() || 'Pengeluaran';

        try {
          const exp = addExpense({
            userId,
            amount: amountRaw,
            note: noteRaw,
          });

          const catLabel = CATEGORY_LABELS[exp.category] || exp.category;
          const template =
            p.strings?.expenseRecorded ??
            '💸 *Pengeluaran Dicatat!*\n' +
              '• Nominal: *{amount}*\n' +
              '• Kategori: *{category}*\n' +
              '• Keterangan: "{note}"';

          const replyText = template
            .replace('{amount}', formatRupiah(exp.amount))
            .replace('{category}', catLabel)
            .replace('{note}', exp.note);

          const footer = '\n\n_Koreksi kategori jika belum sesuai:_';
          await ctx.reply(`${replyText}${footer}`, {
            parse_mode: 'Markdown',
            reply_markup: buildCategoryKeyboard(exp.id),
          });
        } catch (err) {
          await ctx.reply(`⚠️ ${err.message}`);
        }
      },
    },
    {
      name: 'rekap',
      description: 'Lihat ringkasan pengeluaran (/rekap, /rekap minggu, /rekap bulan)',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const userId = ctx.from?.id;
        if (!userId) return;

        const raw = ctx.message?.text?.trim() || '';
        const parts = raw.split(/\s+/).slice(1);
        const periodArg = parts[0]?.toLowerCase() || 'hari';

        const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
        const summary = getExpensesSummary({ userId, period: periodArg, tz });

        if (summary.totalCount === 0) {
          const emptyMsg =
            p.strings?.expenseEmpty ??
            `Belum ada catatan pengeluaran untuk periode *${summary.periodLabel}*.`;
          await ctx.reply(emptyMsg, { parse_mode: 'Markdown' });
          return;
        }

        const headerTemplate =
          p.strings?.expenseRekapHeader ??
          '📊 *Rekap Pengeluaran ({period}):*';
        const header = headerTemplate.replace('{period}', summary.periodLabel);

        const lines = summary.breakdown.map((item) => {
          return `• ${item.label}: *${formatRupiah(item.amount)}* (${item.percentage}% - ${item.count}x)`;
        });

        const totalStr = `\n💰 *Total Pengeluaran:* *${formatRupiah(summary.totalAmount)}* (${summary.totalCount} transaksi)`;
        const footer =
          '\n\n_Perintah lain:_\n' +
          '• `/rekap hari` (Hari ini)\n' +
          '• `/rekap minggu` (Minggu ini)\n' +
          '• `/rekap bulan` (Bulan ini)\n' +
          '• `/exportcsv` (Unduh laporan CSV)';

        await ctx.reply(
          `${header}\n\n${lines.join('\n')}\n${totalStr}${footer}`,
          { parse_mode: 'Markdown' },
        );
      },
    },
    {
      name: 'hapuscatat',
      description: 'Hapus catatan pengeluaran berdasarkan ID (/hapuscatat <id>)',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const userId = ctx.from?.id;
        if (!userId) return;

        const raw = ctx.message?.text?.trim() || '';
        const parts = raw.split(/\s+/).slice(1);
        const expenseId = parseInt(parts[0], 10);

        if (isNaN(expenseId)) {
          await ctx.reply('Gunakan format: `/hapuscatat <id>`\nContoh: `/hapuscatat 5`', {
            parse_mode: 'Markdown',
          });
          return;
        }

        const ok = deleteExpense(expenseId, userId);
        if (ok) {
          const template =
            p.strings?.expenseDeleted ??
            'Catatan pengeluaran #{id} berhasil dihapus.';
          await ctx.reply(template.replace('{id}', expenseId));
        } else {
          const template =
            p.strings?.expenseNotFound ??
            'Catatan pengeluaran #{id} tidak ditemukan.';
          await ctx.reply(template.replace('{id}', expenseId));
        }
      },
    },
    {
      name: 'exportcsv',
      description: 'Unduh seluruh riwayat pengeluaran dalam format file CSV',
      handler: async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) return;

        const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
        const csvContent = generateExpensesCsv(userId, tz);

        // Jika hanya ada 1 baris header, berarti belum ada data
        if (!csvContent.includes('\n')) {
          await ctx.reply('Belum ada riwayat pengeluaran untuk diekspor.');
          return;
        }

        try {
          const fileBuffer = Buffer.from(csvContent, 'utf-8');
          const fileName = `pengeluaran_${userId}.csv`;
          await ctx.replyWithDocument(new InputFile(fileBuffer, fileName), {
            caption: '📄 Berikut file rekap pengeluaran kamu (format CSV).',
          });
        } catch (err) {
          console.error('Gagal mengirim file CSV pengeluaran:', err);
          await ctx.reply('⚠️ Gagal membuat file CSV pengeluaran saat ini.');
        }
      },
    },
  ],

  callbacks: [
    {
      prefix: 'exp:',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const data = ctx.callbackQuery?.data || '';
        // Format: exp:cat:<id>:<category>
        const parts = data.split(':');
        const action = parts[1];
        const expenseId = parseInt(parts[2], 10);
        const newCat = parts[3];
        const userId = ctx.from?.id;

        if (action !== 'cat' || isNaN(expenseId) || !userId) {
          await ctx.answerCallbackQuery({ text: 'Data tombol tidak valid.' });
          return;
        }

        const existing = getExpenseById(expenseId, userId);
        if (!existing) {
          await ctx.answerCallbackQuery({
            text: 'Catatan pengeluaran tidak ditemukan.',
          });
          return;
        }

        try {
          updateExpenseCategory(expenseId, userId, newCat);
          const catLabel = CATEGORY_LABELS[newCat] || newCat;

          await ctx.answerCallbackQuery({
            text: `Kategori diubah jadi: ${catLabel}`,
          });

          const template =
            p.strings?.expenseCategoryUpdated ??
            'Kategori pengeluaran #{id} berhasil diubah jadi *{category}*.';
          const updateText = template
            .replace('{id}', expenseId)
            .replace('{category}', catLabel);

          const fullMsg =
            `💸 *Pengeluaran Diperbarui!*\n` +
            `• ID: #${existing.id}\n` +
            `• Nominal: *${formatRupiah(existing.amount)}*\n` +
            `• Kategori: *${catLabel}*\n` +
            `• Keterangan: "${existing.note}"\n\n` +
            `_${updateText}_`;

          await ctx.editMessageText(fullMsg, {
            parse_mode: 'Markdown',
            reply_markup: buildCategoryKeyboard(existing.id),
          });
        } catch (err) {
          await ctx.answerCallbackQuery({ text: err.message });
        }
      },
    },
  ],

  tags: [
    {
      name: 'EXPENSE',
      promptHint:
        'Catat pengeluaran uang user. Format: [EXPENSE: nominal | kategori | keterangan]. Contoh: [EXPENSE: 25000 | makanan | nasi padang], [EXPENSE: 50000 | transport | bensin]. Pilihan kategori: makanan, transport, belanja, tagihan, hiburan, kesehatan, lainnya. Gunakan tag ini jika user mengabarkan baru saja membeli sesuatu atau mengeluarkan uang.',
      handle: async (ctx, args) => {
        const rawAmount = args?.[0]?.trim();
        const rawCategory = args?.[1]?.trim()?.toLowerCase();
        const rawNote = args?.[2]?.trim() || 'Pengeluaran';
        const userId = ctx.from?.id;

        if (!rawAmount || !userId) return;

        try {
          const exp = addExpense({
            userId,
            amount: rawAmount,
            category: EXPENSE_CATEGORIES.includes(rawCategory) ? rawCategory : null,
            note: rawNote,
          });

          const p = ctx.persona ?? { strings: {} };
          const catLabel = CATEGORY_LABELS[exp.category] || exp.category;
          const template =
            p.strings?.expenseRecorded ??
            '💸 *Pengeluaran Dicatat!*\n' +
              '• Nominal: *{amount}*\n' +
              '• Kategori: *{category}*\n' +
              '• Keterangan: "{note}"';

          const replyText = template
            .replace('{amount}', formatRupiah(exp.amount))
            .replace('{category}', catLabel)
            .replace('{note}', exp.note);

          await ctx.reply(replyText, {
            parse_mode: 'Markdown',
            reply_markup: buildCategoryKeyboard(exp.id),
          });
        } catch (err) {
          console.error('Gagal memproses tag [EXPENSE]:', err.message);
        }
      },
    },
  ],
};

