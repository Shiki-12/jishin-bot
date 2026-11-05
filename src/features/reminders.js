import { InlineKeyboard } from 'grammy';
import { getDb } from '../core/db.js';
import { getSetting } from '../core/settings.js';
import {
  parseReminderInput,
  formatReminderTime,
} from '../core/time_parser.js';

const MAX_REMINDERS_PER_USER = 50;
const MAX_TEXT_LENGTH = 500;

function getPersona(ctx) {
  return ctx?.persona ?? { strings: {} };
}

/**
 * Buat baris database pengingat baru.
 */
export function insertReminder({
  chatId,
  userId,
  text,
  dueAt,
  tz,
  repeat = null,
}) {
  const db = getDb();

  // Cek batas pengingat aktif per user
  const countRow = db
    .prepare(
      `SELECT count(*) as c FROM reminders WHERE user_id = ? AND status = 'pending'`,
    )
    .get(userId);

  if (countRow?.c >= MAX_REMINDERS_PER_USER) {
    throw new Error(
      `Batas maksimal ${MAX_REMINDERS_PER_USER} pengingat aktif telah tercapai. Batalkan yang lama terlebih dahulu.`,
    );
  }

  const cleanText = text.slice(0, MAX_TEXT_LENGTH).trim();
  if (!cleanText) {
    throw new Error('Teks pengingat tidak boleh kosong.');
  }

  const info = db
    .prepare(
      `INSERT INTO reminders (chat_id, user_id, text, due_at, tz, repeat, status, created_at, snooze_count)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0)`,
    )
    .run(chatId, userId, cleanText, dueAt, tz, repeat, Date.now());

  return info.lastInsertRowid;
}

