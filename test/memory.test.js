import './setup.js';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/core/db.js';
import {
  getFacts,
  addFact,
  deleteFact,
  clearFacts,
  getSummary,
  saveSummary,
  clearSummary,
  parseFactsJson,
  extractAndSaveFacts,
  summarizeOlderHistory,
} from '../src/core/facts.js';
import memoryFeature, { renderMemoryView } from '../src/features/memory.js';
import { buildSystemPrompt } from '../src/core/actions.js';

describe('F-14: Memori Jangka Panjang & Ringkasan Percakapan', () => {
  const TEST_USER = 660011;
  const OTHER_USER = 660022;
  const TEST_CHAT = 660011;

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM user_facts WHERE user_id IN (?, ?)').run(
      TEST_USER,
      OTHER_USER,
    );
    db.prepare('DELETE FROM summaries WHERE chat_id = ?').run(TEST_CHAT);
    db.prepare('DELETE FROM messages WHERE chat_id = ?').run(TEST_CHAT);
  });

  after(() => {
    const db = getDb();
    db.prepare('DELETE FROM user_facts WHERE user_id IN (?, ?)').run(
      TEST_USER,
      OTHER_USER,
    );
    db.prepare('DELETE FROM summaries WHERE chat_id = ?').run(TEST_CHAT);
    db.prepare('DELETE FROM messages WHERE chat_id = ?').run(TEST_CHAT);
  });

  describe('Fakta User (CRUD & Deduplikasi)', () => {
    it('menambah fakta dan mengambil daftar fakta', () => {
      const id1 = addFact(TEST_USER, 'Suka minum kopi hitam tanpa gula');
      const id2 = addFact(TEST_USER, 'Punya kucing peliharaan bernama Mochi');
      assert.ok(id1 > 0);
      assert.ok(id2 > 0);

      const facts = getFacts(TEST_USER, 10);
      assert.equal(facts.length, 2);
      assert.equal(facts[0].fact, 'Punya kucing peliharaan bernama Mochi');
      assert.equal(facts[1].fact, 'Suka minum kopi hitam tanpa gula');
    });

    it('deduplikasi otomatis fakta yang sama persis', () => {
      const id1 = addFact(TEST_USER, 'Suka kopi hitam');
      const id2 = addFact(TEST_USER, 'Suka kopi hitam'); // duplikat
      assert.ok(id1 > 0);
      assert.equal(id2, null);

      const facts = getFacts(TEST_USER);
      assert.equal(facts.length, 1);
    });

    it('menolak fakta yang terlalu pendek (< 3 karakter) atau null', () => {
      assert.equal(addFact(TEST_USER, 'ok'), null);
      assert.equal(addFact(TEST_USER, ''), null);
      assert.equal(addFact(TEST_USER, null), null);
    });

    it('menghapus fakta spesifik berdasarkan ID dan isolasi user', () => {
      const id = addFact(TEST_USER, 'Suka main game RPG');

      // User lain tidak bisa menghapus
      const foreignDelete = deleteFact(OTHER_USER, id);
      assert.equal(foreignDelete, false);

      // Pemilik menghapus
      const ownDelete = deleteFact(TEST_USER, id);
      assert.equal(ownDelete, true);
      assert.equal(getFacts(TEST_USER).length, 0);
    });

    it('clearFacts menghapus seluruh fakta user', () => {
      addFact(TEST_USER, 'Fakta 1');
      addFact(TEST_USER, 'Fakta 2');
      addFact(OTHER_USER, 'Fakta user lain');

      const cleared = clearFacts(TEST_USER);
      assert.equal(cleared, 2);
      assert.equal(getFacts(TEST_USER).length, 0);
      assert.equal(getFacts(OTHER_USER).length, 1);
    });
  });

  describe('Ringkasan Percakapan (Summaries)', () => {
    it('menyimpan, mengambil, dan menghapus ringkasan chat', () => {
      saveSummary(TEST_CHAT, 'User dan bot mendiskusikan rencana liburan akhir tahun ke Bali.');
      const s1 = getSummary(TEST_CHAT);
      assert.ok(s1.includes('liburan akhir tahun ke Bali'));

      // Update ringkasan
      saveSummary(TEST_CHAT, 'Ringkasan diperbarui dengan budgeting hotel.');
      const s2 = getSummary(TEST_CHAT);
      assert.ok(s2.includes('budgeting hotel'));

      clearSummary(TEST_CHAT);
      assert.equal(getSummary(TEST_CHAT), null);
    });
  });

  describe('Parser JSON Fakta (parseFactsJson)', () => {
    it('mengurai array JSON string polos', () => {
      const raw = '["Suka kopi", "Pekerjaan software engineer", "Tinggal di Bandung"]';
      const parsed = parseFactsJson(raw);
      assert.deepEqual(parsed, [
        'Suka kopi',
        'Pekerjaan software engineer',
        'Tinggal di Bandung',
      ]);
    });

    it('mengurai array JSON yang dibungkus markdown codeblock ```json', () => {
      const raw = 'Berikut adalah fakta yang ditemukan:\n```json\n[\n  "Hobi bersepeda",\n  "Alergi kacang"\n]\n```\nSelesai.';
      const parsed = parseFactsJson(raw);
      assert.deepEqual(parsed, ['Hobi bersepeda', 'Alergi kacang']);
    });

    it('mengembalikan array kosong jika input rusak atau tidak valid', () => {
      assert.deepEqual(parseFactsJson('tidak ada fakta'), []);
      assert.deepEqual(parseFactsJson(''), []);
      assert.deepEqual(parseFactsJson(null), []);
    });
  });

  describe('Ekstraksi Fakta & Perangkuman Otomatis via Mock LLM', () => {
    it('extractAndSaveFacts mengekstrak dan menyimpan fakta dari riwayat', async () => {
      const db = getDb();
      db.prepare(
        'INSERT INTO messages (chat_id, role, text, created_at) VALUES (?, ?, ?, ?)',
      ).run(TEST_CHAT, 'user', 'aku baru beli kucing persia nih, namanya snowy', Date.now());
      db.prepare(
        'INSERT INTO messages (chat_id, role, text, created_at) VALUES (?, ?, ?, ?)',
      ).run(TEST_CHAT, 'model', 'Wah lucunya si snowy!', Date.now());

      const mockGenerateReply = async ({ systemPrompt, userText }) => {
        assert.ok(systemPrompt.includes('ATURAN KEAMANAN & PRIVASI'));
        assert.ok(userText.includes('snowy'));
        return '["Punya kucing persia bernama snowy"]';
      };

      const saved = await extractAndSaveFacts({
        userId: TEST_USER,
        chatId: TEST_CHAT,
        generateReplyFn: mockGenerateReply,
      });

      assert.equal(saved.length, 1);
      assert.equal(saved[0].fact, 'Punya kucing persia bernama snowy');

      const facts = getFacts(TEST_USER);
      assert.equal(facts.length, 1);
    });

    it('summarizeOlderHistory merangkum dan memangkas pesan lama saat melewati threshold', async () => {
      const db = getDb();
      // Masukkan 30 pesan
      for (let i = 1; i <= 30; i++) {
        db.prepare(
          'INSERT INTO messages (chat_id, role, text, created_at) VALUES (?, ?, ?, ?)',
        ).run(TEST_CHAT, i % 2 === 1 ? 'user' : 'model', `Pesan ke-${i}`, Date.now() + i);
      }

      const mockGenerateReply = async ({ userText }) => {
        assert.ok(userText.includes('Pesan ke-1'));
        return 'Ringkasan percakapan awal membahas salam pembuka dan topik awal.';
      };

      const summary = await summarizeOlderHistory({
        chatId: TEST_CHAT,
        generateReplyFn: mockGenerateReply,
        threshold: 24,
        batchSize: 12,
      });

      assert.ok(summary);
      assert.ok(summary.includes('salam pembuka'));

      // Cek ringkasan tersimpan di database
      assert.equal(getSummary(TEST_CHAT), summary);

      // Cek jumlah pesan berkurang dari 30 menjadi 18
      const count = db
        .prepare('SELECT count(*) as count FROM messages WHERE chat_id = ?')
        .get(TEST_CHAT).count;
      assert.equal(count, 18);
    });
  });

  describe('Injeksi System Prompt (buildSystemPrompt)', () => {
    it('menyisipkan fakta user dan ringkasan chat ke dalam system prompt', () => {
      addFact(TEST_USER, 'Suka kopi arabika');
      saveSummary(TEST_CHAT, 'Percakapan sebelumnya membahas proyek bot Telegram.');

      const ctx = {
        chat: { id: TEST_CHAT },
        from: { id: TEST_USER, first_name: 'Budi' },
      };

      const prompt = buildSystemPrompt({
        persona: { systemPrompt: 'Kamu adalah Mika.' },
        ctx,
      });

      assert.ok(prompt.includes('## Ringkasan Percakapan Sebelumnya'));
      assert.ok(prompt.includes('proyek bot Telegram'));
      assert.ok(prompt.includes('## Hal yang Kamu Ketahui tentang User'));
      assert.ok(prompt.includes('Suka kopi arabika'));
    });
  });

  describe('Perintah & Callback Feature Memory', () => {
    it('/memory menampilkan daftar fakta dan tombol inline', async () => {
      addFact(TEST_USER, 'Pekerjaan sebagai programmer');

      const replies = [];
      const ctx = {
        from: { id: TEST_USER },
        reply: async (text, opts) => replies.push({ text, opts }),
      };

      const cmd = memoryFeature.commands.find((c) => c.name === 'memory');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].text.includes('Fakta yang kuingat'));
      assert.ok(replies[0].text.includes('programmer'));
      assert.ok(replies[0].opts.reply_markup);
    });

    it('/delfact menghapus fakta tertentu', async () => {
      const id = addFact(TEST_USER, 'Suka makan pedas');

      const replies = [];
      const ctx = {
        from: { id: TEST_USER },
        message: { text: `/delfact ${id}` },
        reply: async (text) => replies.push(text),
      };

      const cmd = memoryFeature.commands.find((c) => c.name === 'delfact');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].includes('kulupakan'));
      assert.equal(getFacts(TEST_USER).length, 0);
    });

    it('callback fact:del:<id> menghapus fakta', async () => {
      const id = addFact(TEST_USER, 'Suka musik rock');

      const edits = [];
      const ctx = {
        from: { id: TEST_USER },
        callbackQuery: { data: `fact:del:${id}` },
        answerCallbackQuery: async () => {},
        editMessageText: async (text, opts) => edits.push({ text, opts }),
      };

      const cb = memoryFeature.callbacks.find((c) => c.prefix === 'fact:');
      await cb.handler(ctx);

      assert.equal(getFacts(TEST_USER).length, 0);
      assert.equal(edits.length, 1);
    });

    it('callback fact:clear_confirmed menghapus semua fakta', async () => {
      addFact(TEST_USER, 'Fakta A');
      addFact(TEST_USER, 'Fakta B');

      const edits = [];
      const ctx = {
        from: { id: TEST_USER },
        callbackQuery: { data: 'fact:clear_confirmed' },
        answerCallbackQuery: async () => {},
        editMessageText: async (text, opts) => edits.push({ text, opts }),
      };

      const cb = memoryFeature.callbacks.find((c) => c.prefix === 'fact:');
      await cb.handler(ctx);

      assert.equal(getFacts(TEST_USER).length, 0);
      assert.equal(edits.length, 1);
      assert.ok(edits[0].text.includes('kuhapus'));
    });
  });
});

