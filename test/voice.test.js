import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isVoiceTooLong,
  getPersonaVoice,
  textToSpeech,
  speechToText,
  MAX_VOICE_DURATION_SECONDS,
} from '../src/core/voice.js';
import voiceFeature from '../src/features/voice.js';
import { getSetting, setSetting } from '../src/core/settings.js';
import { getDb } from '../src/core/db.js';

test('F-31: Voice Note (STT & TTS Audio)', async (t) => {
  const testUserId = 7766551;
  const testChatId = 7766551;

  await t.test('Validasi Durasi Pesan Suara (isVoiceTooLong)', () => {
    assert.equal(isVoiceTooLong(30), false);
    assert.equal(isVoiceTooLong(60), false);
    assert.equal(isVoiceTooLong(61), true);
    assert.equal(isVoiceTooLong(120), true);
    assert.equal(isVoiceTooLong(null), false);
  });

  await t.test('Pemetaan Suara Karakter (getPersonaVoice)', () => {
    assert.equal(getPersonaVoice('tsundere'), 'cute-girl');
    assert.equal(getPersonaVoice('kalem'), 'calm-girl');
    assert.equal(getPersonaVoice('ceria'), 'energetic-female');
    assert.equal(getPersonaVoice('sarkas'), 'normal-male');
    assert.equal(getPersonaVoice('unknown'), 'cute-girl');
  });

  await t.test('Perintah /voice [on|off] Pengaturan Balasan Suara TTS', async () => {
    const voiceCmd = voiceFeature.commands.find((c) => c.name === 'voice');
    assert.ok(voiceCmd);

    let replyMsg = '';
    const ctx = {
      from: { id: testUserId },
      chat: { id: testChatId, type: 'private' },
      message: { text: '/voice on' },
      reply: async (msg) => {
        replyMsg = msg;
      },
    };

    // 1. /voice on
    await voiceCmd.handler(ctx);
    assert.equal(getSetting(ctx, 'voice_reply'), 1);
    assert.match(replyMsg, /diaktifkan/i);

    // 2. /voice off
    ctx.message.text = '/voice off';
    await voiceCmd.handler(ctx);
    assert.equal(getSetting(ctx, 'voice_reply'), 0);
    assert.match(replyMsg, /(dinonaktifkan|dimatikan)/i);

    // 3. /voice (status)
    ctx.message.text = '/voice';
    await voiceCmd.handler(ctx);
    assert.match(replyMsg, /Pengaturan Balasan Suara/i);
    assert.match(replyMsg, /nonaktif/i);
  });

  await t.test('textToSpeech: Pembuatan Audio TTS dengan Mock Fetch', async () => {
    const originalFetch = global.fetch;
    let requestedPayload = null;

    global.fetch = async (url, opts) => {
      requestedPayload = JSON.parse(opts.body);
      const dummyAudio = Buffer.from('RIFF_DUMMY_MP3_AUDIO_DATA');
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => dummyAudio.buffer,
      };
    };

    try {
      const audioBuffer = await textToSpeech({
        text: 'Halo! *Ini* balasan [GIF: wave] teks.',
        voice: 'cute-girl',
        model: 'xkiro-voice',
        baseUrl: 'http://mock-api.local/v1',
        apiKey: 'dummy_key',
      });

      assert.ok(Buffer.isBuffer(audioBuffer));
      assert.ok(audioBuffer.length > 0);
      assert.equal(requestedPayload.model, 'xkiro-voice');
      assert.equal(requestedPayload.voice, 'cute-girl');
      // Markdown & tag bersih
      assert.equal(requestedPayload.input, 'Halo! Ini balasan teks.');
    } finally {
      global.fetch = originalFetch;
    }
  });

  await t.test('speechToText: Transkripsi STT & Penanganan 404 Not Supported', async () => {
    const originalFetch = global.fetch;

    // 1. Kasus Sukses
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ text: 'Halo bot, tolong buatkan catatan' }),
    });

    try {
      const text = await speechToText({
        audioBuffer: Buffer.from('dummy_ogg_data'),
        baseUrl: 'http://mock-api.local/v1',
        apiKey: 'dummy_key',
      });
      assert.equal(text, 'Halo bot, tolong buatkan catatan');
    } finally {
      global.fetch = originalFetch;
    }

    // 2. Kasus 404 (Gateway belum mendukung STT)
    global.fetch = async () => ({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ error: { message: 'Cannot POST /v1/audio/transcriptions' } }),
    });

    try {
      await assert.rejects(
        async () => {
          await speechToText({
            audioBuffer: Buffer.from('dummy_ogg_data'),
            baseUrl: 'http://mock-api.local/v1',
            apiKey: 'dummy_key',
          });
        },
        (err) => {
          assert.equal(err.message, 'STT_NOT_SUPPORTED');
          assert.equal(err.status, 404);
          return true;
        },
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  await t.test('Listener message:voice: Durasi Panjang & Penerusan Chat', async () => {
    let registeredVoiceHandler = null;
    const mockBot = {
      on: (event, handler) => {
        if (event === 'message:voice') {
          registeredVoiceHandler = handler;
        }
      },
    };

    let handledChatText = null;
    await voiceFeature.init({
      bot: mockBot,
      handleChatMessage: async (ctx, text) => {
        handledChatText = text;
      },
    });

    assert.ok(typeof registeredVoiceHandler === 'function');

    // 1. Tolak jika durasi > 60 detik
    let replyMsg = '';
    const longVoiceCtx = {
      from: { id: testUserId },
      chat: { id: testChatId, type: 'private' },
      message: {
        voice: { duration: 75, file_id: 'voice_long' },
      },
      persona: {
        strings: { voiceTooLong: 'Pesan suara terlalu panjang!' },
        errorMessage: 'Error',
      },
      reply: async (msg) => {
        replyMsg = msg;
      },
    };

    await registeredVoiceHandler(longVoiceCtx);
    assert.match(replyMsg, /terlalu panjang/i);

    // 2. Terima dan transkripsikan jika valid
    let heardMsg = '';
    const validVoiceCtx = {
      from: { id: testUserId },
      chat: { id: testChatId, type: 'private' },
      message: {
        message_id: 99,
        voice: { duration: 15, file_id: 'voice_ok' },
      },
      persona: {
        strings: {
          voiceHeard: 'Kudengar: "{text}"',
          voiceSttUnsupported: 'Fitur STT belum tersedia.',
        },
        errorMessage: 'Error',
      },
      replyWithChatAction: async () => {},
      reply: async (msg) => {
        heardMsg = msg;
      },
      speechToTextFn: async () => 'Selamat pagi bot',
    };

    await registeredVoiceHandler(validVoiceCtx);
    assert.match(heardMsg, /Kudengar: "Selamat pagi bot"/);
    assert.equal(handledChatText, 'Selamat pagi bot');

    // 3. Tangani gateway STT tidak didukung secara ramah
    let unsupportedMsg = '';
    const unsupportedVoiceCtx = {
      from: { id: testUserId },
      chat: { id: testChatId, type: 'private' },
      message: {
        message_id: 100,
        voice: { duration: 10, file_id: 'voice_unsupported' },
      },
      persona: {
        strings: {
          voiceSttUnsupported: 'Fitur STT belum didukung oleh gateway API.',
        },
        errorMessage: 'Error',
      },
      replyWithChatAction: async () => {},
      reply: async (msg) => {
        unsupportedMsg = msg;
      },
      speechToTextFn: async () => {
        const err = new Error('STT_NOT_SUPPORTED');
        err.status = 404;
        throw err;
      },
    };

    await registeredVoiceHandler(unsupportedVoiceCtx);
    assert.match(unsupportedMsg, /belum didukung/i);
  });
});
