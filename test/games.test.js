import './setup.js';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/core/db.js';
import {
  rollDice,
  flipCoin,
  pickOption,
  playSuit,
  startTebakGame,
  getTebakGame,
  guessTebakGame,
  cancelTebakGame,
  loadQuizBank,
  getQuizQuestion,
  getRandomQuizQuestion,
  checkQuizAnswer,
  recordGameResult,
  getUserScore,
  getChatLeaderboard,
} from '../src/core/games.js';
import gamesFeature from '../src/features/games.js';
import { tsundere } from '../src/personalities/tsundere.js';

describe('F-23: Game Kecil & Hiburan', () => {
  const TEST_USER_1 = 887701;
  const TEST_USER_2 = 887702;
  const TEST_CHAT = -100887700;

  function cleanupDb() {
    const db = getDb();
    db.prepare('DELETE FROM game_scores WHERE chat_id = ? OR user_id IN (?, ?)').run(
      TEST_CHAT,
      TEST_USER_1,
      TEST_USER_2,
    );
    cancelTebakGame(TEST_CHAT);
  }

  beforeEach(() => {
    cleanupDb();
    const db = getDb();
    db.prepare(
      `INSERT INTO users (id, first_name, username, created_at)
       VALUES (?, 'PlayerOne', 'player1', ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(TEST_USER_1, Date.now());
    db.prepare(
      `INSERT INTO users (id, first_name, username, created_at)
       VALUES (?, 'PlayerTwo', 'player2', ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(TEST_USER_2, Date.now());
  });

  after(() => {
    cleanupDb();
  });

  describe('Operasi Acak Murni (Dice, Coin, Pick)', () => {
    it('rollDice menghasilkan angka bulat antara 1 sampai 6', () => {
      for (let i = 0; i < 50; i++) {
        const roll = rollDice();
        assert.ok(roll >= 1 && roll <= 6);
        assert.equal(Number.isInteger(roll), true);
      }
    });

    it('flipCoin menghasilkan Gambar atau Angka', () => {
      const results = new Set();
      for (let i = 0; i < 50; i++) {
        const flip = flipCoin();
        assert.ok(flip === 'Gambar' || flip === 'Angka');
        results.add(flip);
      }
      assert.ok(results.has('Gambar') || results.has('Angka'));
    });

    it('pickOption memilih salah satu opsi secara adil', () => {
      const options = ['kopi', 'teh', 'susu'];
      const chosen = pickOption(options);
      assert.ok(options.includes(chosen));

      assert.equal(pickOption([]), null);
      assert.equal(pickOption(null), null);
    });
  });

  describe('Logika Permainan Suit (playSuit)', () => {
    it('menentukan kemenangan user dengan tepat', () => {
      assert.equal(playSuit('batu', 'gunting').result, 'win');
      assert.equal(playSuit('gunting', 'kertas').result, 'win');
      assert.equal(playSuit('kertas', 'batu').result, 'win');
    });

    it('menentukan kekalahan user dengan tepat', () => {
      assert.equal(playSuit('batu', 'kertas').result, 'loss');
      assert.equal(playSuit('gunting', 'batu').result, 'loss');
      assert.equal(playSuit('kertas', 'gunting').result, 'loss');
    });

    it('menentukan hasil seri jika pilihan sama', () => {
      assert.equal(playSuit('batu', 'batu').result, 'draw');
      assert.equal(playSuit('gunting', 'gunting').result, 'draw');
      assert.equal(playSuit('kertas', 'kertas').result, 'draw');
    });

    it('menolak pilihan tidak valid', () => {
      assert.throws(() => playSuit('pistol', 'batu'));
    });
  });

  describe('Tebak Angka 1-100 (guessTebakGame)', () => {
    it('mengelola siklus permainan tebak angka dari mulai hingga menang', () => {
      startTebakGame(TEST_CHAT, { maxAttempts: 5, target: 42 });
      const active = getTebakGame(TEST_CHAT);
      assert.ok(active);
      assert.equal(active.target, 42);
      assert.equal(active.attemptsLeft, 5);

      // Tebak terlalu kecil
      const resLow = guessTebakGame(TEST_CHAT, 30);
      assert.equal(resLow.status, 'too_low');
      assert.equal(resLow.attemptsLeft, 4);

      // Tebak terlalu besar
      const resHigh = guessTebakGame(TEST_CHAT, 50);
      assert.equal(resHigh.status, 'too_high');
      assert.equal(resHigh.attemptsLeft, 3);

      // Tebak tepat
      const resWin = guessTebakGame(TEST_CHAT, 42);
      assert.equal(resWin.status, 'win');
      assert.equal(resWin.target, 42);

      // Sesi game otomatis dibersihkan setelah menang
      assert.equal(getTebakGame(TEST_CHAT), null);
    });

    it('menangani game over saat kesempatan habis', () => {
      startTebakGame(TEST_CHAT, { maxAttempts: 2, target: 77 });

      guessTebakGame(TEST_CHAT, 50);
      const resOver = guessTebakGame(TEST_CHAT, 60);

      assert.equal(resOver.status, 'game_over');
      assert.equal(resOver.target, 77);
      assert.equal(getTebakGame(TEST_CHAT), null);
    });

    it('menolak input tebakan yang bukan angka 1-100', () => {
      startTebakGame(TEST_CHAT, { maxAttempts: 3, target: 50 });
      assert.throws(() => guessTebakGame(TEST_CHAT, 0));
      assert.throws(() => guessTebakGame(TEST_CHAT, 150));
      assert.throws(() => guessTebakGame(TEST_CHAT, 'abc'));
    });
  });

  describe('Bank Soal Kuis (Quiz)', () => {
    it('loadQuizBank memuat daftar soal kuis dari quiz.json', () => {
      const questions = loadQuizBank();
      assert.ok(Array.isArray(questions));
      assert.ok(questions.length >= 10);

      const first = questions[0];
      assert.ok(first.id);
      assert.ok(first.question);
      assert.equal(first.options.length, 4);
      assert.ok(Number.isInteger(first.answer));
    });

    it('checkQuizAnswer memeriksa kebenaran jawaban', () => {
      const q = getRandomQuizQuestion();
      assert.ok(q);

      // Jawaban benar
      const correctRes = checkQuizAnswer(q.id, q.answer);
      assert.equal(correctRes.correct, true);
      assert.equal(correctRes.correctText, q.options[q.answer]);

      // Jawaban salah
      const wrongIdx = (q.answer + 1) % 4;
      const wrongRes = checkQuizAnswer(q.id, wrongIdx);
      assert.equal(wrongRes.correct, false);
    });
  });

  describe('Papan Skor & Poin (game_scores)', () => {
    it('mencatat hasil game dan mengakumulasi poin dengan tepat', () => {
      // Menang: +3 poin
      const s1 = recordGameResult({
        userId: TEST_USER_1,
        chatId: TEST_CHAT,
        result: 'win',
      });
      assert.equal(s1.wins, 1);
      assert.equal(s1.losses, 0);
      assert.equal(s1.draws, 0);
      assert.equal(s1.points, 3);

      // Seri: +1 poin
      const s2 = recordGameResult({
        userId: TEST_USER_1,
        chatId: TEST_CHAT,
        result: 'draw',
      });
      assert.equal(s2.wins, 1);
      assert.equal(s2.draws, 1);
      assert.equal(s2.points, 4);

      // Kalah: +0 poin
      const s3 = recordGameResult({
        userId: TEST_USER_1,
        chatId: TEST_CHAT,
        result: 'loss',
      });
      assert.equal(s3.wins, 1);
      assert.equal(s3.losses, 1);
      assert.equal(s3.draws, 1);
      assert.equal(s3.points, 4);
    });

    it('getChatLeaderboard mengurutkan pemain berdasarkan poin tertinggi', () => {
      // User 1: 1 menang (3 poin)
      recordGameResult({ userId: TEST_USER_1, chatId: TEST_CHAT, result: 'win' });

      // User 2: 2 menang (6 poin)
      recordGameResult({ userId: TEST_USER_2, chatId: TEST_CHAT, result: 'win' });
      recordGameResult({ userId: TEST_USER_2, chatId: TEST_CHAT, result: 'win' });

      const leaderboard = getChatLeaderboard(TEST_CHAT, 5);
      assert.equal(leaderboard.length, 2);
      assert.equal(leaderboard[0].user_id, TEST_USER_2);
      assert.equal(leaderboard[0].points, 6);
      assert.equal(leaderboard[1].user_id, TEST_USER_1);
      assert.equal(leaderboard[1].points, 3);
    });
  });

  describe('Perintah Fitur Games (Commands)', () => {
    it('/suit mengirim pilihan tombol batu, gunting, kertas', async () => {
      const replies = [];
      const ctx = {
        chat: { id: TEST_CHAT },
        from: { id: TEST_USER_1 },
        reply: async (text, opts) => replies.push({ text, opts }),
        persona: tsundere,
      };

      const cmd = gamesFeature.commands.find((c) => c.name === 'suit');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].opts.reply_markup);
    });

    it('/tebak angka memainkan tebak angka dan membalas status', async () => {
      startTebakGame(TEST_CHAT, { maxAttempts: 5, target: 80 });
      const replies = [];
      const ctx = {
        chat: { id: TEST_CHAT },
        from: { id: TEST_USER_1 },
        message: { text: '/tebak 50' },
        reply: async (text, opts) => replies.push({ text, opts }),
        persona: tsundere,
      };

      const cmd = gamesFeature.commands.find((c) => c.name === 'tebak');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].text.includes('kecil'));
    });

    it('/quiz menampilkan pertanyaan kuis dan tombol pilihan ganda', async () => {
      const replies = [];
      const ctx = {
        chat: { id: TEST_CHAT },
        reply: async (text, opts) => replies.push({ text, opts }),
      };

      const cmd = gamesFeature.commands.find((c) => c.name === 'quiz');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].text.includes('Kuis Trivia'));
      assert.ok(replies[0].opts.reply_markup);
    });

    it('/truth dan /dare mengembalikan tantangan yang sesuai', async () => {
      const truthReplies = [];
      const dareReplies = [];

      const truthCtx = {
        reply: async (text) => truthReplies.push(text),
        persona: tsundere,
      };
      const dareCtx = {
        reply: async (text) => dareReplies.push(text),
        persona: tsundere,
      };

      const truthCmd = gamesFeature.commands.find((c) => c.name === 'truth');
      const dareCmd = gamesFeature.commands.find((c) => c.name === 'dare');

      await truthCmd.handler(truthCtx);
      await dareCmd.handler(dareCtx);

      assert.ok(truthReplies[0].includes('Truth:'));
      assert.ok(dareReplies[0].includes('Dare:'));
    });

    it('/pilih memilih salah satu opsi', async () => {
      const replies = [];
      const ctx = {
        message: { text: '/pilih kopi, teh, boba' },
        reply: async (text) => replies.push(text),
        persona: tsundere,
      };

      const cmd = gamesFeature.commands.find((c) => c.name === 'pilih');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(
        replies[0].includes('kopi') ||
        replies[0].includes('teh') ||
        replies[0].includes('boba'),
      );
    });

    it('/dadu dan /koin menghasilkan angka acak dan sisi koin', async () => {
      const daduReplies = [];
      const koinReplies = [];

      const daduCmd = gamesFeature.commands.find((c) => c.name === 'dadu');
      const koinCmd = gamesFeature.commands.find((c) => c.name === 'koin');

      await daduCmd.handler({ reply: async (t) => daduReplies.push(t) });
      await koinCmd.handler({ reply: async (t) => koinReplies.push(t) });

      assert.ok(daduReplies[0].includes('Dadu'));
      assert.ok(koinReplies[0].includes('Koin'));
    });

    it('/skor menampilkan papan skor peringkat chat', async () => {
      recordGameResult({ userId: TEST_USER_1, chatId: TEST_CHAT, result: 'win' });
      const replies = [];
      const ctx = {
        chat: { id: TEST_CHAT },
        from: { id: TEST_USER_1 },
        reply: async (text, opts) => replies.push({ text, opts }),
      };

      const cmd = gamesFeature.commands.find((c) => c.name === 'skor');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].text.includes('Papan Skor Game'));
      assert.ok(replies[0].text.includes('*3* poin'));
    });
  });

  describe('Callbacks Interaktif (suit: dan quiz:)', () => {
    it('callback suit memproses pilihan user dan mengedit pesan', async () => {
      const edits = [];
      const ctx = {
        chat: { id: TEST_CHAT },
        from: { id: TEST_USER_1 },
        callbackQuery: { data: 'suit:batu' },
        editMessageText: async (text, opts) => edits.push({ text, opts }),
        answerCallbackQuery: async () => {},
        persona: tsundere,
      };

      const cb = gamesFeature.callbacks.find((c) => c.prefix === 'suit:');
      await cb.handler(ctx);

      assert.equal(edits.length, 1);
      assert.ok(edits[0].text.includes('Hasil Suit'));
      assert.ok(edits[0].text.includes('Kamu: 🪨 Batu'));

      const score = getUserScore(TEST_USER_1, TEST_CHAT);
      assert.ok(score.wins + score.losses + score.draws === 1);
    });

    it('callback quiz memproses jawaban dan memberikan umpan balik', async () => {
      const q = getRandomQuizQuestion();
      const edits = [];
      const ctx = {
        chat: { id: TEST_CHAT },
        from: { id: TEST_USER_1 },
        callbackQuery: { data: `quiz:${q.id}:${q.answer}` },
        editMessageText: async (text, opts) => edits.push({ text, opts }),
        answerCallbackQuery: async () => {},
      };

      const cb = gamesFeature.callbacks.find((c) => c.prefix === 'quiz:');
      await cb.handler(ctx);

      assert.equal(edits.length, 1);
      assert.ok(edits[0].text.includes('Jawabanmu BENAR'));
    });
  });
});
