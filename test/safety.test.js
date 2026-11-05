import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tsundere } from '../src/personalities/tsundere.js';
import { buildSystemPrompt, GLOBAL_SAFETY_RULES } from '../src/core/actions.js';

describe('Safety Rules in Persona & Prompt (F-05)', () => {
  it('system prompt Mika memiliki aturan keselamatan krisis dan hotline resmi', () => {
    const prompt = tsundere.systemPrompt;

    assert.ok(prompt.includes('Aturan Keselamatan & Krisis'));
    assert.ok(prompt.includes('HENTIKAN TOTAL akting tsundere'));
    assert.ok(prompt.includes('Hotline SEJIWA Kemenkes RI: Telepon 119 (ekstensi 8)'));
    assert.ok(prompt.includes('Halo Kemenkes: 1500-567'));
    assert.ok(prompt.includes('Layanan Darurat Nasional: 112'));
  });

  it('system prompt Mika memiliki batasan medis (tanpa diagnosis / resep dosis)', () => {
    const prompt = tsundere.systemPrompt;

    assert.ok(prompt.includes('Batasan Medis'));
    assert.ok(prompt.includes('Dilarang memberikan diagnosis medis'));
    assert.ok(prompt.includes('Dilarang memberikan saran resep, nama obat keras, atau dosis obat'));
  });

  it('system prompt Mika memiliki contoh dialog penanganan krisis dan pertanyaan medis', () => {
    const prompt = tsundere.systemPrompt;

    assert.ok(prompt.includes('pengen ngakhiri semuanya aja'));
    assert.ok(prompt.includes('obat apa dan berapa butir'));
  });

  it('buildSystemPrompt otomatis menyisipkan aturan keselamatan jika persona belum memilikinya', () => {
    const blankPersona = { systemPrompt: 'Kamu robot pembantu polos.' };
    const ctx = { chat: { type: 'private', id: 1 }, from: { id: 1, first_name: 'Test' } };

    const built = buildSystemPrompt({ persona: blankPersona, ctx });

    assert.ok(built.includes(GLOBAL_SAFETY_RULES));
    assert.ok(built.includes('119 (ekstensi 8)'));
  });
});

