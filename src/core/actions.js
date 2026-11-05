import { getSetting, applyGifSetting } from './settings.js';
import { getSummary, getFacts } from './facts.js';
import { getAffinity } from './affinity.js';

const TAG_REGEX = /\[([A-Za-z0-9_]+)(?::\s*([^\]]*?))?\]/g;
const UNCLOSED_TAG_AT_END = /\[([A-Za-z0-9_]+):\s*[^\]]*$/;

/**
 * Ekstraksi tag aksi [NAMA: arg1 | arg2] dari teks balasan LLM.
 * Membersihkan seluruh tag (baik valid maupun tidak valid) dari teks akhir.
 *
 * @param {string} raw - Teks mentah dari balasan LLM
 * @param {Array<object>} registeredTags - Daftar definisi tag yang terdaftar
 * @returns {{ text: string, actions: Array<object>, invalidTags: Array<object> }}
 */
export function extractActions(raw = '', registeredTags = []) {
  if (!raw || typeof raw !== 'string') {
    return { text: '', actions: [], invalidTags: [] };
  }

  const tagMap = new Map();
  for (const tag of registeredTags) {
    if (tag?.name) {
      tagMap.set(tag.name.toUpperCase(), tag);
    }
  }

  const actions = [];
  const invalidTags = [];

  // Tangani kemungkinan tag terpotong di akhir output
  let cleanText = raw.replace(UNCLOSED_TAG_AT_END, (match, name) => {
    invalidTags.push({
      name: name.toUpperCase(),
      raw: match,
      reason: 'Tag tidak tertutup lengkap',
    });
    return '';
  });

  // Cari dan validasi semua kemunculan tag
  cleanText = cleanText.replace(TAG_REGEX, (match, name, rawArgs) => {
    const upperName = name.toUpperCase();
    const tagDef = tagMap.get(upperName);

    if (!tagDef) {
      invalidTags.push({
        name: upperName,
        raw: match,
        reason: `Tag '${upperName}' tidak terdaftar`,
      });
      return '';
    }

    const args = (rawArgs ?? '')
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const minArgs = tagDef.minArgs ?? 1;
    const maxArgs = tagDef.maxArgs ?? Infinity;
    const maxArgLength = tagDef.maxArgLength ?? 500;

    if (args.length < minArgs) {
      invalidTags.push({
        name: upperName,
        raw: match,
        reason: `Jumlah argumen kurang (minimal ${minArgs})`,
      });
      return '';
    }

    if (args.length > maxArgs) {
      invalidTags.push({
        name: upperName,
        raw: match,
        reason: `Jumlah argumen berlebih (maksimal ${maxArgs})`,
      });
      return '';
    }

    const tooLong = args.find((a) => a.length > maxArgLength);
    if (tooLong) {
      invalidTags.push({
        name: upperName,
        raw: match,
        reason: `Argumen melebihi panjang maksimal (${maxArgLength} karakter)`,
      });
      return '';
    }

    actions.push({
      name: upperName,
      args,
      raw: match,
      def: tagDef,
    });

    return '';
  });

  // Rapikan baris kosong dan spasi ganda akibat penghapusan tag
  cleanText = cleanText
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
    .join('\n')
    .trim();

  return {
    text: cleanText,
    actions,
    invalidTags,
  };
}

/**
 * Format waktu saat ini sesuai zona waktu user untuk disisipkan ke prompt.
 * Contoh: "Rabu, 04 Nov 2026, 20.12 WIB (Asia/Jakarta)"
 */
export function formatNowContext(ctx, date = new Date()) {
  const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
  const lang = getSetting(ctx, 'lang', 'id');
  const locale = lang === 'en' ? 'en-US' : 'id-ID';

  let formattedTime = '';
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: 'long',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    });
    formattedTime = formatter.format(date);
  } catch {
    formattedTime = date.toISOString();
  }

  const userName = ctx?.from?.first_name || 'User';
  return `Sekarang: ${formattedTime} (${tz})\nNama user: ${userName}`;
}

