import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  loadFeatures,
  registerFeatures,
  syncBotCommands,
  ensureAdminCommands,
  registeredAdminChats,
} from '../src/core/loader.js';
import coreFeature from '../src/features/core.js';
import adminFeature from '../src/features/admin.js';

describe('Feature Loader & Core Module (F-00)', () => {
  it('harus memuat modul core dari src/features', async () => {
    const features = await loadFeatures({
      dir: path.resolve('src', 'features'),
      enabledFeatures: 'all',
    });

    const core = features.find((f) => f.id === 'core');
    assert.ok(core, 'Fitur core harus terdaftar');
    assert.equal(typeof core.init, 'function');
    assert.ok(Array.isArray(core.commands));
    assert.equal(core.commands.length, 4); // start, forget, about, help
  });

  it('fitur core tetap dimuat walau FEATURES diatur hanya untuk fitur lain', async () => {
    const features = await loadFeatures({
      dir: path.resolve('src', 'features'),
      enabledFeatures: 'reminders,todo',
    });

    const core = features.find((f) => f.id === 'core');
    assert.ok(core, 'Fitur core wajib selalu dimuat sebagai dasar bot');
  });

  it('mendaftarkan commands ke instance bot mock', async () => {
    const registeredCommands = new Map();
    const mockBot = {
      command: (name, handler) => {
        registeredCommands.set(name, handler);
      },
    };

    const dummyPersona = {
      id: 'tsundere',
      name: 'Mika',
      greeting: 'Halo dari Mika!',
      errorMessage: 'Error dari Mika!',
      strings: {
        helpHeader: 'Header Bantuan Mika',
        helpFooter: 'Footer Bantuan Mika',
        forgetSuccess: 'Lupa sukses!',
      },
    };

    const { allCommands } = await registerFeatures({
      bot: mockBot,
      features: [coreFeature],
      context: { persona: dummyPersona },
    });

    assert.equal(allCommands.length, 4);
    assert.ok(registeredCommands.has('start'));
    assert.ok(registeredCommands.has('forget'));
    assert.ok(registeredCommands.has('about'));
    assert.ok(registeredCommands.has('help'));
  });

  it('perintah /help menghasilkan daftar seluruh perintah aktif dengan teks persona', async () => {
    let capturedReply = null;
    const mockBot = {
      command: (name, handler) => {
        if (name === 'help') helpHandler = handler;
      },
    };
    let helpHandler = null;

    const dummyPersona = {
      id: 'tsundere',
      name: 'Mika',
      greeting: 'Halo!',
      errorMessage: 'Error!',
      strings: {
        helpHeader: 'Header Khusus Persona',
        helpFooter: 'Footer Khusus Persona',
      },
    };

    await registerFeatures({
      bot: mockBot,
      features: [coreFeature],
      context: { persona: dummyPersona },
    });

    assert.ok(helpHandler, 'Handler /help harus terdaftar');

    const fakeCtx = {
      persona: dummyPersona,
      reply: async (text) => {
        capturedReply = text;
      },
    };

    await helpHandler(fakeCtx);

    assert.ok(capturedReply, 'Pesan /help harus terkirim');
    assert.ok(capturedReply.includes('Header Khusus Persona'));
    assert.ok(capturedReply.includes('/start'));
    assert.ok(capturedReply.includes('/forget'));
    assert.ok(capturedReply.includes('/about'));
    assert.ok(capturedReply.includes('/help'));
    assert.ok(capturedReply.includes('Footer Khusus Persona'));
  });

  it('perintah /start membalas sapaan persona', async () => {
    let startHandler = null;
    let capturedReply = null;

    const mockBot = {
      command: (name, handler) => {
        if (name === 'start') startHandler = handler;
      },
    };

    const dummyPersona = {
      id: 'tsundere',
      name: 'Mika',
      greeting: 'Sapaan khas Mika',
      errorMessage: 'Error',
      strings: {},
    };

    await registerFeatures({
      bot: mockBot,
      features: [coreFeature],
      context: { persona: dummyPersona },
    });

    await startHandler({
      persona: dummyPersona,
      reply: async (text) => {
        capturedReply = text;
      },
    });

    assert.equal(capturedReply, 'Sapaan khas Mika');
  });

  it('syncBotCommands: scope default hanya memuat perintah publik dan scope admin memuat publik + admin', async () => {
    const calls = [];
    const mockBot = {
      api: {
        setMyCommands: async (cmds, opts) => {
          calls.push({ cmds, opts });
        },
      },
    };

    const commands = [
      { name: 'start', description: 'Mulai', adminOnly: false },
      { name: 'help', description: 'Bantuan', adminOnly: false },
      { name: 'stats', description: 'Statistik admin', adminOnly: true },
      { name: 'ban', description: 'Ban user', adminOnly: true },
    ];

    const adminId = 998811;
    await syncBotCommands({ bot: mockBot, commands, adminIds: [adminId] });

    assert.equal(calls.length, 2);

    // Panggilan 1: scope default hanya berisi perintah publik
    assert.deepEqual(calls[0].cmds, [
      { command: 'start', description: 'Mulai' },
      { command: 'help', description: 'Bantuan' },
    ]);
    assert.equal(calls[0].opts, undefined);

    // Panggilan 2: scope chat admin berisi publik + admin
    assert.deepEqual(calls[1].cmds, [
      { command: 'start', description: 'Mulai' },
      { command: 'help', description: 'Bantuan' },
      { command: 'stats', description: 'Statistik admin' },
      { command: 'ban', description: 'Ban user' },
    ]);
    assert.deepEqual(calls[1].opts, {
      scope: { type: 'chat', chat_id: adminId },
    });
  });

  it('syncBotCommands: menangani error jika admin belum pernah chat tanpa crash', async () => {
    const mockBot = {
      api: {
        setMyCommands: async (cmds, opts) => {
          if (opts?.scope?.type === 'chat') {
            throw new Error('400: Bad Request: chat not found');
          }
        },
      },
    };

    const commands = [
      { name: 'start', description: 'Mulai' },
      { name: 'stats', description: 'Statistik', adminOnly: true },
    ];

    // Tidak boleh melempar error / crash
    await syncBotCommands({ bot: mockBot, commands, adminIds: [12345678] });
  });

  it('ensureAdminCommands: mendaftarkan menu saat admin chat dan tidak mengulang panggilan', async () => {
    const calls = [];
    const adminId = 554433;
    registeredAdminChats.delete(adminId);

    const mockBot = {
      api: {
        setMyCommands: async (cmds, opts) => {
          calls.push({ cmds, opts });
        },
      },
    };

    const commands = [
      { name: 'start', description: 'Mulai' },
      { name: 'stats', description: 'Statistik', adminOnly: true },
    ];

    // Non-admin: diabaikan
    await ensureAdminCommands({
      bot: mockBot,
      userId: 999999,
      commands,
      adminIds: [adminId],
    });
    assert.equal(calls.length, 0);

    // Admin pertama kali: didaftarkan
    await ensureAdminCommands({
      bot: mockBot,
      userId: adminId,
      commands,
      adminIds: [adminId],
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].opts, {
      scope: { type: 'chat', chat_id: adminId },
    });

    // Admin kedua kali: tidak memanggil lagi karena sudah terdaftar di memori
    await ensureAdminCommands({
      bot: mockBot,
      userId: adminId,
      commands,
      adminIds: [adminId],
    });
    assert.equal(calls.length, 1);
  });

  it('/help: menyembunyikan perintah admin untuk non-admin dan menampilkannya untuk admin', async () => {
    const mockBot = {
      command: (name, handler) => {
        if (name === 'help') helpHandler = handler;
      },
    };
    let helpHandler = null;

    const dummyPersona = {
      id: 'tsundere',
      name: 'Mika',
      greeting: 'Halo!',
      errorMessage: 'Error!',
      strings: {
        helpHeader: 'Daftar Perintah:',
      },
    };

    const testAdminId = 887766;
    process.env.ADMIN_IDS = String(testAdminId);

    await registerFeatures({
      bot: mockBot,
      features: [coreFeature, adminFeature],
      context: { persona: dummyPersona },
    });

    // 1. Uji untuk non-admin
    let nonAdminReply = '';
    await helpHandler({
      from: { id: 112233 }, // Non-admin
      persona: dummyPersona,
      reply: async (text) => {
        nonAdminReply = text;
      },
    });

    assert.ok(nonAdminReply.includes('/start'));
    assert.ok(!nonAdminReply.includes('Khusus admin'));
    assert.ok(!nonAdminReply.includes('/stats'));
    assert.ok(!nonAdminReply.includes('/ban'));
    assert.ok(!nonAdminReply.includes('/broadcast'));

    // 2. Uji untuk admin
    let adminReply = '';
    await helpHandler({
      from: { id: testAdminId }, // Admin
      persona: dummyPersona,
      reply: async (text) => {
        adminReply = text;
      },
    });

    assert.ok(adminReply.includes('/start'));
    assert.ok(adminReply.includes('Khusus admin:'));
    assert.ok(adminReply.includes('/stats'));
    assert.ok(adminReply.includes('/ban'));
    assert.ok(adminReply.includes('/broadcast'));
  });

  it('bot.command menolak eksekusi perintah adminOnly oleh non-admin secara diam', async () => {
    const commandMap = new Map();
    const mockBot = {
      command: (name, handler) => {
        commandMap.set(name, handler);
      },
    };

    process.env.ADMIN_IDS = '12345';

    await registerFeatures({
      bot: mockBot,
      features: [adminFeature],
      context: {},
    });

    const statsHandler = commandMap.get('stats');
    assert.ok(statsHandler);

    let replyCalled = false;
    await statsHandler({
      from: { id: 99999 }, // Non-admin
      reply: async () => {
        replyCalled = true;
      },
    });

    assert.equal(replyCalled, false, 'Non-admin tidak boleh menerima balasan dari perintah admin');
  });

  it('fitur nonaktif tidak dimuat dan fitur inti selalu aktif', async () => {
    const features = await loadFeatures({
      dir: path.resolve('src', 'features'),
      enabledFeatures: 'reminders',
    });

    const ids = features.map((f) => f.id);
    assert.ok(ids.includes('core'), 'Fitur core wajib selalu aktif');
    assert.ok(ids.includes('settings'), 'Fitur settings wajib selalu aktif');
    assert.ok(ids.includes('reminders'), 'Fitur reminders aktif');
    assert.ok(!ids.includes('todo'), 'Fitur todo tidak boleh aktif');
    assert.ok(!ids.includes('notes'), 'Fitur notes tidak boleh aktif');
    assert.ok(!ids.includes('admin'), 'Fitur admin tidak boleh aktif');
  });

  it('typo pada FEATURES tidak menyebabkan crash', async () => {
    const features = await loadFeatures({
      dir: path.resolve('src', 'features'),
      enabledFeatures: 'reminders,todoo_typo,random_feature',
    });

    assert.ok(Array.isArray(features));
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes('core'));
    assert.ok(ids.includes('settings'));
    assert.ok(ids.includes('reminders'));
  });

  it('perintah admin ditiadakan jika fitur admin tidak aktif di FEATURES', async () => {
    const features = await loadFeatures({
      dir: path.resolve('src', 'features'),
      enabledFeatures: 'stickers',
    });

    const stickerFeature = features.find((f) => f.id === 'stickers');
    assert.ok(stickerFeature);
    // Karena 'admin' tidak ada di FEATURES, perintah adminOnly (seperti /addsticker) harus dibuang
    const hasAdminOnly = stickerFeature.commands.some((c) => c.adminOnly);
    assert.equal(hasAdminOnly, false);
  });
});

