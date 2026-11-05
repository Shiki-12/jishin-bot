import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  isGroupAdmin,
  getGroupSettings,
  setGroupSetting,
  recordGroupMessage,
  getGroupMessages,
  shouldChattyTrigger,
  buildGroupSummarySystemPrompt,
  summarizeGroupMessages,
  MAX_GROUP_BUFFER,
} from '../src/core/groups.js';
import groupsFeature from '../src/features/groups.js';
import { getPersonality } from '../src/personalities/index.js';
import { processPendingReminders } from '../src/core/scheduler.js';
import { getDb } from '../src/core/db.js';

test('F-50: Fitur Grup (Group Management, Rangkum, Chatty & Welcome)', async (t) => {
  const db = getDb();

  await t.test('Pengaturan Grup (getGroupSettings & setGroupSetting)', () => {
    const groupId = -100123456789;
    db.prepare('DELETE FROM group_settings WHERE chat_id = ?').run(groupId);

    // Default settings
    const initial = getGroupSettings(groupId);
    assert.equal(initial.chatty, 0);
    assert.equal(initial.welcome_enabled, 1);
    assert.equal(initial.chatty_prob, 0.05);

    // Update settings
    setGroupSetting(groupId, { chatty: 1, chatty_prob: 0.1 });
    const updated = getGroupSettings(groupId);
    assert.equal(updated.chatty, 1);
    assert.equal(updated.chatty_prob, 0.1);

    // Toggle welcome off
    setGroupSetting(groupId, { welcome_enabled: 0 });
    const afterWelcome = getGroupSettings(groupId);
    assert.equal(afterWelcome.welcome_enabled, 0);

    // Kembalikan ke default
    setGroupSetting(groupId, { chatty: 0, welcome_enabled: 1 });
  });

  await t.test('Penyangga Pesan Grup & Auto-Prune (Maksimal 200 Pesan)', () => {
    const groupId = -100987654321;
    db.prepare('DELETE FROM group_messages WHERE chat_id = ?').run(groupId);

    // Catat pesan bertahap
    recordGroupMessage({
      chatId: groupId,
      userId: 101,
      senderName: 'Andi',
      text: 'Pesan pertama',
    });
    recordGroupMessage({
      chatId: groupId,
      userId: 102,
      senderName: 'Budi',
      text: 'Pesan kedua',
    });

    const msgs = getGroupMessages(groupId, 10);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].sender_name, 'Andi');
    assert.equal(msgs[0].text, 'Pesan pertama');
    assert.equal(msgs[1].sender_name, 'Budi');
    assert.equal(msgs[1].text, 'Pesan kedua');

    // Catat lebih dari 200 pesan untuk memastikan auto-pruning bekerja
    for (let i = 3; i <= 215; i++) {
      recordGroupMessage({
        chatId: groupId,
        userId: 100 + (i % 5),
        senderName: `User${i}`,
        text: `Pesan nomor ${i}`,
      });
    }

    const allMsgs = getGroupMessages(groupId, 250);
    assert.equal(allMsgs.length, MAX_GROUP_BUFFER);
    // Pesan 1 dan 2 sudah terpangkas, pesan terbaru (215) ada di akhir
    assert.equal(allMsgs[allMsgs.length - 1].text, 'Pesan nomor 215');
  });

  await t.test('Logika Trigger Mode Chatty (Cooldown & Probabilitas)', () => {
    const groupId = -100555555555;
    const now = 1_700_000_000_000;

    // 1. Jika chatty mati (0) -> selalu false
    setGroupSetting(groupId, { chatty: 0 });
    assert.equal(shouldChattyTrigger(groupId, now), false);

    // 2. Jika chatty aktif (1) dan probabilitas 100%
    setGroupSetting(groupId, { chatty: 1, chatty_prob: 1.0, last_chatty_at: 0 });
    assert.equal(shouldChattyTrigger(groupId, now, 60_000), true);

    // 3. Masih dalam masa cooldown (misal 30 detik kemudian) -> false
    assert.equal(shouldChattyTrigger(groupId, now + 30_000, 60_000), false);

    // 4. Setelah cooldown lewat (misal 65 detik kemudian) -> true
    assert.equal(shouldChattyTrigger(groupId, now + 65_000, 60_000), true);

    // 5. Jika probabilitas 0% -> selalu false
    setGroupSetting(groupId, { chatty_prob: 0.0 });
    assert.equal(shouldChattyTrigger(groupId, now + 150_000, 60_000), false);
  });

  await t.test('Verifikasi Status Admin Grup (isGroupAdmin)', async () => {
    // 1. Private chat selalu dianggap admin
    const privateCtx = { chat: { type: 'private' }, from: { id: 123 } };
    assert.equal(await isGroupAdmin(privateCtx), true);

    // 2. Creator di grup
    const creatorCtx = {
      chat: { id: -1001, type: 'supergroup' },
      from: { id: 111 },
      getChatMember: async (id) => ({ status: 'creator' }),
    };
    assert.equal(await isGroupAdmin(creatorCtx), true);

    // 3. Administrator di grup
    const adminCtx = {
      chat: { id: -1001, type: 'group' },
      from: { id: 222 },
      getChatMember: async (id) => ({ status: 'administrator' }),
    };
    assert.equal(await isGroupAdmin(adminCtx), true);

    // 4. Regular member di grup
    const memberCtx = {
      chat: { id: -1001, type: 'group' },
      from: { id: 333 },
      getChatMember: async (id) => ({ status: 'member' }),
    };
    assert.equal(await isGroupAdmin(memberCtx), false);

    // 5. Error Telegram API -> return false
    const errorCtx = {
      chat: { id: -1001, type: 'group' },
      from: { id: 444 },
      getChatMember: async () => {
        throw new Error('API_ERROR');
      },
    };
    assert.equal(await isGroupAdmin(errorCtx), false);
  });

  await t.test('Perangkuman Pesan Grup (summarizeGroupMessages)', async () => {
    let capturedPrompt = '';
    let capturedTranscript = '';

    const mockGenerateReply = async ({ systemPrompt, userText }) => {
      capturedPrompt = systemPrompt;
      capturedTranscript = userText;
      return '- Poin 1: Tim menyetujui jadwal rilis.\n- Poin 2: Server maintenance dimulai jam 22:00.';
    };

    const messages = [
      { sender_name: 'Budi', text: 'Kapan kita rilis update baru?' },
      { sender_name: 'Siti', text: 'Jumat depan jam 10 pagi sudah siap.' },
      { sender_name: 'Andi', text: 'Oke sepakat, jangan lupa maintenance jam 22:00.' },
    ];

    const res = await summarizeGroupMessages({
      messages,
      generateReplyFn: mockGenerateReply,
    });

    assert.equal(res.messageCount, 3);
    assert.match(res.summaryText, /Poin 1/);
    assert.match(capturedPrompt, /executive group conversation summarizer/i);
    assert.match(capturedTranscript, /\[Budi\]: Kapan kita rilis update baru\?/);
    assert.match(capturedTranscript, /\[Siti\]: Jumat depan/);

    // Tolak jika pesan kosong
    await assert.rejects(
      summarizeGroupMessages({ messages: [], generateReplyFn: mockGenerateReply }),
      /NO_MESSAGES/,
    );
  });

  await t.test('Perintah /rangkum_grup', async () => {
    const cmd = groupsFeature.commands.find((c) => c.name === 'rangkum_grup');
    assert.ok(cmd);

    // 1. Ditolak jika di private chat
    let replyMsg = '';
    const privateCtx = {
      chat: { id: 123, type: 'private' },
      message: { text: '/rangkum_grup' },
      reply: async (msg) => {
        replyMsg = msg;
      },
    };
    await cmd.handler(privateCtx);
    assert.match(replyMsg, /khusus|hanya dapat digunakan di dalam grup/i);

    // 2. Diberi tahu jika pesan kurang dari 3
    const emptyGroupId = -1009990001;
    db.prepare('DELETE FROM group_messages WHERE chat_id = ?').run(emptyGroupId);
    let notEnoughMsg = '';
    const notEnoughCtx = {
      chat: { id: emptyGroupId, type: 'supergroup' },
      message: { text: '/rangkum_grup' },
      reply: async (msg) => {
        notEnoughMsg = msg;
      },
    };
    await cmd.handler(notEnoughCtx);
    assert.match(notEnoughMsg, /Belum cukup riwayat pesan/);

    // 3. Berhasil merangkum jika pesan cukup
    const activeGroupId = -1009990002;
    db.prepare('DELETE FROM group_messages WHERE chat_id = ?').run(activeGroupId);
    for (let i = 1; i <= 5; i++) {
      recordGroupMessage({
        chatId: activeGroupId,
        userId: 10 + i,
        senderName: `Member${i}`,
        text: `Topik pembahasan ${i}`,
      });
    }

    let successMsg = '';
    const successCtx = {
      chat: { id: activeGroupId, type: 'supergroup' },
      message: { text: '/rangkum_grup 5' },
      replyWithChatAction: async () => {},
      summarizeGroupMessagesFn: async ({ messages }) => ({
        summaryText: '- Poin 1: Kesimpulan rapat.\n- Poin 2: Aksi tindak lanjut.',
        messageCount: messages.length,
      }),
      reply: async (msg) => {
        successMsg = msg;
      },
    };
    await cmd.handler(successCtx);
    assert.match(successMsg, /Ringkasan/i);
  });

  await t.test('Perintah /chatty dan /welcome (Khusus Admin)', async () => {
    const chattyCmd = groupsFeature.commands.find((c) => c.name === 'chatty');
    const welcomeCmd = groupsFeature.commands.find((c) => c.name === 'welcome');
    const groupId = -1008888888;

    // 1. Ditolak jika bukan admin
    let rejectedMsg = '';
    const nonAdminCtx = {
      chat: { id: groupId, type: 'supergroup' },
      from: { id: 555 },
      message: { text: '/chatty on' },
      getChatMember: async () => ({ status: 'member' }),
      reply: async (msg) => {
        rejectedMsg = msg;
      },
    };
    await chattyCmd.handler(nonAdminCtx);
    assert.match(rejectedMsg, /admin/i);

    // 2. Berhasil jika admin mengaktifkan /chatty on
    let adminChattyMsg = '';
    const adminCtx = {
      chat: { id: groupId, type: 'supergroup' },
      from: { id: 111 },
      message: { text: '/chatty on' },
      getChatMember: async () => ({ status: 'administrator' }),
      reply: async (msg) => {
        adminChattyMsg = msg;
      },
    };
    await chattyCmd.handler(adminCtx);
    assert.match(adminChattyMsg, /diaktifkan/i);
    assert.equal(getGroupSettings(groupId).chatty, 1);

    // 3. Admin mematikan /chatty off
    adminCtx.message.text = '/chatty off';
    await chattyCmd.handler(adminCtx);
    assert.equal(getGroupSettings(groupId).chatty, 0);

    // 4. Admin mengatur /welcome on dan /welcome off
    adminCtx.message.text = '/welcome off';
    await welcomeCmd.handler(adminCtx);
    assert.equal(getGroupSettings(groupId).welcome_enabled, 0);

    adminCtx.message.text = '/welcome on';
    await welcomeCmd.handler(adminCtx);
    assert.equal(getGroupSettings(groupId).welcome_enabled, 1);
  });

  await t.test('Event message:new_chat_members Menyapa Anggota Baru', async () => {
    const groupId = -1007777777;
    let eventHandler = null;

    const mockBot = {
      on: (event, handler) => {
        if (event === 'message:new_chat_members') {
          eventHandler = handler;
        }
      },
    };

    await groupsFeature.init({ bot: mockBot });
    assert.ok(eventHandler, 'Handler new_chat_members harus terdaftar');

    // 1. Bot sendiri bergabung -> kirim petunjuk grup & privasi
    let botIntroMsg = '';
    const botJoinCtx = {
      chat: { id: groupId, type: 'supergroup', title: 'Komunitas Bot' },
      me: { id: 9999, username: 'mikabot' },
      message: { new_chat_members: [{ id: 9999, first_name: 'Mika' }] },
      reply: async (msg) => {
        botIntroMsg = msg;
      },
    };
    await eventHandler(botJoinCtx);
    assert.match(botIntroMsg, /Group Privacy|rangkum_grup|200 pesan/i);

    // 2. Member manusia bergabung saat welcome aktif -> sapaan ramah
    setGroupSetting(groupId, { welcome_enabled: 1 });
    let memberWelcomeMsg = '';
    const memberJoinCtx = {
      chat: { id: groupId, type: 'supergroup', title: 'Komunitas Bot' },
      me: { id: 9999, username: 'mikabot' },
      message: { new_chat_members: [{ id: 101, first_name: 'Doni' }] },
      reply: async (msg) => {
        memberWelcomeMsg = msg;
      },
    };
    await eventHandler(memberJoinCtx);
    assert.match(memberWelcomeMsg, /Doni/);
    assert.match(memberWelcomeMsg, /Komunitas Bot/);

    // 3. Member manusia bergabung saat welcome dimatikan -> tidak ada sapaan
    setGroupSetting(groupId, { welcome_enabled: 0 });
    let silentMsg = '';
    const silentCtx = {
      chat: { id: groupId, type: 'supergroup', title: 'Komunitas Bot' },
      me: { id: 9999, username: 'mikabot' },
      message: { new_chat_members: [{ id: 102, first_name: 'Eka' }] },
      reply: async (msg) => {
        silentMsg = msg;
      },
    };
    await eventHandler(silentCtx);
    assert.equal(silentMsg, '');
  });

  await t.test('Pengingat Grup Menyebut Nama Pembuat Pengingat', async () => {
    const groupId = -100444333;
    const userId = 888123;
    const now = Date.now();

    const db = (await import('../src/core/db.js')).getDb();

    // Catat user
    db.prepare(
      `INSERT INTO users (id, first_name, username, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name`,
    ).run(userId, 'Rian', 'rian_dev', now);

    // Buat pengingat di grup
    const info = db.prepare(
      `INSERT INTO reminders (chat_id, user_id, text, due_at, tz, repeat, status, created_at, snooze_count)
       VALUES (?, ?, ?, ?, 'Asia/Jakarta', 'none', 'pending', ?, 0)`,
    ).run(groupId, userId, 'Rapat evaluasi mingguan', now - 1000, now);

    let sentChatId = null;
    let sentText = '';
    const mockBot = {
      api: {
        sendMessage: async (chatId, text) => {
          sentChatId = chatId;
          sentText = text;
        },
      },
    };

    await processPendingReminders(mockBot, now);

    assert.equal(sentChatId, groupId);
    assert.match(sentText, /Pengingat untuk \[Rian\]\(tg:\/\/user\?id=888123\)/);
    assert.match(sentText, /Rapat evaluasi mingguan/);
  });

  await t.test('Persona Strings Memiliki String Grup Lengkap', () => {
    const personas = ['tsundere', 'kalem', 'ceria', 'sarkas'];
    for (const pId of personas) {
      const p = getPersonality(pId);
      assert.ok(p.strings.groupWelcome, `groupWelcome missing on ${pId}`);
      assert.ok(p.strings.groupSummaryIntro, `groupSummaryIntro missing on ${pId}`);
      assert.ok(p.strings.chattyEnabled, `chattyEnabled missing on ${pId}`);
      assert.ok(p.strings.chattyDisabled, `chattyDisabled missing on ${pId}`);
      assert.ok(p.strings.welcomeEnabled, `welcomeEnabled missing on ${pId}`);
      assert.ok(p.strings.welcomeDisabled, `welcomeDisabled missing on ${pId}`);
      assert.ok(p.strings.notGroupAdmin, `notGroupAdmin missing on ${pId}`);
      assert.ok(p.strings.notGroupChat, `notGroupChat missing on ${pId}`);
    }
  });
});
