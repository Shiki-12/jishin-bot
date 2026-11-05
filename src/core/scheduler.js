import { InlineKeyboard } from 'grammy';
import { getDb } from './db.js';
import { computeNextDue } from './time_parser.js';
import { getPersonality } from '../personalities/index.js';
import { getEffectiveExpressionMode } from './settings.js';
import { shapeReply } from './expression.js';
import { processDailySchedules } from '../features/schedules.js';
import { processProactiveMessages } from './proactive.js';
import { syncDailyPrayerReminders } from './prayer.js';
import { advancePomodoro } from './timer.js';
import { processHabitReminders } from './habits.js';

let intervalTimer = null;
let isRunning = false;

/**
 * Buat inline keyboard untuk pesan pengingat yang tiba.
 */
export function buildReminderKeyboard(reminderId) {
  return new InlineKeyboard()
    .text('⏳ Tunda 10m', `rem:snz10:${reminderId}`)
    .text('⌛ Tunda 1j', `rem:snz60:${reminderId}`)
    .row()
    .text('✅ Selesai', `rem:done:${reminderId}`);
}

/**
 * Proses batch pengingat yang jatuh tempo (dapat dipanggil manual untuk testing).
 */
export async function processPendingReminders(bot, now = Date.now()) {
  const db = getDb();

  // 1. Ambil maksimal 50 pengingat yang pending & jatuh tempo
  const rows = db
    .prepare(
      `SELECT * FROM reminders
       WHERE status = 'pending' AND due_at <= ?
       ORDER BY due_at ASC
       LIMIT 50`,
    )
    .all(now);

  if (rows.length === 0) return 0;

  let processedCount = 0;

  for (const reminder of rows) {
    // 2. Kunci (lock) baris secara idempoten agar tidak dikirim ganda
    const lock = db
      .prepare(
        `UPDATE reminders SET status = 'processing'
         WHERE id = ? AND status = 'pending'`,
      )
      .run(reminder.id);

    if (lock.changes === 0) {
      // Baris sudah diambil oleh proses lain
      continue;
    }

    // 3. Susun teks pesan
    const isSpecial =
      reminder.text.startsWith('🕌') ||
      reminder.text.startsWith('⏱️') ||
      reminder.text.startsWith('🍅') ||
      reminder.text.startsWith('☕') ||
      reminder.text.startsWith('🎉') ||
      reminder.repeat === 'timer' ||
      reminder.repeat?.startsWith('pomodoro:');
    let text;
    let keyboard;

    if (isSpecial) {
      text = reminder.text;
      keyboard = null;
    } else {
      let persona;
      try {
        persona = getPersonality(process.env.PERSONALITY || 'tsundere');
      } catch {
        persona = { strings: {} };
      }

      const template =
        persona.strings?.reminderFired ??
        'Hei bodoh, waktunya: {text}. B-bukan berarti aku peduli ya! (¬_¬)';
      const rawReminderText = template.replace('{text}', reminder.text);
      const exprMode = getEffectiveExpressionMode({
        chat: { id: reminder.chat_id, type: reminder.chat_id < 0 ? 'group' : 'private' },
        from: { id: reminder.user_id },
      });
      text = shapeReply(rawReminderText, {
        mode: exprMode,
        persona: persona.id || 'tsundere',
      });
      keyboard = buildReminderKeyboard(reminder.id);

      // Jika pengingat dibuat di grup (chat_id < 0), sebut pembuatnya
      if (reminder.chat_id < 0) {
        let name = 'kamu';
        try {
          const userRow = db
            .prepare('SELECT first_name, username FROM users WHERE id = ?')
            .get(reminder.user_id);
          if (userRow?.first_name) {
            name = userRow.first_name;
          } else if (userRow?.username) {
            name = `@${userRow.username}`;
          }
        } catch {}
        text = `🔔 *Pengingat untuk [${name}](tg://user?id=${reminder.user_id}):*\n${text}`;
      }
    }

    // Keterangan jika terlewat (misal setelah bot restart)
    const lateMinutes = Math.floor((now - reminder.due_at) / 60_000);
    if (lateMinutes >= 2) {
      text += `\n_(telat ${lateMinutes} menit)_`;
    }

    // 4. Kirim pesan ke Telegram
    try {
      if (bot?.api?.sendMessage) {
        const sendOptions = { parse_mode: 'Markdown' };
        if (keyboard) {
          sendOptions.reply_markup = keyboard;
        }
        await bot.api.sendMessage(reminder.chat_id, text, sendOptions);
      }

      // 5. Tangani pengulangan (repeat) jika ada
      if (reminder.repeat?.startsWith('pomodoro:')) {
        advancePomodoro(reminder, now);
        db.prepare(
          `UPDATE reminders
           SET status = 'sent', last_sent_at = ?
           WHERE id = ?`,
        ).run(now, reminder.id);
      } else if (reminder.repeat === 'timer') {
        db.prepare(
          `UPDATE reminders
           SET status = 'sent', last_sent_at = ?
           WHERE id = ?`,
        ).run(now, reminder.id);
      } else if (reminder.repeat && reminder.repeat !== 'none') {
        const nextDue = computeNextDue(
          reminder.due_at,
          reminder.repeat,
          reminder.tz,
          now,
        );

        if (nextDue) {
          db.prepare(
            `UPDATE reminders
             SET status = 'pending', due_at = ?, last_sent_at = ?, snooze_count = 0
             WHERE id = ?`,
          ).run(nextDue, now, reminder.id);
        } else {
          db.prepare(
            `UPDATE reminders
             SET status = 'sent', last_sent_at = ?
             WHERE id = ?`,
          ).run(now, reminder.id);
        }
      } else {
        db.prepare(
          `UPDATE reminders
           SET status = 'sent', last_sent_at = ?
           WHERE id = ?`,
        ).run(now, reminder.id);
      }

      processedCount++;
    } catch (err) {
      console.error(
        `Gagal mengirim pengingat #${reminder.id} ke chat ${reminder.chat_id}:`,
        err.message,
      );

      // Tangani error permanen (bot diblokir user / chat not found / 403 / 400)
      const errMsg = `${err.description || ''} ${err.message || ''}`.toLowerCase();
      const isBlocked =
        err.error_code === 403 ||
        err.error_code === 400 ||
        errMsg.includes('blocked') ||
        errMsg.includes('chat not found') ||
        errMsg.includes('user is deactivated') ||
        errMsg.includes('forbidden') ||
        errMsg.includes('bad request');

      if (isBlocked) {
        // Tandai failed dan jangan coba lagi
        db.prepare(
          `UPDATE reminders SET status = 'failed' WHERE id = ?`,
        ).run(reminder.id);
      } else {
        // Rollback status ke pending jika temporary error
        db.prepare(
          `UPDATE reminders SET status = 'pending' WHERE id = ?`,
        ).run(reminder.id);
      }
    }
  }

  return processedCount;
}

/**
 * Mulai scheduler interval loop.
 */
export function startScheduler({ bot, intervalMs = 15_000 } = {}) {
  if (intervalTimer) return;

  isRunning = true;
  intervalTimer = setInterval(async () => {
    if (!isRunning) return;
    try {
      await processPendingReminders(bot);
      await processDailySchedules(bot);
      await processProactiveMessages(bot);
      await syncDailyPrayerReminders(bot);
      await processHabitReminders(bot);
    } catch (err) {
      console.error('Error di scheduler loop:', err);
    }
  }, intervalMs);

  // Jalankan segera sekali di awal untuk memproses pengingat tertunda saat bot baru hidup
  processPendingReminders(bot).catch(() => {});
  processDailySchedules(bot).catch(() => {});
  processProactiveMessages(bot).catch(() => {});
  syncDailyPrayerReminders(bot).catch(() => {});
  processHabitReminders(bot).catch(() => {});
}

/**
 * Hentikan scheduler loop saat shutdown.
 */
export function stopScheduler() {
  isRunning = false;
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}

