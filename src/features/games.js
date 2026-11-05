import { InlineKeyboard } from 'grammy';
import {
  rollDice,
  flipCoin,
  pickOption,
  playSuit,
  startTebakGame,
  getTebakGame,
  guessTebakGame,
  getRandomQuizQuestion,
  checkQuizAnswer,
  recordGameResult,
  getUserScore,
  getChatLeaderboard,
} from '../core/games.js';

const SUIT_EMOJI = {
  batu: '🪨 Batu',
  gunting: '✂️ Gunting',
  kertas: '📄 Kertas',
};

function buildSuitKeyboard() {
  return new InlineKeyboard()
    .text('🪨 Batu', 'suit:batu')
    .text('✂️ Gunting', 'suit:gunting')
    .text('📄 Kertas', 'suit:kertas');
}

function buildQuizKeyboard(question) {
  const kb = new InlineKeyboard();
  const letters = ['A', 'B', 'C', 'D'];
  question.options.forEach((opt, idx) => {
    kb.text(`${letters[idx]}. ${opt}`, `quiz:${question.id}:${idx}`).row();
  });
  return kb;
}

export default {
  id: 'games',

  commands: [
    {
      name: 'suit',
      description: 'Main suit (batu-gunting-kertas) lawan bot',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const prompt =
          p.strings?.suitPrompt ??
          'Ayo main suit! Pilih batu, gunting, atau kertas:';
        await ctx.reply(prompt, { reply_markup: buildSuitKeyboard() });
      },
    },

    {
      name: 'tebak',
      description: 'Tebak angka rahasia 1-100 (misal: /tebak 45)',
      handler: async (ctx) => {
        const chatId = ctx.chat.id;
        const userId = ctx.from?.id;
        const p = ctx.persona ?? { strings: {} };
        const text = ctx.message?.text ?? '';
        const parts = text.split(/\s+/).slice(1);
        const arg = parts[0];

        if (!arg) {
          const existing = getTebakGame(chatId);
          if (existing) {
            await ctx.reply(
              `Permainan tebak angka sedang berjalan!\nSisa kesempatan: *${existing.attemptsLeft}/${existing.maxAttempts}*.\nTebak dengan: \`/tebak <angka>\``,
              { parse_mode: 'Markdown' },
            );
            return;
          }

          startTebakGame(chatId);
          const startMsg =
            p.strings?.tebakStart ??
            'Aku sudah memilih angka rahasia antara 1 sampai 100! Kamu punya 7 kesempatan. Tebak dengan: `/tebak <angka>`';
          await ctx.reply(startMsg, { parse_mode: 'Markdown' });
          return;
        }

        const guessNum = parseInt(arg, 10);
        if (isNaN(guessNum) || guessNum < 1 || guessNum > 100) {
          await ctx.reply('Masukkan angka bulat antara 1 sampai 100! Contoh: `/tebak 50`', {
            parse_mode: 'Markdown',
          });
          return;
        }

        if (!getTebakGame(chatId)) {
          startTebakGame(chatId);
        }

        const res = guessTebakGame(chatId, guessNum);

        if (res.status === 'win') {
          if (userId) recordGameResult({ userId, chatId, result: 'win' });
          const winMsg =
            p.strings?.tebakWin?.replace('{target}', res.target) ??
            `Selamat! Tebakanmu benar di angka *${res.target}*! (+3 poin)`;
          await ctx.reply(winMsg, { parse_mode: 'Markdown' });
          return;
        }

        if (res.status === 'game_over') {
          if (userId) recordGameResult({ userId, chatId, result: 'loss' });
          const lossMsg =
            p.strings?.tebakGameOver?.replace('{target}', res.target) ??
            `Kesempatanmu habis! Angka rahasianya adalah *${res.target}*. (+0 poin)`;
          await ctx.reply(lossMsg, { parse_mode: 'Markdown' });
          return;
        }

        if (res.status === 'too_high') {
          const highMsg =
            p.strings?.tebakTooHigh?.replace('{attempts}', res.attemptsLeft) ??
            `Terlalu besar! Sisa ${res.attemptsLeft} kesempatan.`;
          await ctx.reply(highMsg);
          return;
        }

        if (res.status === 'too_low') {
          const lowMsg =
            p.strings?.tebakTooLow?.replace('{attempts}', res.attemptsLeft) ??
            `Terlalu kecil! Sisa ${res.attemptsLeft} kesempatan.`;
          await ctx.reply(lowMsg);
          return;
        }
      },
    },

    {
      name: 'quiz',
      description: 'Kuis trivia pilihan ganda',
      handler: async (ctx) => {
        const question = getRandomQuizQuestion();
        if (!question) {
          await ctx.reply('Bank soal kuis belum tersedia.');
          return;
        }

        const letters = ['A', 'B', 'C', 'D'];
        const optionsList = question.options
          .map((opt, i) => `${letters[i]}. ${opt}`)
          .join('\n');

        const text = `🧠 *Kuis Trivia*\n\n*${question.question}*\n\n${optionsList}`;
        await ctx.reply(text, {
          parse_mode: 'Markdown',
          reply_markup: buildQuizKeyboard(question),
        });
      },
    },

    {
      name: 'truth',
      description: 'Tantangan kejujuran (Truth)',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const list = Array.isArray(p.strings?.truth) && p.strings.truth.length > 0
          ? p.strings.truth
          : [
              'Hal paling memalukan apa yang pernah kamu alami?',
              'Kapan terakhir kali kamu berbohong dan untuk apa?',
            ];
        const item = list[Math.floor(Math.random() * list.length)];
        await ctx.reply(`🤫 *Truth:*\n"${item}"\n\n_Jawab jujur ya!_`, {
          parse_mode: 'Markdown',
        });
      },
    },

    {
      name: 'dare',
      description: 'Tantangan keberanian (Dare)',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const list = Array.isArray(p.strings?.dare) && p.strings.dare.length > 0
          ? p.strings.dare
          : [
              'Kirim stiker lucu ke chat teratasmu sekarang!',
              'Minum segelas air putih sekarang!',
            ];
        const item = list[Math.floor(Math.random() * list.length)];
        await ctx.reply(`🔥 *Dare:*\n"${item}"\n\n_Lakukan sekarang, jangan kabur!_`, {
          parse_mode: 'Markdown',
        });
      },
    },

    {
      name: 'pilih',
      description: 'Bantu pilihkan opsi (misal: /pilih kopi, teh, susu)',
      handler: async (ctx) => {
        const text = ctx.message?.text ?? '';
        const rawArg = text.replace(/^\/pilih(@\w+)?/i, '').trim();

        if (!rawArg) {
          await ctx.reply('Format salah! Contoh: `/pilih kopi, teh, susu` atau `/pilih mie ayam atau bakso`', {
            parse_mode: 'Markdown',
          });
          return;
        }

        const delimiter = rawArg.includes(' atau ') ? /\s+atau\s+/i : /,/;
        const options = rawArg
          .split(delimiter)
          .map((s) => s.trim())
          .filter(Boolean);

        if (options.length < 2) {
          await ctx.reply('Berikan minimal 2 pilihan! Contoh: `/pilih nonton, tidur`', {
            parse_mode: 'Markdown',
          });
          return;
        }

        const choice = pickOption(options);
        const p = ctx.persona ?? { strings: {} };
        const replyText =
          p.strings?.pickChoice?.replace('{choice}', choice) ??
          `Aku pilihkan: *${choice}*!`;

        await ctx.reply(replyText, { parse_mode: 'Markdown' });
      },
    },

    {
      name: 'dadu',
      description: 'Lempar dadu acak 1-6',
      handler: async (ctx) => {
        const roll = rollDice();
        await ctx.reply(`🎲 *Hasil Lemparan Dadu:* [ *${roll}* ]`, {
          parse_mode: 'Markdown',
        });
      },
    },

    {
      name: 'koin',
      description: 'Lempar koin (Gambar / Angka)',
      handler: async (ctx) => {
        const flip = flipCoin();
        await ctx.reply(`🪙 *Hasil Lemparan Koin:* [ *${flip}* ]`, {
          parse_mode: 'Markdown',
        });
      },
    },

    {
      name: 'skor',
      description: 'Lihat papan skor game di chat ini',
      handler: async (ctx) => {
        const chatId = ctx.chat.id;
        const userId = ctx.from?.id;
        const rows = getChatLeaderboard(chatId, 10);

        if (rows.length === 0) {
          await ctx.reply(
            '🏆 Belum ada skor tercatat di chat ini.\nMainkan /suit, /tebak, atau /quiz untuk mulai mengumpulkan poin!',
          );
          return;
        }

        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        const listText = rows
          .map((r, i) => `${medals[i] || `${i + 1}.`} *${r.first_name}*: *${r.points}* poin (${r.wins}M / ${r.draws}S / ${r.losses}K)`)
          .join('\n');

        let footer = '';
        if (userId) {
          const myScore = getUserScore(userId, chatId);
          footer = `\n\n👤 *Skormu:* *${myScore.points}* poin (${myScore.wins} Menang / ${myScore.draws} Seri / ${myScore.losses} Kalah)`;
        }

        const response = `🏆 *Papan Skor Game*\n\n${listText}${footer}`;
        await ctx.reply(response, { parse_mode: 'Markdown' });
      },
    },
  ],

  callbacks: [
    {
      prefix: 'suit:',
      handler: async (ctx) => {
        const data = ctx.callbackQuery?.data ?? '';
        const choice = data.replace('suit:', '');

        if (choice === 'again') {
          const p = ctx.persona ?? { strings: {} };
          const prompt =
            p.strings?.suitPrompt ??
            'Ayo main suit lagi! Pilih batu, gunting, atau kertas:';
          await ctx.editMessageText(prompt, { reply_markup: buildSuitKeyboard() });
          await ctx.answerCallbackQuery().catch(() => {});
          return;
        }

        let playRes;
        try {
          playRes = playSuit(choice);
        } catch {
          await ctx.answerCallbackQuery({ text: 'Pilihan tidak valid!' });
          return;
        }

        const userId = ctx.from?.id;
        const chatId = ctx.chat?.id;
        if (userId && chatId) {
          recordGameResult({ userId, chatId, result: playRes.result });
        }

        const p = ctx.persona ?? { strings: {} };
        let comment = '';
        if (playRes.result === 'win') {
          comment = p.strings?.suitWin ?? 'Kamu menang! (+3 poin)';
        } else if (playRes.result === 'loss') {
          comment = p.strings?.suitLoss ?? 'Kamu kalah! (+0 poin)';
        } else {
          comment = p.strings?.suitDraw ?? 'Hasil seri! (+1 poin)';
        }

        const uEmoji = SUIT_EMOJI[playRes.userChoice] || playRes.userChoice;
        const bEmoji = SUIT_EMOJI[playRes.botChoice] || playRes.botChoice;

        const resultText =
          `✂️ *Hasil Suit*\n\n` +
          `• Kamu: ${uEmoji}\n` +
          `• Bot: ${bEmoji}\n\n` +
          `${comment}`;

        const againKb = new InlineKeyboard().text('Main Lagi 🔄', 'suit:again');
        await ctx.editMessageText(resultText, {
          parse_mode: 'Markdown',
          reply_markup: againKb,
        });
        await ctx.answerCallbackQuery().catch(() => {});
      },
    },

    {
      prefix: 'quiz:',
      handler: async (ctx) => {
        const data = ctx.callbackQuery?.data ?? '';
        const parts = data.replace('quiz:', '').split(':');

        if (parts[0] === 'next') {
          const question = getRandomQuizQuestion();
          if (!question) {
            await ctx.answerCallbackQuery({ text: 'Soal belum tersedia.' });
            return;
          }
          const letters = ['A', 'B', 'C', 'D'];
          const optionsList = question.options
            .map((opt, i) => `${letters[i]}. ${opt}`)
            .join('\n');
          const text = `🧠 *Kuis Trivia*\n\n*${question.question}*\n\n${optionsList}`;
          await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: buildQuizKeyboard(question),
          });
          await ctx.answerCallbackQuery().catch(() => {});
          return;
        }

        const qId = parseInt(parts[0], 10);
        const optIdx = parseInt(parts[1], 10);
        const check = checkQuizAnswer(qId, optIdx);

        if (!check) {
          await ctx.answerCallbackQuery({ text: 'Soal tidak ditemukan.' });
          return;
        }

        const userId = ctx.from?.id;
        const chatId = ctx.chat?.id;
        if (userId && chatId) {
          recordGameResult({
            userId,
            chatId,
            result: check.correct ? 'win' : 'loss',
          });
        }

        let resultMsg = '';
        if (check.correct) {
          resultMsg =
            `🎉 *Jawabanmu BENAR!* (+3 poin)\n\n` +
            `*Pertanyaan:* ${check.question.question}\n` +
            `*Jawaban:* ${check.correctText}\n\n` +
            `ℹ️ _${check.explanation}_`;
        } else {
          resultMsg =
            `❌ *Jawabanmu SALAH!*\n\n` +
            `*Pertanyaan:* ${check.question.question}\n` +
            `*Jawaban yang benar:* ${check.correctText}\n\n` +
            `ℹ️ _${check.explanation}_`;
        }

        const nextKb = new InlineKeyboard().text('Soal Berikutnya 🎲', 'quiz:next');
        await ctx.editMessageText(resultMsg, {
          parse_mode: 'Markdown',
          reply_markup: nextKb,
        });
        await ctx.answerCallbackQuery().catch(() => {});
      },
    },
  ],
};

