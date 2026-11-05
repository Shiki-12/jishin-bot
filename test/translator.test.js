import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeLanguage,
  isUrlOnly,
  hasNoSubstanceExceptUrl,
  parseTranslateArgs,
  parseSummarizeArgs,
  buildTranslationSystemPrompt,
  buildSummarySystemPrompt,
  translateText,
  summarizeText,
} from '../src/core/translator.js';
import translatorFeature from '../src/features/translator.js';
import { getPersonality } from '../src/personalities/index.js';

test('F-46: Terjemah dan Rangkum Teks (Translator & Summarizer)', async (t) => {
  await t.test('Normalisasi Bahasa (normalizeLanguage)', () => {
    // Kode dan nama umum
    assert.equal(normalizeLanguage('en'), 'Bahasa Inggris (English)');
    assert.equal(normalizeLanguage('inggris'), 'Bahasa Inggris (English)');
    assert.equal(normalizeLanguage('id'), 'Bahasa Indonesia');
    assert.equal(normalizeLanguage('indonesia'), 'Bahasa Indonesia');
    assert.equal(normalizeLanguage('ja'), 'Bahasa Jepang (Japanese)');
    assert.equal(normalizeLanguage('jepang'), 'Bahasa Jepang (Japanese)');
    assert.equal(normalizeLanguage('ko'), 'Bahasa Korea (Korean)');
    assert.equal(normalizeLanguage('korea'), 'Bahasa Korea (Korean)');
    assert.equal(normalizeLanguage('zh'), 'Bahasa Mandarin (Chinese)');
    assert.equal(normalizeLanguage('mandarin'), 'Bahasa Mandarin (Chinese)');
    assert.equal(normalizeLanguage('ar'), 'Bahasa Arab (Arabic)');
    assert.equal(normalizeLanguage('arab'), 'Bahasa Arab (Arabic)');
    assert.equal(normalizeLanguage('de'), 'Bahasa Jerman (German)');
    assert.equal(normalizeLanguage('jerman'), 'Bahasa Jerman (German)');
    assert.equal(normalizeLanguage('fr'), 'Bahasa Prancis (French)');
    assert.equal(normalizeLanguage('prancis'), 'Bahasa Prancis (French)');
    assert.equal(normalizeLanguage('es'), 'Bahasa Spanyol (Spanish)');
    assert.equal(normalizeLanguage('spanyol'), 'Bahasa Spanyol (Spanish)');
    assert.equal(normalizeLanguage('ru'), 'Bahasa Rusia (Russian)');
    assert.equal(normalizeLanguage('rusia'), 'Bahasa Rusia (Russian)');
    assert.equal(normalizeLanguage('jv'), 'Bahasa Jawa');
    assert.equal(normalizeLanguage('jawa'), 'Bahasa Jawa');
    assert.equal(normalizeLanguage('su'), 'Bahasa Sunda');
    assert.equal(normalizeLanguage('sunda'), 'Bahasa Sunda');

    // Bahasa kustom dengan huruf alfabet valid
    assert.equal(normalizeLanguage('latin'), 'Bahasa Latin');
    assert.equal(normalizeLanguage('esperanto'), 'Bahasa Esperanto');

    // Input tidak valid
    assert.equal(normalizeLanguage(''), null);
    assert.equal(normalizeLanguage(null), null);
    assert.equal(normalizeLanguage(undefined), null);
    assert.equal(normalizeLanguage('12345'), null);
    assert.equal(normalizeLanguage('!@#$%'), null);
  });

  await t.test('Proteksi SSRF & Filter URL (isUrlOnly, hasNoSubstanceExceptUrl)', () => {
    assert.equal(isUrlOnly('https://example.com'), true);
    assert.equal(isUrlOnly('http://news.detik.com/berita/123'), true);
    assert.equal(isUrlOnly('https://example.com/data?q=1&v=2'), true);
    assert.equal(isUrlOnly('Halo dunia https://example.com'), false);
    assert.equal(isUrlOnly('Hanya teks biasa tanpa tautan'), false);

    assert.equal(hasNoSubstanceExceptUrl('https://example.com'), true);
    assert.equal(hasNoSubstanceExceptUrl('rangkum https://example.com'), true);
    assert.equal(hasNoSubstanceExceptUrl('tolong ini https://example.com/test'), true);
    assert.equal(
      hasNoSubstanceExceptUrl(
        'Berdasarkan pengumuman terbaru di https://example.com perusahaan teknologi tersebut resmi mengumumkan produk terbarunya pada hari ini.',
      ),
      false,
    );
  });

  await t.test('Parser Argumen /terjemah (parseTranslateArgs)', () => {
    // Mode teks langsung
    const direct1 = parseTranslateArgs('en Selamat pagi dunia', '');
    assert.equal(direct1.targetLang, 'en');
    assert.equal(direct1.text, 'Selamat pagi dunia');
    assert.equal(direct1.isReply, false);
    assert.equal(direct1.missingLang, false);

    const directNoText = parseTranslateArgs('en', '');
    assert.equal(directNoText.targetLang, 'en');
    assert.equal(directNoText.text, '');
    assert.equal(directNoText.isReply, false);
    assert.equal(directNoText.missingLang, false);

    const directEmpty = parseTranslateArgs('', '');
    assert.equal(directEmpty.targetLang, null);
    assert.equal(directEmpty.missingLang, true);

    // Mode reply pesan
    const reply1 = parseTranslateArgs('en', 'Selamat pagi dunia');
    assert.equal(reply1.targetLang, 'en');
    assert.equal(reply1.text, 'Selamat pagi dunia');
    assert.equal(reply1.isReply, true);
    assert.equal(reply1.missingLang, false);

    const replyMissingLang = parseTranslateArgs('', 'Pesan orang lain');
    assert.equal(replyMissingLang.targetLang, null);
    assert.equal(replyMissingLang.text, 'Pesan orang lain');
    assert.equal(replyMissingLang.missingLang, true);
    assert.equal(replyMissingLang.isReply, true);

    const replyWithDirectOverride = parseTranslateArgs('jepang Teks ini saja', 'Teks lama di reply');
    assert.equal(replyWithDirectOverride.targetLang, 'jepang');
    assert.equal(replyWithDirectOverride.text, 'Teks ini saja');
    assert.equal(replyWithDirectOverride.isReply, false);
  });

  await t.test('Parser Argumen /rangkum (parseSummarizeArgs)', () => {
    // Mode langsung
    const direct = parseSummarizeArgs('Paragraf panjang artikel yang ingin dirangkum', '');
    assert.equal(direct.text, 'Paragraf panjang artikel yang ingin dirangkum');
    assert.equal(direct.isReply, false);

    // Mode reply
    const reply = parseSummarizeArgs('', 'Paragraf panjang dalam pesan yang dibalas pengguna');
    assert.equal(reply.text, 'Paragraf panjang dalam pesan yang dibalas pengguna');
    assert.equal(reply.isReply, true);

    // Mode kosong
    const empty = parseSummarizeArgs('', '');
    assert.equal(empty.text, '');
    assert.equal(empty.isReply, false);
  });

  await t.test('System Prompt Builder Bersifat Netral Tanpa Persona', () => {
    const transPrompt = buildTranslationSystemPrompt('Bahasa Inggris (English)');
    assert.match(transPrompt, /professional, accurate, and faithful translator/i);
    assert.match(transPrompt, /Bahasa Inggris \(English\)/);
    assert.match(transPrompt, /Output ONLY the final translation directly/i);

    const sumPrompt = buildSummarySystemPrompt();
    assert.match(sumPrompt, /expert executive assistant and summarizer/i);
    assert.match(sumPrompt, /concise, well-structured bullet points/i);
    assert.match(sumPrompt, /Output ONLY the bullet points/i);
  });

  await t.test('Eksekusi translateText dengan Mock LLM', async () => {
    let capturedPrompt = '';
    let capturedUserText = '';
    let capturedHistory = null;

    const mockGenerateReply = async ({ systemPrompt, history, userText }) => {
      capturedPrompt = systemPrompt;
      capturedHistory = history;
      capturedUserText = userText;
      return 'Good morning, how are you?';
    };

    const res = await translateText({
      text: 'Selamat pagi, apa kabarmu?',
      targetLang: 'en',
      generateReplyFn: mockGenerateReply,
    });

    assert.equal(res.targetLang, 'Bahasa Inggris (English)');
    assert.equal(res.translatedText, 'Good morning, how are you?');
    assert.match(capturedPrompt, /professional, accurate/i);
    assert.deepEqual(capturedHistory, []);
    assert.equal(capturedUserText, 'Selamat pagi, apa kabarmu?');

    // Tolak teks kosong
    await assert.rejects(
      translateText({ text: '   ', targetLang: 'en', generateReplyFn: mockGenerateReply }),
      /EMPTY_TEXT/,
    );

    // Tolak URL untuk keamanan SSRF
    await assert.rejects(
      translateText({
        text: 'https://malicious-internal-service.local/secret',
        targetLang: 'en',
        generateReplyFn: mockGenerateReply,
      }),
      /URL_BLOCKED/,
    );

    // Tolak bahasa tidak valid
    await assert.rejects(
      translateText({
        text: 'Halo halo',
        targetLang: '12345!@#',
        generateReplyFn: mockGenerateReply,
      }),
      /INVALID_LANGUAGE/,
    );
  });

  await t.test('Eksekusi summarizeText dengan Mock LLM', async () => {
    let capturedPrompt = '';
    let capturedUserText = '';

    const mockGenerateReply = async ({ systemPrompt, userText }) => {
      capturedPrompt = systemPrompt;
      capturedUserText = userText;
      return '- Poin 1: Peluncuran fitur baru.\n- Poin 2: Peningkatan performa 30%.\n- Poin 3: Rilis minggu depan.';
    };

    const longArticle =
      'Hari ini tim pengembang mengumumkan peluncuran fitur baru yang telah dinantikan banyak pengguna. ' +
      'Pembaruan ini meningkatkan performa sistem hingga 30 persen dan dijadwalkan akan dirilis secara resmi minggu depan.';

    const res = await summarizeText({
      text: longArticle,
      generateReplyFn: mockGenerateReply,
    });

    assert.match(res.summaryText, /Poin 1/);
    assert.match(res.summaryText, /Poin 2/);
    assert.match(capturedPrompt, /expert executive assistant and summarizer/i);
    assert.equal(capturedUserText, longArticle);

    // Tolak teks kosong
    await assert.rejects(
      summarizeText({ text: '   ', generateReplyFn: mockGenerateReply }),
      /EMPTY_TEXT/,
    );

    // Tolak URL SSRF
    await assert.rejects(
      summarizeText({
        text: 'https://example.com/long-article',
        generateReplyFn: mockGenerateReply,
      }),
      /URL_BLOCKED/,
    );

    // Tolak teks terlalu pendek
    await assert.rejects(
      summarizeText({ text: 'Halo selamat pagi', generateReplyFn: mockGenerateReply }),
      /TEXT_TOO_SHORT/,
    );
  });

  await t.test('Perintah /terjemah Menjawab dengan Persona Flavor', async () => {
    const terjemahCmd = translatorFeature.commands.find((c) => c.name === 'terjemah');
    assert.ok(terjemahCmd);

    // Uji panduan saat argumen kosong
    let replyMsg = '';
    const ctxEmpty = {
      message: { text: '/terjemah' },
      reply: async (msg) => {
        replyMsg = msg;
      },
    };
    await terjemahCmd.handler(ctxEmpty);
    assert.match(replyMsg, /Format Perintah Terjemah/);

    // Uji penolakan URL dengan proteksi SSRF
    let blockedReply = '';
    const ctxUrl = {
      message: { text: '/terjemah en https://example.com/secret' },
      replyWithChatAction: async () => {},
      reply: async (msg) => {
        blockedReply = msg;
      },
      from: { id: 123 },
      chat: { id: 123 },
    };
    await terjemahCmd.handler(ctxUrl);
    assert.match(blockedReply, /keamanan|SSRF|Salin/i);

    // Uji bahasa tidak dikenal
    let invalidLangReply = '';
    const ctxInvalidLang = {
      message: { text: '/terjemah 99999 Halo dunia' },
      replyWithChatAction: async () => {},
      reply: async (msg) => {
        invalidLangReply = msg;
      },
      from: { id: 123 },
      chat: { id: 123 },
    };
    await terjemahCmd.handler(ctxInvalidLang);
    assert.match(invalidLangReply, /tidak dikenali/);
  });

  await t.test('Perintah /rangkum Menjawab dengan Persona Flavor & Deteksi Pendek', async () => {
    const rangkumCmd = translatorFeature.commands.find((c) => c.name === 'rangkum');
    assert.ok(rangkumCmd);

    // Uji teks kosong
    let replyMsg = '';
    const ctxEmpty = {
      message: { text: '/rangkum' },
      reply: async (msg) => {
        replyMsg = msg;
      },
    };
    await rangkumCmd.handler(ctxEmpty);
    assert.match(replyMsg, /Format Perintah Rangkum/);

    // Uji teks terlalu pendek
    let shortMsg = '';
    const ctxShort = {
      message: { text: '/rangkum halo pendek' },
      replyWithChatAction: async () => {},
      reply: async (msg) => {
        shortMsg = msg;
      },
      from: { id: 123 },
      chat: { id: 123 },
    };
    await rangkumCmd.handler(ctxShort);
    assert.match(shortMsg, /terlalu pendek/i);

    // Uji proteksi URL pada rangkum
    let urlMsg = '';
    const ctxUrl = {
      message: { text: '/rangkum https://news.site/article' },
      replyWithChatAction: async () => {},
      reply: async (msg) => {
        urlMsg = msg;
      },
      from: { id: 123 },
      chat: { id: 123 },
    };
    await rangkumCmd.handler(ctxUrl);
    assert.match(urlMsg, /keamanan|SSRF|Salin/i);
  });

  await t.test('Persona Strings Memiliki String Terjemahan & Rangkuman Lengkap', () => {
    const personas = ['tsundere', 'kalem', 'ceria', 'sarkas'];
    for (const pId of personas) {
      const p = getPersonality(pId);
      assert.ok(p.strings.translateIntro, `translateIntro missing on ${pId}`);
      assert.ok(p.strings.translateUrlBlocked, `translateUrlBlocked missing on ${pId}`);
      assert.ok(p.strings.summarizeIntro, `summarizeIntro missing on ${pId}`);
      assert.ok(p.strings.summarizeUrlBlocked, `summarizeUrlBlocked missing on ${pId}`);

      const introStr =
        typeof p.strings.translateIntro === 'function'
          ? p.strings.translateIntro('Bahasa Inggris')
          : p.strings.translateIntro;
      assert.match(introStr, /Inggris|terjemah/i);
    }
  });

  await t.test('Definisi Action Tags TRANSLATE & SUMMARIZE', () => {
    const transTag = translatorFeature.tags.find((t) => t.name === 'TRANSLATE');
    assert.ok(transTag);
    assert.match(transTag.promptHint, /TRANSLATE/);
    assert.equal(typeof transTag.handle, 'function');

    const sumTag = translatorFeature.tags.find((t) => t.name === 'SUMMARIZE');
    assert.ok(sumTag);
    assert.match(sumTag.promptHint, /SUMMARIZE/);
    assert.equal(typeof sumTag.handle, 'function');
  });
});

