import { getSetting } from '../core/settings.js';
import { getAffinity, getLevelInfo } from '../core/affinity.js';

function getPersona(ctx) {
  return ctx?.persona ?? { strings: {} };
}

export function buildProgressBar(points, minPoints, nextThreshold) {
  if (nextThreshold === null) {
    return '`[██████████]` *(Level Maksimal)*';
  }

  const span = Math.max(1, nextThreshold - minPoints);
  const currentInLevel = Math.max(0, points - minPoints);
  const fraction = Math.min(1, Math.max(0, currentInLevel / span));
  const filledBlocks = Math.round(fraction * 10);
  const emptyBlocks = 10 - filledBlocks;

  const bar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
  return `\`[${bar}]\` *${points}/${nextThreshold}* poin`;
}

export function renderStatusCard(aff, persona) {
  const p = persona ?? { strings: {} };
  const info = getLevelInfo(aff.level);
  const bar = buildProgressBar(aff.points, info.minPoints, aff.nextThreshold);

  const statusQuotes = p.strings?.affinityStatus ?? [
    'Kita masih orang asing.',
    'Mulai sering mengobrol ya.',
    'Aku mulai terbiasa dengan kehadiranmu.',
    'Kamu salah satu orang terdekatku.',
    'Kamu orang yang paling berharga untukku.',
  ];

  const quote = statusQuotes[aff.level] ?? statusQuotes[0];

  const lines = [
    `💖 *Status Hubungan & Kedekatan:*`,
    '',
    `• Level: *${aff.level}* — *"${aff.title}"*`,
    `• Total Poin: *${aff.points}* poin`,
    `• Progres Level: ${bar}`,
    `• Poin Hari Ini: *${aff.gainedToday}/${aff.dailyCap}* poin`,
    '',
    `"${quote}"`,
  ];

  return lines.join('\n');
}

export default {
  id: 'affinity',

  commands: [
    {
      name: 'status',
      description: 'Lihat level kedekatan (affinity) dan progres hubunganmu dengan bot',
      handler: async (ctx) => {
        const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
        const aff = getAffinity(ctx.from.id, tz);
        const persona = getPersona(ctx);

        const cardText = renderStatusCard(aff, persona);
        await ctx.reply(cardText, { parse_mode: 'Markdown' });
      },
    },
  ],
};

