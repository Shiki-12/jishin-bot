import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractActions,
  formatNowContext,
  buildSystemPrompt,
} from '../src/core/actions.js';
import { extractGif } from '../src/giphy.js';

describe('Generic Action Tags & Prompt Context (F-03)', () => {
  const registeredTags = [
    {
      name: 'GIF',
      minArgs: 1,
      maxArgs: 1,
      maxArgLength: 100,
      promptHint: 'Kirim animasi GIF reaksi',
    },
    {
      name: 'REMIND',
      minArgs: 2,
      maxArgs: 3,
      maxArgLength: 300,
      promptHint: 'Set pengingat waktu',
    },
    {
      name: 'NOTE',
      minArgs: 1,
      maxArgs: 1,
      maxArgLength: 500,
      promptHint: 'Catat teks',
    },
  ];

  it('mengekstrak single tag di akhir teks dan membersihkan tag dari balasan', () => {
    const raw = 'Hmph, dasar bodoh!\n[GIF: anime blush]';
    const { text, actions, invalidTags } = extractActions(raw, registeredTags);

    assert.equal(text, 'Hmph, dasar bodoh!');
    assert.equal(actions.length, 1);
    assert.equal(actions[0].name, 'GIF');
    assert.deepEqual(actions[0].args, ['anime blush']);
    assert.equal(invalidTags.length, 0);
  });

  it('mengekstrak tag ganda di akhir atau baris berbeda', () => {
    const raw =
      'Oke, nanti kuingatkan!\n[REMIND: 2026-11-05T07:00:00+07:00 | minum obat | none]\n[GIF: eye roll]';
    const { text, actions, invalidTags } = extractActions(raw, registeredTags);

    assert.equal(text, 'Oke, nanti kuingatkan!');
    assert.equal(actions.length, 2);
    assert.equal(actions[0].name, 'REMIND');
    assert.deepEqual(actions[0].args, [
      '2026-11-05T07:00:00+07:00',
      'minum obat',
      'none',
    ]);
    assert.equal(actions[1].name, 'GIF');
    assert.deepEqual(actions[1].args, ['eye roll']);
    assert.equal(invalidTags.length, 0);
  });

  it('mengekstrak tag di tengah teks dan menyambung kalimat tanpa menyisakan tag', () => {
    const raw = 'Halo [GIF: wave] apa kabar kamu hari ini?';
    const { text, actions } = extractActions(raw, registeredTags);

    assert.equal(text, 'Halo apa kabar kamu hari ini?');
    assert.equal(actions.length, 1);
    assert.equal(actions[0].name, 'GIF');
    assert.deepEqual(actions[0].args, ['wave']);
  });

  it('membuang tag tidak terdaftar dan mencatatnya ke invalidTags', () => {
    const raw = 'Ini pesan normal [UNKNOWN: foo | bar] selesai.';
    const { text, actions, invalidTags } = extractActions(raw, registeredTags);

    assert.equal(text, 'Ini pesan normal selesai.');
    assert.equal(actions.length, 0);
    assert.equal(invalidTags.length, 1);
    assert.equal(invalidTags[0].name, 'UNKNOWN');
    assert.ok(invalidTags[0].reason.includes('tidak terdaftar'));
  });

  it('menangani tag rusak: argumen kurang, melebihi max, atau terpotong di akhir', () => {
    // 1. Argumen kurang untuk REMIND (butuh minimal 2)
    const raw1 = 'Tes [REMIND: 2026-11-05]';
    const res1 = extractActions(raw1, registeredTags);
    assert.equal(res1.text, 'Tes');
    assert.equal(res1.actions.length, 0);
    assert.equal(res1.invalidTags.length, 1);
    assert.ok(res1.invalidTags[0].reason.includes('minimal'));

    // 2. Argumen melebihi max untuk GIF (maksimal 1)
    const raw2 = 'Tes [GIF: a | b]';
    const res2 = extractActions(raw2, registeredTags);
    assert.equal(res2.text, 'Tes');
    assert.equal(res2.invalidTags.length, 1);
    assert.ok(res2.invalidTags[0].reason.includes('maksimal'));

    // 3. Tag terpotong di akhir (unclosed bracket)
    const raw3 = 'Balasan kepotong [GIF: anime sm';
    const res3 = extractActions(raw3, registeredTags);
    assert.equal(res3.text, 'Balasan kepotong');
    assert.equal(res3.invalidTags.length, 1);
    assert.ok(res3.invalidTags[0].reason.includes('tidak tertutup'));

    // 4. Argumen terlalu panjang (> 100 karakter untuk GIF)
    const longArg = 'a'.repeat(150);
    const raw4 = `Tes [GIF: ${longArg}]`;
    const res4 = extractActions(raw4, registeredTags);
    assert.equal(res4.invalidTags.length, 1);
    assert.ok(res4.invalidTags[0].reason.includes('panjang'));
  });

  it('extractGif di giphy.js tetap berfungsi untuk backward compatibility', () => {
    const raw = 'I-iya deh, terserah!\n[GIF: flustered]';
    const { text, gifQuery } = extractGif(raw);

    assert.equal(text, 'I-iya deh, terserah!');
    assert.equal(gifQuery, 'flustered');
  });

  it('formatNowContext menghasilkan string waktu dengan zona waktu user dan nama user', () => {
    const ctx = {
      chat: { type: 'private', id: 112233 },
      from: { id: 112233, first_name: 'Budi' },
    };

    const fixedDate = new Date('2026-11-04T13:12:00.000Z'); // 20:12 WIB
    const formatted = formatNowContext(ctx, fixedDate);

    assert.ok(formatted.includes('Sekarang:'));
    assert.ok(formatted.includes('20:12') || formatted.includes('20.12'));
    assert.ok(formatted.includes('Asia/Jakarta'));
    assert.ok(formatted.includes('Nama user: Budi'));
  });

  it('buildSystemPrompt menggabungkan petunjuk tag aktif dan konteks waktu', () => {
    const dummyPersona = {
      systemPrompt: 'Kamu Mika si tsundere.',
    };

    const ctx = {
      chat: { type: 'private', id: 445566 },
      from: { id: 445566, first_name: 'Dewi' },
    };

    const finalPrompt = buildSystemPrompt({
      persona: dummyPersona,
      tags: registeredTags,
      ctx,
    });

    assert.ok(finalPrompt.includes('Kamu Mika si tsundere.'));
    assert.ok(finalPrompt.includes('## Tag Aksi Tersedia'));
    assert.ok(finalPrompt.includes('- [GIF: ...]: Kirim animasi GIF reaksi'));
    assert.ok(finalPrompt.includes('- [REMIND: ...]: Set pengingat waktu'));
    assert.ok(finalPrompt.includes('## Konteks Saat Ini'));
    assert.ok(finalPrompt.includes('Sekarang:'));
    assert.ok(finalPrompt.includes('Nama user: Dewi'));
  });
});