export const GLOBAL_SAFETY_RULES = `## Aturan Keselamatan & Krisis (Wajib & Prioritas Tertinggi)
1. Krisis Mental & Menyakiti Diri:
   - Jika user menunjukkan tanda krisis mental, putus asa berat, ingin menyakiti diri sendiri, atau bunuh diri: HENTIKAN TOTAL persona acting/tsundere.
   - Dilarang keras meremehkan, mengejek, menyindir, atau bersikap kasar.
   - Jawab secara hangat, tenang, tulus, dan suportif.
   - Dengarkan dan validasi perasaan user, lalu dorong user untuk menghubungi orang terdekat tepercaya atau layanan darurat / bantuan resmi:
     * Hotline SEJIWA Kemenkes RI: Telepon 119 (ekstensi 8)
     * Halo Kemenkes: 1500-567
     * Layanan Darurat Nasional: 112
     * Atau fasilitas kesehatan terdekat (Puskesmas / IGD).
2. Batasan Medis:
   - Dilarang memberikan diagnosis medis penyakit fisik maupun kejiwaan.
   - Dilarang memberikan saran resep, nama obat keras, atau dosis obat.
   - Sarankan user untuk selalu berkonsultasi langsung ke dokter atau tenaga kesehatan profesional.`;

/**
 * Gabungkan system prompt dasar persona dengan petunjuk tag aktif dan konteks waktu.
 */
export function buildSystemPrompt({ persona, tags = [], ctx }) {
  let prompt = persona?.systemPrompt ?? '';

  const gifFreq = getSetting(ctx, 'gif_freq', 'normal');
  prompt = applyGifSetting(prompt, gifFreq);

  // Pastikan aturan keselamatan selalu ada di setiap system prompt
  if (!prompt.includes('SEJIWA') || !prompt.includes('119 (ekstensi 8)')) {
    prompt += `\n\n${GLOBAL_SAFETY_RULES}`;
  }

  // Sisipkan ringkasan percakapan sebelumnya jika tersedia (F-14)
  if (ctx?.chat?.id) {
    try {
      const summary = getSummary(ctx.chat.id);
      if (summary) {
        prompt += `\n\n## Ringkasan Percakapan Sebelumnya\n${summary}`;
      }
    } catch {}
  }

  // Sisipkan fakta stabil tentang user jika tersedia (F-14)
  if (ctx?.from?.id) {
    try {
      const facts = getFacts(ctx.from.id, 15);
      if (facts.length > 0) {
        prompt += `\n\n## Hal yang Kamu Ketahui tentang User\n${facts.map((f) => `- ${f.fact}`).join('\n')}`;
      }
    } catch {}
  }

  // Sisipkan level kedekatan / affinity (F-20)
  if (ctx?.from?.id) {
    try {
      const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
      const aff = getAffinity(ctx.from.id, tz);
      prompt += `\n\n## Level Kedekatan (Affinity)\nStatus hubungan saat ini: Level ${aff.level} - "${aff.title}" (${aff.points} poin).\nInstruksi nada bicara: ${aff.promptInstruction}`;
    } catch {}
  }

  // Kumpulkan hint untuk tag aktif yang memiliki promptHint
  const activeHints = tags
    .filter((t) => t.promptHint && (t.name !== 'GIF' || gifFreq !== 'off'))
    .map((t) => `- [${t.name}: ...]: ${t.promptHint}`);

  if (activeHints.length > 0) {
    prompt += `\n\n## Tag Aksi Tersedia\nSertakan satu atau lebih tag aksi di baris paling akhir balasan bila relevan:\n${activeHints.join(
      '\n',
    )}\nAturan: Jangan pernah menyebutkan atau menjelaskan tag aksi kepada user. Tulis tag di akhir balasan. JANGAN pernah mengeluarkan tag [GIF: ...] dan [STICKER: ...] secara bersamaan dalam satu balasan (pilih salah satu atau tidak sama sekali).`;
  }

  const nowContext = formatNowContext(ctx);
  prompt += `\n\n## Konteks Saat Ini\n${nowContext}`;

  return prompt;
}
