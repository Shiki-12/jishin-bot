import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  callModel,
  generateReply,
  generateVisionReply,
  LlmError,
  VisionUnsupportedError,
  isTemporary,
} from '../src/llm.js';
import { setActiveModel } from '../src/core/admin.js';

test('F-63: LLM Integration (Mock HTTP Server, Retry & Fallback)', async (t) => {
  let mockPort = 0;
  let mockServer = null;
  let requestLog = [];
  let responseHandler = null;

  // Siapkan local mock server HTTP untuk menyimulasikan OpenAI-compatible endpoint
  await new Promise((resolve) => {
    mockServer = http.createServer(async (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {}

        requestLog.push({
          url: req.url,
          method: req.method,
          headers: req.headers,
          body: parsed,
        });

        if (typeof responseHandler === 'function') {
          return responseHandler(req, res, parsed);
        }

        // Default response: success
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'Halo dari mock LLM!',
                },
              },
            ],
          }),
        );
      });
    });

    mockServer.listen(0, () => {
      mockPort = mockServer.address().port;
      resolve();
    });
  });

  t.after(() => {
    if (mockServer) mockServer.close();
  });

  const mockBaseUrl = `http://127.0.0.1:${mockPort}`;

  await t.test('callModel: Pemanggilan Sukses & Pembersihan Tag <think>', async () => {
    requestLog = [];
    responseHandler = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '<think>penalaran internal rahasia</think> Jawaban final untuk user.',
              },
            },
          ],
        }),
      );
    };

    const reply = await callModel('test-model', [{ role: 'user', content: 'Halo' }], {
      baseUrl: mockBaseUrl,
      apiKey: 'test-key',
    });

    assert.equal(reply, 'Jawaban final untuk user.');
    assert.equal(requestLog.length, 1);
    assert.equal(requestLog[0].body.model, 'test-model');
    assert.equal(requestLog[0].headers.authorization, 'Bearer test-key');
  });

  await t.test('callModel: Menangani Error HTTP (LlmError)', async () => {
    requestLog = [];
    responseHandler = (req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
    };

    await assert.rejects(
      async () => {
        await callModel('test-model', [], { baseUrl: mockBaseUrl, apiKey: 'bad-key' });
      },
      (err) => {
        assert.ok(err instanceof LlmError);
        assert.equal(err.status, 401);
        return true;
      },
    );
  });

  await t.test('isTemporary: Deteksi Status Code yang Layak Dicoba Ulang', () => {
    assert.equal(isTemporary({ status: 500 }), true);
    assert.equal(isTemporary({ status: 502 }), true);
    assert.equal(isTemporary({ status: 503 }), true);
    assert.equal(isTemporary({ status: 429 }), true);
    assert.equal(isTemporary({ status: 408 }), true);
    assert.equal(isTemporary({ status: undefined }), true); // error jaringan/timeout

    assert.equal(isTemporary({ status: 400 }), false);
    assert.equal(isTemporary({ status: 401 }), false);
    assert.equal(isTemporary({ status: 404 }), false);
  });

  await t.test('generateReply: Retry Otomatis saat Error Sementara', async () => {
    let callCount = 0;
    const mockCallModelFn = async () => {
      callCount++;
      if (callCount === 1) {
        throw new LlmError('Server Busy 503', 503);
      }
      return 'Balasan sukses setelah retry!';
    };

    const reply = await generateReply({
      systemPrompt: 'Kamu asisten.',
      history: [],
      userText: 'Hai',
      callModelFn: mockCallModelFn,
      retryDelayMs: 5, // jeda sangat singkat untuk kecepatan unit test
    });

    assert.equal(reply, 'Balasan sukses setelah retry!');
    assert.equal(callCount, 2);
  });

  await t.test('generateReply: Fallback ke Model Cadangan saat Model Utama Gagal', async () => {
    process.env.LLM_FALLBACK_MODEL = 'fallback-model-test';
    setActiveModel('primary-model-test', 999999);

    const modelsCalled = [];
    const mockCallModelFn = async (model) => {
      modelsCalled.push(model);
      if (model === 'primary-model-test') {
        // Error non-sementara (langsung pindah ke fallback)
        throw new LlmError('Model not found 404', 404);
      }
      return 'Balasan sukses dari fallback!';
    };

    const reply = await generateReply({
      systemPrompt: 'Kamu asisten.',
      history: [],
      userText: 'Hai',
      callModelFn: mockCallModelFn,
      retryDelayMs: 5,
    });

    assert.equal(reply, 'Balasan sukses dari fallback!');
    assert.ok(modelsCalled.includes('primary-model-test'));
    assert.ok(modelsCalled.includes('fallback-model-test'));

    // Kembalikan model ke default
    setActiveModel('mistralai/mistral-large-2512', 999999);
  });

  await t.test('generateVisionReply: Multimodal Input & Konversi Error Vision', async () => {
    let passedModel = '';
    let passedMessages = [];

    const mockCallFn = async (model, messages) => {
      passedModel = model;
      passedMessages = messages;
      return 'Saya melihat secangkir kopi hangat di atas meja kayu.';
    };

    const reply = await generateVisionReply({
      systemPrompt: 'Kamu deskriptor gambar.',
      caption: 'Apa ini?',
      imageDataUrl: 'data:image/jpeg;base64,12345',
      callModelFn: mockCallFn,
    });

    assert.equal(reply, 'Saya melihat secangkir kopi hangat di atas meja kayu.');
    assert.equal(passedMessages.length, 2);
    assert.equal(passedMessages[1].role, 'user');
    assert.ok(Array.isArray(passedMessages[1].content));
    assert.equal(passedMessages[1].content[0].type, 'text');
    assert.equal(passedMessages[1].content[1].type, 'image_url');
    assert.equal(passedMessages[1].content[1].image_url.url, 'data:image/jpeg;base64,12345');

    // Uji konversi VisionUnsupportedError saat error 400/422
    const failingCallFn = async () => {
      throw new LlmError('Vision model does not support image input', 400);
    };

    await assert.rejects(
      async () => {
        await generateVisionReply({
          systemPrompt: 'test',
          imageDataUrl: 'data:image/jpeg;base64,12345',
          callModelFn: failingCallFn,
        });
      },
      (err) => {
        assert.ok(err instanceof VisionUnsupportedError);
        assert.equal(err.status, 400);
        return true;
      },
    );
  });
});
