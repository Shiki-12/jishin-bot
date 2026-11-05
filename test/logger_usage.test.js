import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  logger,
  sanitize,
  formatLog,
  getActiveLogLevel,
} from '../src/core/logger.js';
import {
  recordUsage,
  getUsageStats,
  getUserUsageToday,
  checkAndAlertTokenLimit,
  getTodayDateStr,
} from '../src/core/usage.js';
import { getAdminStats } from '../src/core/admin.js';
import adminFeature from '../src/features/admin.js';
import { getDb } from '../src/core/db.js';

test('F-64: Logging dan Pemakaian Token', async (t) => {
  const db = getDb();
  const testUserId = 7788991;

  // Bersihkan data usage user test
  db.prepare('DELETE FROM usage WHERE user_id = ?').run(testUserId);

  await t.test('Logger: Penyaringan Data Sensitif (sanitize)', () => {
    // 1. String dengan Bearer token
    const rawStr = 'Authorization: Bearer secret_token_1234567890';
    const cleanStr = sanitize(rawStr);
    assert.equal(cleanStr, 'Authorization: Bearer ***');

    // 2. Objek dengan kunci sensitif
    const rawObj = {
      user: 'Budi',
      api_key: 'my_secret_key_123',
      telegram_token: 'bot_token_abc',
      password: 'password123',
      normal_data: 'Halo dunia',
      nested: {
        secret_code: 'top_secret',
        status: 'active',
      },
    };

    const cleanObj = sanitize(rawObj);
    assert.equal(cleanObj.user, 'Budi');
    assert.equal(cleanObj.api_key, '***');
    assert.equal(cleanObj.telegram_token, '***');
    assert.equal(cleanObj.password, '***');
    assert.equal(cleanObj.normal_data, 'Halo dunia');
    assert.equal(cleanObj.nested.secret_code, '***');
    assert.equal(cleanObj.nested.status, 'active');
  });

  await t.test('Logger: Format Log Satu Baris (formatLog)', () => {
    const line = formatLog('INFO', 'User login berhasil', { userId: 12345 });
    assert.match(line, /^\[\d{4}-\d{2}-\d{2}T.*\] \[INFO\] User login berhasil {"userId":12345}$/);
  });

  await t.test('Logger: Level Filtering (getActiveLogLevel)', () => {
    process.env.LOG_LEVEL = 'debug';
    assert.equal(getActiveLogLevel(), 0);

    process.env.LOG_LEVEL = 'info';
    assert.equal(getActiveLogLevel(), 1);

    process.env.LOG_LEVEL = 'warn';
    assert.equal(getActiveLogLevel(), 2);

    process.env.LOG_LEVEL = 'error';
    assert.equal(getActiveLogLevel(), 3);

    process.env.LOG_LEVEL = 'none';
    assert.equal(getActiveLogLevel(), 4);

    // Kembalikan ke info
    process.env.LOG_LEVEL = 'info';
  });

  await t.test('Pencatatan Pemakaian Token (recordUsage & getUserUsageToday)', () => {
    const today = getTodayDateStr();

    // 1. Catat panggilan pertama
    const res1 = recordUsage({
      userId: testUserId,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      latencyMs: 320,
      model: 'mistralai/mistral-large-2512',
      dateStr: today,
    });

    assert.equal(res1.userId, testUserId);
    assert.equal(res1.totalTokens, 150);
    assert.equal(res1.userTotalToday, 150);
    assert.equal(res1.latencyMs, 320);

    // 2. Catat panggilan kedua
    const res2 = recordUsage({
      userId: testUserId,
      promptTokens: 200,
      completionTokens: 80,
      totalTokens: 280,
      latencyMs: 410,
      model: 'qwen/qwen3.7-flash:free',
      dateStr: today,
    });

    assert.equal(res2.userTotalToday, 430);

    // 3. Ambil total user hari ini
    const userToday = getUserUsageToday(testUserId, today);
    assert.equal(userToday.calls, 2);
    assert.equal(userToday.promptTokens, 300);
    assert.equal(userToday.completionTokens, 130);
    assert.equal(userToday.totalTokens, 430);
  });

  await t.test('Statistik Agregat Token (getUsageStats)', () => {
    const today = getTodayDateStr();
    const stats = getUsageStats(today);

    assert.ok(stats.totalCalls >= 2);
    assert.ok(stats.totalTokens >= 430);
    assert.ok(stats.avgLatencyMs > 0);
    assert.ok(Array.isArray(stats.models));
    assert.ok(stats.models.some((m) => m.model === 'mistralai/mistral-large-2512'));
  });

  await t.test('Peringatan Limit Harian Token ke Admin (checkAndAlertTokenLimit)', async () => {
    const adminId = 9991118;
    process.env.ADMIN_IDS = `${adminId}`;

    let sentAlert = null;
    let sentTo = null;
    const mockBot = {
      api: {
        sendMessage: async (chatId, text) => {
          sentTo = chatId;
          sentAlert = text;
        },
      },
    };

    // 1. Belum melewati batas -> tidak ada alert
    await checkAndAlertTokenLimit({
      bot: mockBot,
      userId: testUserId,
      userTotalToday: 450,
      limit: 1000,
    });
    assert.equal(sentAlert, null);

    // 2. Melewati batas limit -> alert dikirim ke admin
    await checkAndAlertTokenLimit({
      bot: mockBot,
      userId: testUserId,
      userTotalToday: 1200,
      limit: 1000,
    });

    assert.equal(sentTo, adminId);
    assert.match(sentAlert, /Peringatan Kuota Token LLM/);
    assert.match(sentAlert, new RegExp(String(testUserId)));

    // 3. Panggilan berikutnya di hari yang sama tidak mengirim alert dobel
    sentAlert = null;
    await checkAndAlertTokenLimit({
      bot: mockBot,
      userId: testUserId,
      userTotalToday: 1500,
      limit: 1000,
    });
    assert.equal(sentAlert, null);
  });

  await t.test('Integrasi /stats Menampilkan Rincian Token & Latensi', async () => {
    const adminId = 9991118;
    const adminStats = getAdminStats();

    assert.equal(typeof adminStats.tokensToday, 'number');
    assert.equal(typeof adminStats.promptTokensToday, 'number');
    assert.equal(typeof adminStats.completionTokensToday, 'number');
    assert.equal(typeof adminStats.avgLatencyMs, 'number');
    assert.ok(Array.isArray(adminStats.usageByModel));

    let statsReply = '';
    const statsCtx = {
      from: { id: adminId },
      chat: { id: adminId, type: 'private' },
      message: { text: '/stats' },
      reply: async (msg) => {
        statsReply = msg;
      },
    };

    const statsCmd = adminFeature.commands.find((c) => c.name === 'stats');
    await statsCmd.handler(statsCtx);

    assert.match(statsReply, /Pemakaian Token & Kinerja LLM/);
    assert.match(statsReply, /Total Token:/);
    assert.match(statsReply, /Rata-rata Latensi:/);
  });
});

