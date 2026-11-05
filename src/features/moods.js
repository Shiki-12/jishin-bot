import { InlineKeyboard } from 'grammy';
import {
  MOOD_LEVELS,
  hasCrisisSigns,
  recordMood,
  getUserMoodsLast7Days,
  renderMoodWeekSummary,
} from '../core/moods.js';
import { getSetting } from '../core/settings.js';

export const MEDICAL_DISCLAIMER =
  '⚠️ _Catatan: Fitur jurnal ini adalah refleksi pribadi dan BUKAN pengganti terapi, konseling, atau diagnosis medis profesional._';

export const CRISIS_RESPONSE =
  'Hei, tolong jangan berkata seperti itu... Aku di sini mendengarkan kamu. Kamu tidak sendirian dan perasaanmu itu penting. Tolong segera hubungi orang terdekat yang kamu percaya atau layanan bantuan resmi:\n' +
  '• Hotline SEJIWA Kemenkes RI: Telepon 119 (ekstensi 8)\n' +
  '• Halo Kemenkes: 1500-567\n' +
  '• Layanan Darurat Nasional: 112\n' +
  '• Atau fasilitas kesehatan terdekat (Puskesmas / IGD). Tolong jaga dirimu baik-baik ya.';

function buildMoodKeyboard() {
  return new InlineKeyboard()
    .text('😢 1', 'mood:set:1')
    .text('🙁 2', 'mood:set:2')
    .text('😐 3', 'mood:set:3')
    .text('🙂 4', 'mood:set:4')
    .text('😄 5', 'mood:set:5');
}

export function getPersonaMoodComment(persona, score) {
  const p = persona ?? { strings: {} };
  const numScore = Number(score);

  if (p.strings?.moodFeedback) {
    if (numScore <= 2 && p.strings.moodFeedback.low) return p.strings.moodFeedback.low;
    if (numScore === 3 && p.strings.moodFeedback.neutral) return p.strings.moodFeedback.neutral;
    if (numScore >= 4 && p.strings.moodFeedback.high) return p.strings.moodFeedback.high;
  }

  // Fallback umum netral
  if (numScore <= 2) {
    return 'Hari yang berat ya... Istirahatlah sejenak dan jangan terlalu keras pada dirimu sendiri.';
  }
  if (numScore === 3) {
    return 'Catatan tersimpan. Semoga sisa harimu berjalan tenang dan lancar.';
  }
  return 'Senang mendengar harimu menyenangkan! Pertahankan energi positifmu!';
}

export default {
  id: 'moods',

  commands: [
    {
      name: 'mood',
      description: 'Catat mood harian (skala 1-5, opsional dengan catatan)',
      handler: async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) return;

        const text = ctx.message?.text ?? '';
        const parts = text.split(/\s+/).slice(1);
        const scoreArg = parts[0];

        const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');

        // Jika user memanggil /mood tanpa argumen atau format bukan 1-5
        if (!scoreArg || isNaN(parseInt(scoreArg, 10)) || parseInt(scoreArg, 10) < 1 || parseInt(scoreArg, 10) > 5) {
          const prompt =
            `💭 *Check-in Mood Harian*\n\n` +
            `Bagaimana perasaanmu saat ini? Pilih skala 1 sampai 5:\n\n` +
            `• 1: Sangat Buruk 😢\n` +
            `• 2: Buruk 🙁\n` +
            `• 3: Biasa Saja 😐\n` +
            `• 4: Baik 🙂\n` +
            `• 5: Sangat Baik 😄\n\n` +
            `_Bisa juga langsung ketik:_\n\`/mood <1-5> [catatan]\`\nContoh: \`/mood 4 Hari ini seru banget!\`\n\n` +
            `${MEDICAL_DISCLAIMER}`;

          await ctx.reply(prompt, {
            parse_mode: 'Markdown',
            reply_markup: buildMoodKeyboard(),
          });
          return;
        }

        const score = parseInt(scoreArg, 10);
        const note = parts.slice(1).join(' ').trim() || null;

        // Cek indikasi krisis keselamatan
        if (note && hasCrisisSigns(note)) {
          recordMood({ userId, score, note, tz });
          await ctx.reply(CRISIS_RESPONSE);
          return;
        }

        const saved = recordMood({ userId, score, note, tz });
        const meta = MOOD_LEVELS[score] || { emoji: '😐', label: 'Biasa' };
        const comment = getPersonaMoodComment(ctx.persona, score);
        const notePart = saved.note ? `\n📝 *Catatan:* _"${saved.note}"_` : '';

        const replyMsg =
          `✅ *Mood Tersimpan!* (${score}/5 ${meta.emoji} — ${meta.label})${notePart}\n\n` +
          `${comment}\n\n` +
          `${MEDICAL_DISCLAIMER}`;

        await ctx.reply(replyMsg, { parse_mode: 'Markdown' });
      },
    },

    {
      name: 'moodweek',
      description: 'Lihat ringkasan jurnal mood 7 hari terakhir',
      handler: async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) return;

        const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
        const rows = getUserMoodsLast7Days(userId);

        if (rows.length === 0) {
          await ctx.reply(
            `Belum ada catatan mood dalam 7 hari terakhir.\nKetik \`/mood\` untuk mulai mencatat perasaanmu! 😊\n\n${MEDICAL_DISCLAIMER}`,
            { parse_mode: 'Markdown' },
          );
          return;
        }

        const summary = renderMoodWeekSummary(rows, tz);
        await ctx.reply(summary, { parse_mode: 'Markdown' });
      },
    },
  ],

  callbacks: [
    {
      prefix: 'mood:set:',
      handler: async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) return;

        const data = ctx.callbackQuery?.data ?? '';
        const scoreStr = data.replace('mood:set:', '');
        const score = parseInt(scoreStr, 10);

        if (isNaN(score) || score < 1 || score > 5) {
          await ctx.answerCallbackQuery({ text: 'Pilihan tidak valid!' });
          return;
        }

        const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
        recordMood({ userId, score, note: null, tz });

        const meta = MOOD_LEVELS[score] || { emoji: '😐', label: 'Biasa' };
        const comment = getPersonaMoodComment(ctx.persona, score);

        const resultText =
          `✅ *Mood Tersimpan!* (${score}/5 ${meta.emoji} — ${meta.label})\n\n` +
          `${comment}\n\n` +
          `💡 _Tips: Kamu juga bisa menulis jurnal dengan catatan cerita, contoh:_\n\`/mood ${score} kerjaan hari ini beres semua\`\n\n` +
          `${MEDICAL_DISCLAIMER}`;

        await ctx.editMessageText(resultText, { parse_mode: 'Markdown' });
        await ctx.answerCallbackQuery({ text: `Mood ${score}/5 tersimpan!` });
      },
    },
  ],
};