export default {
  id: 'reminders',

  commands: [
    {
      name: 'remind',
      description: 'Buat pengingat (contoh: /remind 10m minum obat, /remind 17:30 pulang)',
      handler: async (ctx) => {
        const p = getPersona(ctx);
        const args = ctx.message.text.split(/\s+/).slice(1).join(' ').trim();

        if (!args) {
          await ctx.reply(
            'Format salah! Contoh penggunaan:\n' +
              '• `/remind 10m minum obat`\n' +
              '• `/remind 2j cek kompor`\n' +
              '• `/remind 17:30 pulang kerja`\n' +
              '• `/remind besok 07:00 olahraga`\n' +
              '• `/remind tiap hari 06:00 minum vitamin`',
            { parse_mode: 'Markdown' },
          );
          return;
        }

        const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');

        try {
          const { dueAt, repeat, text } = parseReminderInput(args, tz);
          const id = insertReminder({
            chatId: ctx.chat.id,
            userId: ctx.from.id,
            text,
            dueAt,
            tz,
            repeat,
          });

          const timeFormatted = formatReminderTime(dueAt, tz);
          let confirmText = `Oke, kuingatkan pada *${timeFormatted}*:\n"${text}"`;
          if (repeat) {
            confirmText += `\n_(Berulang: ${repeat})_`;
          }

          const template = p.strings?.reminderSet;
          if (template) {
            confirmText = template
              .replace('{time}', timeFormatted)
              .replace('{text}', text);
            if (repeat) confirmText += `\n_(Berulang: ${repeat})_`;
          }

          await ctx.reply(confirmText, { parse_mode: 'Markdown' });
        } catch (err) {
          await ctx.reply(`Gagal membuat pengingat: ${err.message}`);
        }
      },
    },
    {
      name: 'reminders',
      description: 'Lihat daftar pengingat yang sedang aktif',
      handler: async (ctx) => {
        const db = getDb();
        const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');

        const rows = db
          .prepare(
            `SELECT * FROM reminders
             WHERE user_id = ? AND status = 'pending'
             ORDER BY due_at ASC`,
          )
          .all(ctx.from.id);

        if (rows.length === 0) {
          await ctx.reply('Kamu tidak memiliki pengingat aktif saat ini.');
          return;
        }

        const lines = ['📋 *Daftar Pengingat Aktif:*', ''];
        const keyboard = new InlineKeyboard();

        for (const rem of rows) {
          const timeStr = formatReminderTime(rem.due_at, tz);
          const repeatStr = rem.repeat ? ` [${rem.repeat}]` : '';
          lines.push(`• *#${rem.id}* (${timeStr}${repeatStr}):\n  ${rem.text}`);
          keyboard.text(`❌ Batal #${rem.id}`, `rem:cancel:${rem.id}`).row();
        }

        await ctx.reply(lines.join('\n'), {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      },
    },
    {
      name: 'cancel',
      description: 'Batalkan pengingat berdasarkan ID (contoh: /cancel 12)',
      handler: async (ctx) => {
        const p = getPersona(ctx);
        const args = ctx.message.text.split(/\s+/).slice(1);
        const targetId = Number(args[0]);

        if (!targetId || isNaN(targetId)) {
          await ctx.reply('Sebutkan ID pengingat yang ingin dibatalkan. Contoh: `/cancel 3`', {
            parse_mode: 'Markdown',
          });
          return;
        }

        const db = getDb();
        const res = db
          .prepare(
            `UPDATE reminders SET status = 'cancelled'
             WHERE id = ? AND user_id = ? AND status = 'pending'`,
          )
          .run(targetId, ctx.from.id);

        if (res.changes === 0) {
          await ctx.reply(`Pengingat #${targetId} tidak ditemukan atau sudah tidak aktif.`);
          return;
        }

        const msg =
          p.strings?.reminderCancelled?.replace('{id}', targetId) ??
          `Pengingat #${targetId} berhasil dibatalkan.`;
        await ctx.reply(msg);
      },
    },
  ],

  tags: [
    {
      name: 'REMIND',
      minArgs: 2,
      maxArgs: 3,
      maxArgLength: 500,
      promptHint:
        'Buat pengingat waktu user. Format: [REMIND: <ISO 8601 dengan offset> | <tugas> | <ulang atau none>]. Contoh: [REMIND: 2026-11-05T07:00:00+07:00 | minum obat | none]. Hanya sertakan jika user secara jelas meminta diingatkan.',
      handle: async (ctx, args) => {
        const isoString = args[0];
        const taskText = args[1];
        const repeatVal = args[2] && args[2].toLowerCase() !== 'none' ? args[2] : null;

        const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
        const dueAt = Date.parse(isoString);

        if (isNaN(dueAt)) {
          console.warn(`Tag REMIND menerima ISO date tidak valid: ${isoString}`);
          return;
        }

        try {
          const id = insertReminder({
            chatId: ctx.chat.id,
            userId: ctx.from.id,
            text: taskText,
            dueAt,
            tz,
            repeat: repeatVal,
          });

          // Kirim konfirmasi deterministik (aturan umum no. 5)
          const timeFormatted = formatReminderTime(dueAt, tz);
          let confirm = `🔔 *Pengingat Dibuat (#${id})*\nWaktu: ${timeFormatted}\nTugas: ${taskText}`;
          if (repeatVal) confirm += `\nBerulang: ${repeatVal}`;

          await ctx.reply(confirm, { parse_mode: 'Markdown' });
        } catch (err) {
          console.error('Gagal memproses tag REMIND:', err.message);
        }
      },
    },
  ],

  callbacks: [
    {
      prefix: 'rem:',
      handler: async (ctx) => {
        const data = ctx.callbackQuery.data; // rem:snz10:<id>, rem:snz60:<id>, rem:done:<id>, rem:cancel:<id>
        const parts = data.split(':');
        const action = parts[1];
        const remId = Number(parts[2]);

        const db = getDb();
        const now = Date.now();

        if (action === 'snz10' || action === 'snz60') {
          const addMs = action === 'snz10' ? 10 * 60_000 : 60 * 60_000;
          const label = action === 'snz10' ? '10 menit' : '1 jam';

          const res = db
            .prepare(
              `UPDATE reminders
               SET status = 'pending', due_at = ?, snooze_count = snooze_count + 1
               WHERE id = ?`,
            )
            .run(now + addMs, remId);

          if (res.changes > 0) {
            await ctx.answerCallbackQuery({ text: `Ditunda ${label}.` }).catch(() => {});
            await ctx.editMessageText(
              ctx.callbackQuery.message.text + `\n\n⏳ _(Ditunda ${label})_`,
              { parse_mode: 'Markdown' },
            ).catch(() => {});
          } else {
            await ctx.answerCallbackQuery({ text: 'Pengingat tidak ditemukan.' }).catch(() => {});
          }
          return;
        }

        if (action === 'done') {
          db.prepare(
            `UPDATE reminders SET status = 'sent', last_sent_at = ? WHERE id = ?`,
          ).run(now, remId);

          await ctx.answerCallbackQuery({ text: 'Pengingat selesai!' }).catch(() => {});
          await ctx.editMessageText(
            ctx.callbackQuery.message.text + '\n\n✅ _(Selesai)_',
            { parse_mode: 'Markdown' },
          ).catch(() => {});
          return;
        }

        if (action === 'cancel') {
          db.prepare(
            `UPDATE reminders SET status = 'cancelled' WHERE id = ?`,
          ).run(remId);

          await ctx.answerCallbackQuery({ text: `Pengingat #${remId} dibatalkan.` }).catch(() => {});
          await ctx.deleteMessage().catch(() => {});
        }
      },
    },
  ],
};

