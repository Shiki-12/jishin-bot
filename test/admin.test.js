import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  logAdminAction,
  banUser,
  unbanUser,
  isUserBanned,
  listBannedUsers,
  getBotState,
  setBotState,
  isMaintenanceMode,
  setMaintenanceMode,
  getActiveModel,
  setActiveModel,
  getAdminStats,
  createPendingBroadcast,
  getPendingBroadcast,
  deletePendingBroadcast,
  executeBroadcast,
} from '../src/core/admin.js';
import adminFeature from '../src/features/admin.js';
import { getDb } from '../src/core/db.js';

test('F-60: Perintah Admin (Stats, Ban/Unban, Broadcast, Model & Maintenance)', async (t) => {
  const db = getDb();
  const testAdminId = 9990001;
  process.env.ADMIN_IDS = `${testAdminId},12345`;

  await t.test('Pencatatan Tindakan ke Tabel admin_log', () => {
    logAdminAction({
      adminId: testAdminId,
      action: 'test_action',
      details: 'Rincian aksi testing',
    });

    const logRow = db
      .prepare('SELECT * FROM admin_log WHERE admin_id = ? AND action = ?')
      .get(testAdminId, 'test_action');

    assert.ok(logRow);
    assert.equal(logRow.action, 'test_action');
    assert.equal(logRow.details, 'Rincian aksi testing');
  });

  await t.test('Fitur Ban dan Unban User (banned_users)', () => {
    const targetUserId = 7771234;
    db.prepare('DELETE FROM banned_users WHERE user_id = ?').run(targetUserId);

    assert.equal(isUserBanned(targetUserId), false);

    // Ban user biasa
    banUser({
      userId: targetUserId,
      reason: 'Spamming bot di grup',
      adminId: testAdminId,
    });

    assert.equal(isUserBanned(targetUserId), true);
    const bannedList = listBannedUsers();
    assert.ok(bannedList.some((u) => u.user_id === targetUserId));

    // Tolak ban sesama admin
    assert.throws(
      () => banUser({ userId: testAdminId, adminId: testAdminId }),
      /CANNOT_BAN_ADMIN/,
    );

    // Unban user
    const unbanned = unbanUser({ userId: targetUserId, adminId: testAdminId });
    assert.equal(unbanned, true);
    assert.equal(isUserBanned(targetUserId), false);

    // Unban user yang tidak diban -> return false
    const unbannedAgain = unbanUser({ userId: targetUserId, adminId: testAdminId });
    assert.equal(unbannedAgain, false);
  });

  await t.test('Konfigurasi Dinamis Bot (bot_state, Maintenance & Model)', () => {
    // 1. Bot state key-value
    setBotState('test_key', 'test_value');
    assert.equal(getBotState('test_key'), 'test_value');

    // 2. Mode maintenance
    setMaintenanceMode(true, testAdminId);
    assert.equal(isMaintenanceMode(), true);

    setMaintenanceMode(false, testAdminId);
    assert.equal(isMaintenanceMode(), false);

    // 3. Model LLM aktif dinamis
    const currentModel = getActiveModel();
    assert.ok(currentModel);

    const newModelName = 'openai/gpt-4o-mini-test';
    setActiveModel(newModelName, testAdminId);
    assert.equal(getActiveModel(), newModelName);

    // Tolak nama model kosong
    assert.throws(() => setActiveModel('   ', testAdminId), /MODEL_NAME_EMPTY/);

    // Kembalikan ke default
    setBotState('active_model', '');
  });

  await t.test('Statistik Operasional (getAdminStats)', () => {
    const stats = getAdminStats();
    assert.equal(typeof stats.totalUsers, 'number');
    assert.equal(typeof stats.totalChats, 'number');
    assert.equal(typeof stats.activeUsersToday, 'number');
    assert.equal(typeof stats.messagesToday, 'number');
    assert.equal(typeof stats.pendingReminders, 'number');
    assert.equal(typeof stats.bannedCount, 'number');
    assert.ok(stats.activeModel);
    assert.equal(typeof stats.isMaintenance, 'boolean');
  });

  await t.test('Alur Broadcast Pesan (Pending & Execute)', async () => {
    const bcId = createPendingBroadcast({
      adminId: testAdminId,
      text: 'Pengumuman penting pembaruan sistem!',
      targetCount: 10,
    });

    const pending = getPendingBroadcast(bcId);
    assert.ok(pending);
    assert.equal(pending.adminId, testAdminId);
    assert.equal(pending.text, 'Pengumuman penting pembaruan sistem!');

    deletePendingBroadcast(bcId);
    assert.equal(getPendingBroadcast(bcId), null);

    // Uji executeBroadcast dengan mock
    const targetUserId = 8889991;
    db.prepare(
      `INSERT INTO users (id, first_name, username, created_at)
       VALUES (?, 'Tester', 'test_user', ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(targetUserId, Date.now());

    let sentMessage = null;
    let sentToUser = null;
    const mockBot = {
      api: {
        sendMessage: async (chatId, text) => {
          sentToUser = chatId;
          sentMessage = text;
        },
      },
    };

    const res = await executeBroadcast({
      bot: mockBot,
      text: 'Halo semua pengguna!',
      delayMs: 1,
    });

    assert.ok(res.total >= 1);
    assert.ok(res.successCount >= 1);
  });

  await t.test('Proteksi Non-Admin pada Semua Perintah Admin', async () => {
    const nonAdminCtx = {
      from: { id: 111222333 }, // Bukan admin
      chat: { id: 111222333, type: 'private' },
      message: { text: '/stats' },
      reply: async (msg) => msg,
    };

    for (const cmd of adminFeature.commands) {
      assert.equal(cmd.adminOnly, true, `Perintah /${cmd.name} harus memiliki flag adminOnly: true`);
      let replyCalled = false;
      nonAdminCtx.reply = async () => {
        replyCalled = true;
      };
      await cmd.handler(nonAdminCtx);
      assert.equal(replyCalled, false, `Perintah /${cmd.name} harus diam (tidak membalas) untuk non-admin`);
    }
  });

  await t.test('Eksekusi Perintah /stats, /ban, /unban, /model, /maintenance oleh Admin', async () => {
    const adminCtx = {
      from: { id: testAdminId },
      chat: { id: testAdminId, type: 'private' },
      message: { text: '/stats' },
      reply: async () => {},
    };

    // 1. /stats
    let statsMsg = '';
    adminCtx.reply = async (msg) => {
      statsMsg = msg;
    };
    const statsCmd = adminFeature.commands.find((c) => c.name === 'stats');
    await statsCmd.handler(adminCtx);
    assert.match(statsMsg, /Statistik Operasional Bot/);
    assert.match(statsMsg, /Total Pengguna/);

    // 2. /ban
    const banCmd = adminFeature.commands.find((c) => c.name === 'ban');
    let banReply = '';
    adminCtx.reply = async (msg) => {
      banReply = msg;
    };

    adminCtx.message.text = '/ban 55566677 spammer grup';
    await banCmd.handler(adminCtx);
    assert.match(banReply, /Berhasil Diblokir/);
    assert.equal(isUserBanned(55566677), true);

    // 3. /unban
    const unbanCmd = adminFeature.commands.find((c) => c.name === 'unban');
    let unbanReply = '';
    adminCtx.reply = async (msg) => {
      unbanReply = msg;
    };

    adminCtx.message.text = '/unban 55566677';
    await unbanCmd.handler(adminCtx);
    assert.match(unbanReply, /Berhasil Dibuka Blokirnya/);
    assert.equal(isUserBanned(55566677), false);

    // 4. /model
    const modelCmd = adminFeature.commands.find((c) => c.name === 'model');
    let modelReply = '';
    adminCtx.reply = async (msg) => {
      modelReply = msg;
    };

    adminCtx.message.text = '/model';
    await modelCmd.handler(adminCtx);
    assert.match(modelReply, /Model LLM Saat Ini/);

    adminCtx.message.text = '/model mistralai/mistral-large-2512';
    await modelCmd.handler(adminCtx);
    assert.match(modelReply, /Berhasil Diganti/);

    // 5. /maintenance
    const maintCmd = adminFeature.commands.find((c) => c.name === 'maintenance');
    let maintReply = '';
    adminCtx.reply = async (msg) => {
      maintReply = msg;
    };

    adminCtx.message.text = '/maintenance on';
    await maintCmd.handler(adminCtx);
    assert.match(maintReply, /Diaktifkan/);
    assert.equal(isMaintenanceMode(), true);

    adminCtx.message.text = '/maintenance off';
    await maintCmd.handler(adminCtx);
    assert.match(maintReply, /Dimatikan/);
    assert.equal(isMaintenanceMode(), false);
  });

  await t.test('Perintah /broadcast dan Callback Konfirmasi', async () => {
    const bcCmd = adminFeature.commands.find((c) => c.name === 'broadcast');
    let previewMsg = '';
    let previewMarkup = null;

    const adminCtx = {
      from: { id: testAdminId },
      chat: { id: testAdminId, type: 'private' },
      message: { text: '/broadcast Pengumuman rilis v2.0!' },
      reply: async (msg, opts) => {
        previewMsg = msg;
        previewMarkup = opts?.reply_markup;
      },
    };

    await bcCmd.handler(adminCtx);
    assert.match(previewMsg, /Konfirmasi Siaran/);
    assert.match(previewMsg, /Pengumuman rilis v2\.0!/);
    assert.ok(previewMarkup);

    // Uji callback pembatalan
    const cancelCallback = adminFeature.callbacks.find((c) => c.prefix === 'adm:bc:cancel:');
    let cancelText = '';
    const cancelCtx = {
      from: { id: testAdminId },
      callbackQuery: { data: 'adm:bc:cancel:some_id' },
      answerCallbackQuery: async () => {},
      editMessageText: async (msg) => {
        cancelText = msg;
      },
    };
    await cancelCallback.handler(cancelCtx);
    assert.match(cancelText, /dibatalkan/i);
  });
});
