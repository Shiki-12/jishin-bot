import './setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectBestPhoto,
  buildPhotoPlaceholder,
  getMimeTypeFromPath,
  downloadPhotoAsBase64,
  formatVisionUserContent,
  MAX_PHOTO_BYTES,
} from '../src/core/vision.js';
import { generateVisionReply, VisionUnsupportedError } from '../src/llm.js';
import visionFeature from '../src/features/vision.js';

describe('F-30: Baca Gambar (Vision)', () => {
  describe('selectBestPhoto', () => {
    it('mengembalikan null jika input bukan array atau array kosong', () => {
      assert.equal(selectBestPhoto(null), null);
      assert.equal(selectBestPhoto([]), null);
      assert.equal(selectBestPhoto([{}]), null);
    });

    it('memilih resolusi foto terbesar yang masih di bawah batas 20 MB', () => {
      const photos = [
        { file_id: 'small_id', width: 90, height: 90, file_size: 2000 },
        { file_id: 'medium_id', width: 320, height: 320, file_size: 25000 },
        { file_id: 'large_id', width: 1280, height: 720, file_size: 150000 },
      ];

      const best = selectBestPhoto(photos);
      assert.ok(best);
      assert.equal(best.file_id, 'large_id');
      assert.equal(best.width, 1280);
    });

    it('menolak foto yang melebihi batas ukuran maksimal (20 MB)', () => {
      const oversized = [
        { file_id: 'huge_id', width: 2000, height: 2000, file_size: 25 * 1024 * 1024 }, // 25 MB
      ];

      const best = selectBestPhoto(oversized);
      assert.equal(best, null);
    });

    it('memilih foto terbesar yang valid jika salah satu ukuran melebihi batas', () => {
      const photos = [
        { file_id: 'valid_id', width: 800, height: 600, file_size: 1024 * 1024 },
        { file_id: 'too_big_id', width: 5000, height: 5000, file_size: 22 * 1024 * 1024 },
      ];

      const best = selectBestPhoto(photos);
      assert.ok(best);
      assert.equal(best.file_id, 'valid_id');
    });
  });

  describe('buildPhotoPlaceholder', () => {
    it('menghasilkan placeholder dengan caption jika caption tersedia', () => {
      const placeholder = buildPhotoPlaceholder('kucing tidur di kasur');
      assert.equal(placeholder, '[user mengirim foto: kucing tidur di kasur]');
    });

    it('menghasilkan placeholder tanpa caption jika kosong atau hanya spasi', () => {
      assert.equal(buildPhotoPlaceholder(''), '[user mengirim foto]');
      assert.equal(buildPhotoPlaceholder('   '), '[user mengirim foto]');
      assert.equal(buildPhotoPlaceholder(null), '[user mengirim foto]');
    });
  });

  describe('getMimeTypeFromPath', () => {
    it('mendeteksi MIME type berdasarkan ekstensi file path Telegram', () => {
      assert.equal(getMimeTypeFromPath('photos/file_1.png'), 'image/png');
      assert.equal(getMimeTypeFromPath('photos/file_1.webp'), 'image/webp');
      assert.equal(getMimeTypeFromPath('photos/file_1.gif'), 'image/gif');
      assert.equal(getMimeTypeFromPath('photos/file_1.jpg'), 'image/jpeg');
      assert.equal(getMimeTypeFromPath('photos/file_1.jpeg'), 'image/jpeg');
      assert.equal(getMimeTypeFromPath('photos/file_1'), 'image/jpeg');
    });
  });

  describe('downloadPhotoAsBase64', () => {
    it('mengunduh foto dari mock api dan mengonversi menjadi base64 Data URL', async () => {
      const fakeBytes = Buffer.from('fake-image-binary-data');
      const mockApi = {
        getFile: async (id) => {
          assert.equal(id, 'test_file_id');
          return { file_path: 'photos/sample.jpg' };
        },
      };

      const mockFetch = async (url) => {
        assert.ok(url.includes('photos/sample.jpg'));
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => Uint8Array.from(fakeBytes).buffer,
        };
      };

      const dataUrl = await downloadPhotoAsBase64({
        api: mockApi,
        fileId: 'test_file_id',
        botToken: 'fake_bot_token',
        fetchFn: mockFetch,
      });

      assert.ok(dataUrl.startsWith('data:image/jpeg;base64,'));
      const base64Part = dataUrl.split(',')[1];
      assert.equal(Buffer.from(base64Part, 'base64').toString(), 'fake-image-binary-data');
    });

    it('melemparkan error jika api.getFile gagal atau file_path kosong', async () => {
      const mockApi = {
        getFile: async () => ({ file_path: null }),
      };

      await assert.rejects(
        () => downloadPhotoAsBase64({ api: mockApi, fileId: 'bad_id', botToken: 'fake_token' }),
        /tidak mengembalikan file_path/i,
      );
    });

    it('melemparkan error jika ukuran melebihi batas maxBytes', async () => {
      const mockApi = {
        getFile: async () => ({ file_path: 'photos/huge.jpg' }),
      };

      const mockFetch = async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(500),
      });

      await assert.rejects(
        () =>
          downloadPhotoAsBase64({
            api: mockApi,
            fileId: 'huge_id',
            botToken: 'token',
            fetchFn: mockFetch,
            maxBytes: 100, // batas kecil untuk uji
          }),
        /melebihi batas maksimal/i,
      );
    });
  });

  describe('formatVisionUserContent', () => {
    it('menyusun format multimodal OpenAI yang sesuai spesifikasi', () => {
      const content = formatVisionUserContent('Lihat ini dong!', 'data:image/jpeg;base64,abc123');
      assert.equal(content.length, 2);
      assert.deepEqual(content[0], { type: 'text', text: 'Lihat ini dong!' });
      assert.deepEqual(content[1], {
        type: 'image_url',
        image_url: { url: 'data:image/jpeg;base64,abc123' },
      });
    });

    it('menggunakan teks prompt fallback jika caption kosong', () => {
      const content = formatVisionUserContent('', 'data:image/jpeg;base64,abc123');
      assert.equal(content[0].text, 'Foto apa ini? Tolong jelaskan.');
    });
  });

  describe('generateVisionReply (LLM Integration)', () => {
    it('menyusun pesan dengan role system, history, dan multimodal user content', async () => {
      let passedModel;
      let passedMessages;

      const mockCallModel = async (model, messages) => {
        passedModel = model;
        passedMessages = messages;
        return 'Ini foto pemandangan pantai yang indah! <think>pikiranku</think>';
      };

      const reply = await generateVisionReply({
        systemPrompt: 'Kamu Mika.',
        history: [{ role: 'user', text: 'halo' }, { role: 'model', text: 'hai' }],
        caption: 'Foto apa ini?',
        imageDataUrl: 'data:image/jpeg;base64,xyz987',
        model: 'test-vision-model',
        callModelFn: mockCallModel,
      });

      assert.equal(passedModel, 'test-vision-model');
      assert.equal(passedMessages.length, 4);
      assert.equal(passedMessages[0].role, 'system');
      assert.equal(passedMessages[1].role, 'user');
      assert.equal(passedMessages[2].role, 'assistant');
      assert.equal(passedMessages[3].role, 'user');
      assert.deepEqual(passedMessages[3].content, [
        { type: 'text', text: 'Foto apa ini?' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,xyz987' } },
      ]);
      assert.equal(reply, 'Ini foto pemandangan pantai yang indah! <think>pikiranku</think>');
    });

    it('melemparkan VisionUnsupportedError jika model menghasilkan error 400 atau 422', async () => {
      const mockCallModelFail = async () => {
        const err = new Error('HTTP 400 model does not support image input');
        err.status = 400;
        throw err;
      };

      await assert.rejects(
        () =>
          generateVisionReply({
            systemPrompt: 'System',
            imageDataUrl: 'data:image/jpeg;base64,test',
            callModelFn: mockCallModelFail,
          }),
        (err) => {
          assert.equal(err.name, 'VisionUnsupportedError');
          assert.equal(err.status, 400);
          return true;
        },
      );
    });
  });

  describe('Fitur Vision Module & Commands', () => {
    it('/vision menampilkan petunjuk penggunaan fitur baca gambar', async () => {
      const replies = [];
      const ctx = {
        reply: async (text, opts) => replies.push({ text, opts }),
      };

      const cmd = visionFeature.commands.find((c) => c.name === 'vision');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].text.includes('Fitur Baca Gambar (Vision)'));
      assert.ok(replies[0].text.includes('20 MB'));
    });

    it('mengabaikan foto di grup jika tidak me-mention bot dan bukan reply ke bot', async () => {
      let photoHandler;
      const mockBot = {
        on: (event, handler) => {
          if (event === 'message:photo') photoHandler = handler;
        },
      };

      await visionFeature.init({ bot: mockBot });
      assert.ok(photoHandler);

      let handled = false;
      const ctx = {
        chat: { type: 'group', id: -100123 },
        me: { id: 99, username: 'mikabot' },
        message: {
          photo: [{ file_id: 'p1', width: 100, height: 100, file_size: 1000 }],
          caption: 'ini foto pemandangan',
        },
      };

      await photoHandler(ctx);
      assert.equal(handled, false);
    });

    it('memproses foto di private chat dan meneruskannya ke handleChatMessage', async () => {
      let photoHandler;
      let passedArgs;
      const mockBot = {
        on: (event, handler) => {
          if (event === 'message:photo') photoHandler = handler;
        },
      };

      const fakeHandleChatMessage = async (...args) => {
        passedArgs = args;
      };

      await visionFeature.init({
        bot: mockBot,
        handleChatMessage: fakeHandleChatMessage,
      });

      const fakeBytes = Buffer.from('cat-photo-data');
      const ctx = {
        chat: { type: 'private', id: 12345 },
        from: { id: 12345, first_name: 'Budi' },
        me: { id: 99, username: 'mikabot' },
        message: {
          message_id: 888,
          photo: [
            { file_id: 'photo_small', width: 100, height: 100, file_size: 1000 },
            { file_id: 'photo_best', width: 800, height: 600, file_size: 50000 },
          ],
          caption: 'Kucingku lagi tidur nih',
        },
        api: {
          getFile: async (fileId) => {
            assert.equal(fileId, 'photo_best');
            return { file_path: 'photos/cat.jpg' };
          },
        },
        replyWithChatAction: async () => {},
        reply: async () => {},
      };

      // Mock global fetch sementara
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => Uint8Array.from(fakeBytes).buffer,
      });

      try {
        await photoHandler(ctx);

        assert.ok(passedArgs);
        const [targetCtx, rawText, isPrivate, replyOptions, extra] = passedArgs;
        assert.equal(rawText, 'Kucingku lagi tidur nih');
        assert.equal(isPrivate, true);
        assert.ok(extra.vision);
        assert.ok(extra.vision.imageUrl.startsWith('data:image/jpeg;base64,'));
        assert.equal(extra.vision.placeholder, '[user mengirim foto: Kucingku lagi tidur nih]');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('memberikan pesan error jika foto melebihi batas ukuran (20 MB)', async () => {
      let photoHandler;
      const mockBot = {
        on: (event, handler) => {
          if (event === 'message:photo') photoHandler = handler;
        },
      };

      await visionFeature.init({ bot: mockBot });

      const replies = [];
      const ctx = {
        chat: { type: 'private', id: 12345 },
        persona: {
          strings: {
            visionTooLarge: 'Foto kegedean!',
          },
        },
        message: {
          photo: [{ file_id: 'too_large', width: 3000, height: 3000, file_size: 25 * 1024 * 1024 }],
        },
        reply: async (text) => replies.push(text),
      };

      await photoHandler(ctx);

      assert.equal(replies.length, 1);
      assert.equal(replies[0], 'Foto kegedean!');
    });
  });
});
