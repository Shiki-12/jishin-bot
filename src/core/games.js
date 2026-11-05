import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './db.js';

// --- Operasi Acak Murni (Dihitung di kode, bukan oleh LLM) -------------------

export function rollDice() {
  return Math.floor(Math.random() * 6) + 1;
}

export function flipCoin() {
  return Math.random() < 0.5 ? 'Gambar' : 'Angka';
}

export function pickOption(options) {
  if (!Array.isArray(options) || options.length === 0) return null;
  const idx = Math.floor(Math.random() * options.length);
  return options[idx].trim();
}

export const SUIT_CHOICES = ['batu', 'gunting', 'kertas'];

export function playSuit(userChoice, botChoice = null) {
  const cleanUser = String(userChoice).toLowerCase().trim();
  if (!SUIT_CHOICES.includes(cleanUser)) {
    throw new Error(`Pilihan tidak valid: ${userChoice}. Pilihan: ${SUIT_CHOICES.join(', ')}`);
  }

  const cleanBot = botChoice
    ? String(botChoice).toLowerCase().trim()
    : SUIT_CHOICES[Math.floor(Math.random() * SUIT_CHOICES.length)];

  if (cleanUser === cleanBot) {
    return { userChoice: cleanUser, botChoice: cleanBot, result: 'draw' };
  }

  const isWin =
    (cleanUser === 'batu' && cleanBot === 'gunting') ||
    (cleanUser === 'gunting' && cleanBot === 'kertas') ||
    (cleanUser === 'kertas' && cleanBot === 'batu');

  return {
    userChoice: cleanUser,
    botChoice: cleanBot,
    result: isWin ? 'win' : 'loss',
  };
}

// --- Tebak Angka 1-100 (In-Memory Game State per Chat) ------------------------

const tebakGames = new Map(); // chatId -> { target, attemptsLeft, maxAttempts, startedAt }

export function startTebakGame(chatId, { maxAttempts = 7, target = null } = {}) {
  const chosenTarget = target ?? Math.floor(Math.random() * 100) + 1;
  const game = {
    target: chosenTarget,
    attemptsLeft: maxAttempts,
    maxAttempts,
    startedAt: Date.now(),
  };
  tebakGames.set(chatId, game);
  return { ...game };
}

export function getTebakGame(chatId) {
  const game = tebakGames.get(chatId);
  if (!game) return null;

  // TTL 10 menit
  if (Date.now() - game.startedAt > 10 * 60 * 1000) {
    tebakGames.delete(chatId);
    return null;
  }
  return game;
}

export function guessTebakGame(chatId, guessNumber) {
  const game = getTebakGame(chatId);
  if (!game) return null;

  const guess = Number(guessNumber);
  if (isNaN(guess) || guess < 1 || guess > 100) {
    throw new Error('Tebakan harus berupa angka bulat antara 1 sampai 100');
  }

  game.attemptsLeft -= 1;

  if (guess === game.target) {
    tebakGames.delete(chatId);
    return {
      status: 'win',
      target: game.target,
      guess,
      attemptsLeft: game.attemptsLeft,
      maxAttempts: game.maxAttempts,
    };
  }

  if (game.attemptsLeft <= 0) {
    const target = game.target;
    tebakGames.delete(chatId);
    return {
      status: 'game_over',
      target,
      guess,
      attemptsLeft: 0,
      maxAttempts: game.maxAttempts,
    };
  }

  return {
    status: guess > game.target ? 'too_high' : 'too_low',
    target: game.target,
    guess,
    attemptsLeft: game.attemptsLeft,
    maxAttempts: game.maxAttempts,
  };
}

export function cancelTebakGame(chatId) {
  return tebakGames.delete(chatId);
}

// --- Quiz Bank (data/quiz.json) ----------------------------------------------

let cachedQuiz = null;

export function loadQuizBank(filePath = path.resolve('data', 'quiz.json')) {
  if (cachedQuiz && filePath === path.resolve('data', 'quiz.json')) {
    return cachedQuiz;
  }
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      cachedQuiz = JSON.parse(raw);
      return cachedQuiz;
    }
  } catch (err) {
    console.error('Gagal memuat bank soal quiz:', err.message);
  }
  return [];
}

export function getQuizQuestion(id, questions = loadQuizBank()) {
  const numId = Number(id);
  return questions.find((q) => q.id === numId) ?? null;
}

export function getRandomQuizQuestion(questions = loadQuizBank()) {
  if (!questions || questions.length === 0) return null;
  const idx = Math.floor(Math.random() * questions.length);
  return questions[idx];
}

export function checkQuizAnswer(questionId, selectedIndex, questions = loadQuizBank()) {
  const q = getQuizQuestion(questionId, questions);
  if (!q) return null;

  const isCorrect = Number(selectedIndex) === q.answer;
  return {
    correct: isCorrect,
    correctIndex: q.answer,
    correctText: q.options[q.answer],
    explanation: q.explanation ?? '',
    question: q,
  };
}

// --- Skor & Papan Peringkat (game_scores) -------------------------------------

export function recordGameResult({ userId, chatId, result, db = getDb() }) {
  if (!userId || !chatId) return null;

  let wins = 0;
  let losses = 0;
  let draws = 0;
  let points = 0;

  if (result === 'win') {
    wins = 1;
    points = 3;
  } else if (result === 'draw') {
    draws = 1;
    points = 1;
  } else if (result === 'loss') {
    losses = 1;
    points = 0;
  }

  const now = Date.now();
  db.prepare(`
    INSERT INTO game_scores (user_id, chat_id, wins, losses, draws, points, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, chat_id) DO UPDATE SET
      wins = wins + excluded.wins,
      losses = losses + excluded.losses,
      draws = draws + excluded.draws,
      points = points + excluded.points,
      updated_at = excluded.updated_at
  `).run(userId, chatId, wins, losses, draws, points, now);

  return getUserScore(userId, chatId, db);
}

export function getUserScore(userId, chatId, db = getDb()) {
  const row = db
    .prepare('SELECT * FROM game_scores WHERE user_id = ? AND chat_id = ?')
    .get(userId, chatId);

  if (row) return row;

  return {
    user_id: userId,
    chat_id: chatId,
    wins: 0,
    losses: 0,
    draws: 0,
    points: 0,
    updated_at: 0,
  };
}

export function getChatLeaderboard(chatId, limit = 10, db = getDb()) {
  return db
    .prepare(
      `SELECT g.*, COALESCE(u.first_name, 'Pemain') as first_name, u.username
       FROM game_scores g
       LEFT JOIN users u ON g.user_id = u.id
       WHERE g.chat_id = ?
       ORDER BY g.points DESC, g.wins DESC
       LIMIT ?`,
    )
    .all(chatId, limit);
}

