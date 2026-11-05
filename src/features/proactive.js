import {
  parseQuietHours,
  getProactiveSettings,
  setProactiveEnabled,
  setQuietHours,
} from '../core/proactive.js';

export default {
  id: 'proactive',

  commands: [
    {
      name: 'proactive',
      description: 'Atur bot untuk chat duluan saat kamu lama tidak aktif (on/off)',
      handler: async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) return;

        const text = ctx.message?.text ?? '';
        const parts = text.split(/\s+/).slice(1);
        const action = parts[0]?.toLowerCase();

        if (action === 'on') {
          setProactiveEnabled(userId, 1);
          const msg =
            ctx.persona?.strings?.proactiveEnabled ??
            'Chat proaktif diaktifkan! Kalau kamu lama nggak muncul, aku bakal nyapa duluan. B-bukan berarti aku kesepian ya! 😤';
          await ctx.reply(msg);
          return;
        }

        if (action === 'off') {
          setProactiveEnabled(userId, 0);
          const msg =
            ctx.persona?.strings?.proactiveDisabled ??
            'Chat proaktif dimatikan. Terserah deh, aku nggak bakal nyapa duluan lagi! 🙄';
          await ctx.reply(msg);
          return;
        }

        // Tampilkan status terkini
        const s = getProactiveSettings(userId);
        const statusStr = s.enabled ? '🟢 *Aktif*' : '🔴 *Nonaktif*';
        const unrepliedNote =
          s.unreplied_count >= 3
            ? '\n⚠️ _Bot sedang berhenti chat duluan karena 3 pesan belum kamu balas. Kirim pesan apa saja untuk mengaktifkannya kembali._'
            : '';

        const replyText =
          `🔔 *Pengaturan Chat Proaktif*\n\n` +
          `• Status: ${statusStr}\n` +
          `• Jam Tenang: \`${s.quiet_start}\` s.d. \`${s.quiet_end}\`\n` +
          `• Minimal Tidak Aktif: *${s.min_idle_hours} jam*\n` +
          `• Pesan Belum Dibalas: *${s.unreplied_count}/3*${unrepliedNote}\n\n` +
          `_Perintah:_\n` +
          `• \`/proactive on\` — Aktifkan chat duluan\n` +
          `• \`/proactive off\` — Matikan chat duluan\n` +
          `• \`/quiet 22:00-07:00\` — Atur jam tenang`;

        await ctx.reply(replyText, { parse_mode: 'Markdown' });
      },
    },

    {
      name: 'quiet',
      description: 'Atur rentang jam tenang (misal: /quiet 22:00-07:00)',
      handler: async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) return;

        const text = ctx.message?.text ?? '';
        const rawArg = text.replace(/^\/quiet(@\w+)?/i, '').trim();

        if (!rawArg) {
          const s = getProactiveSettings(userId);
          await ctx.reply(
            `Jam tenang saat ini: \`${s.quiet_start}\` s.d. \`${s.quiet_end}\`.\n\nUntuk mengubah, gunakan format: \`/quiet 22:00-07:00\``,
            { parse_mode: 'Markdown' },
          );
          return;
        }

        const parsed = parseQuietHours(rawArg);
        if (!parsed) {
          const invalidMsg =
            ctx.persona?.strings?.quietHoursInvalid ??
            'Format jam tenang salah! Gunakan format HH:mm-HH:mm, contoh: /quiet 22:00-07:00';
          await ctx.reply(invalidMsg);
          return;
        }

        setQuietHours(userId, parsed.quietStart, parsed.quietEnd);

        const successMsg =
          ctx.persona?.strings?.quietHoursSet
            ?.replace('{start}', parsed.quietStart)
            ?.replace('{end}', parsed.quietEnd) ??
          `Jam tenang berhasil diatur ke *${parsed.quietStart}* s.d. *${parsed.quietEnd}*. Bot tidak akan mengirim sapaan di jam tersebut.`;

        await ctx.reply(successMsg, { parse_mode: 'Markdown' });
      },
    },
  ],
};

