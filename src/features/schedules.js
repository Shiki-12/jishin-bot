import { getDb } from '../core/db.js';
import { getSetting, getEffectiveExpressionMode } from '../core/settings.js';
import { shapeReply } from '../core/expression.js';
import { getZonedParts, zonedPartsToUtcMs } from '../core/time_parser.js';
import { getPersonality } from '../personalities/index.js';
import { getTodayMood } from '../core/moods.js';
import { getWeatherData } from '../core/weather.js';

export function isValidTimeFormat(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return false;
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(timeStr.trim());
}

export function getSchedule(chatId, userId, type) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM schedules WHERE chat_id = ? AND user_id = ? AND type = ?`,
    )
    .get(chatId, userId, type);
}

export function getAllUserSchedules(chatId, userId) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM schedules WHERE chat_id = ? AND user_id = ?`)
    .all(chatId, userId);
}

export function setSchedule({ chatId, userId, type, time, tz = 'Asia/Jakarta', now = Date.now() }) {
  const cleanTime = time.trim();
  const [hour, minute] = cleanTime.split(':').map(Number);
  const db = getDb();

  const parts = getZonedParts(new Date(now), tz);
  const curDateStr = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const todaySchedMs = zonedPartsToUtcMs(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour,
      minute,
      second: 0,
    },
    tz,
  );

  // Jika jam yang diatur sudah lewat untuk hari ini, set last_run_date = curDateStr
  // supaya tidak langsung memicu pesan hari ini yang sudah terlewat
  const initialLastRunDate = now >= todaySchedMs ? curDateStr : null;

  db.prepare(
    `INSERT INTO schedules (chat_id, user_id, type, time, tz, status, last_run_date, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT(chat_id, user_id, type) DO UPDATE SET
       time = excluded.time,
       tz = excluded.tz,
       status = 'active',
       last_run_date = excluded.last_run_date`,
  ).run(chatId, userId, type, cleanTime, tz, initialLastRunDate, now);

  return { type, time: cleanTime, tz, lastRunDate: initialLastRunDate };
}

export function disableSchedule({ chatId, userId, type }) {
  const db = getDb();
  const res = db
    .prepare(
      `UPDATE schedules SET status = 'disabled'
       WHERE chat_id = ? AND user_id = ? AND type = ?`,
    )
    .run(chatId, userId, type);
  return res.changes > 0;
}

export function buildMorningMessage({ userId, tz = 'Asia/Jakarta', persona, now = Date.now(), weatherSummary = null, exprMode = null }) {
  const db = getDb();
  const p = persona ?? { strings: {} };
  const parts = getZonedParts(new Date(now), tz);

  const startOfDayMs = zonedPartsToUtcMs(
    { year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0, second: 0 },
    tz,
  );
  const endOfDayMs =
    zonedPartsToUtcMs(
      { year: parts.year, month: parts.month, day: parts.day, hour: 23, minute: 59, second: 59 },
      tz,
    ) + 1000;

  // 1. Ambil pengingat hari ini
  const todayReminders = db
    .prepare(
      `SELECT * FROM reminders
       WHERE user_id = ? AND status = 'pending' AND due_at >= ? AND due_at < ?
       ORDER BY due_at ASC`,
    )
    .all(userId, startOfDayMs, endOfDayMs);

  // 2. Ambil to-do belum selesai
  const pendingTodos = db
    .prepare(
      `SELECT * FROM todos
       WHERE user_id = ? AND done = 0
       ORDER BY id ASC
       LIMIT 5`,
    )
    .all(userId);

  // 3. Susun salam acak
  const greetings = p.strings?.morningGreetings ?? [
    'Pagi! Bangun napa, jangan molor terus! (¬_¬)',
    'Hei, udah pagi! B-bukan berarti aku nungguin kamu bangun ya! 🙄',
    'Pagi... Jangan malas-malasan hari ini, awas aja kalau kerjaanmu keteteran!',
  ];
  const rawGreeting = greetings[Math.floor(Math.random() * greetings.length)];
  const effectiveMode = exprMode ?? getEffectiveExpressionMode({ chat: { type: 'private', id: userId }, from: { id: userId } });
  const greeting = shapeReply(rawGreeting, { mode: effectiveMode, persona: p.id || 'tsundere' });

  const lines = [greeting, ''];

  // 4. Bagian pengingat
  if (todayReminders.length > 0) {
    lines.push(p.strings?.morningRemindersHeader ?? '📋 *Jadwal pengingat kamu hari ini:*');
    todayReminders.forEach((r) => {
      const rParts = getZonedParts(new Date(r.due_at), tz);
      const timeStr = `${String(rParts.hour).padStart(2, '0')}:${String(rParts.minute).padStart(2, '0')}`;
      lines.push(`• \`${timeStr}\` - ${r.text}`);
    });
  } else {
    lines.push(p.strings?.morningNoReminders ?? 'Hari ini kamu nggak punya jadwal pengingat khusus.');
  }

  lines.push('');

  // 5. Bagian to-do
  if (pendingTodos.length > 0) {
    lines.push(p.strings?.morningTodosHeader ?? '📝 *To-do yang belum selesai:*');
    pendingTodos.forEach((t, idx) => {
      lines.push(`• ${t.text}`);
    });
  } else {
    lines.push(p.strings?.morningAllTodosDone ?? 'Semua to-do kamu beres, lumayan rajin ya. 😳');
  }

  // 6. Bagian cuaca (jika disediakan)
  if (weatherSummary) {
    lines.push('');
    lines.push('🌤️ *Prakiraan Cuaca Hari Ini:*');
    lines.push(weatherSummary);
  }

  return lines.join('\n');
}

export function buildNightMessage({ userId, tz = 'Asia/Jakarta', persona, now = Date.now(), exprMode = null }) {
  const db = getDb();
  const p = persona ?? { strings: {} };
  const parts = getZonedParts(new Date(now), tz);

  const startOfDayMs = zonedPartsToUtcMs(
    { year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0, second: 0 },
    tz,
  );
  const endOfDayMs =
    zonedPartsToUtcMs(
      { year: parts.year, month: parts.month, day: parts.day, hour: 23, minute: 59, second: 59 },
      tz,
    ) + 1000;

  // 1. Ambil to-do yang selesai hari ini
  const doneTodayRow = db
    .prepare(
      `SELECT count(*) as count FROM todos
       WHERE user_id = ? AND done = 1 AND done_at >= ? AND done_at < ?`,
    )
    .get(userId, startOfDayMs, endOfDayMs);
  const doneTodayCount = doneTodayRow?.count ?? 0;

  // 2. Ambil to-do yang masih pending
  const pendingRow = db
    .prepare(`SELECT count(*) as count FROM todos WHERE user_id = ? AND done = 0`)
    .get(userId);
  const pendingCount = pendingRow?.count ?? 0;

  // 3. Susun salam acak
  const greetings = p.strings?.nightGreetings ?? [
    'Udah malam gini belum tidur juga? Jangan begadang terus, bodoh! (>_<)',
    'Malam... Masih bangun aja. Kerjaan hari ini udah kelar belum? 🙄',
    'Hei, udah larut malam nih. B-bukan berarti aku peduli kesehatanmu ya! (^///^)',
  ];
  const rawGreeting = greetings[Math.floor(Math.random() * greetings.length)];
  const effectiveMode = exprMode ?? getEffectiveExpressionMode({ chat: { type: 'private', id: userId }, from: { id: userId } });
  const greeting = shapeReply(rawGreeting, { mode: effectiveMode, persona: p.id || 'tsundere' });

  const lines = [greeting, ''];

  // 4. Ringkasan to-do
  if (doneTodayCount > 0) {
    const template =
      p.strings?.nightTodosCompleted ??
      'Bagus, hari ini kamu berhasil nyelesaiin {count} to-do!';
    lines.push(template.replace('{count}', doneTodayCount));
  } else {
    lines.push(
      p.strings?.nightNoTodosCompleted ??
        'Hari ini nggak ada to-do yang kamu selesaikan. Santai banget ya! 🙄',
    );
  }

  if (pendingCount > 0) {
    const template =
      p.strings?.nightPendingTodos ?? 'Masih ada {count} to-do yang belum beres buat besok.';
    lines.push(template.replace('{count}', pendingCount));
  }

  lines.push('');
  lines.push(p.strings?.nightCheckin ?? 'Gimana harimu hari ini? Istirahat sana, besok lanjut lagi.');

  try {
    const todayMood = getTodayMood(userId, tz, now);
    if (!todayMood) {
      lines.push('\n💭 _Luangkan waktu sejenak untuk check-in perasaanmu malam ini: ketik_ `/mood`.');
    }
  } catch {}

  return lines.join('\n');
}

export async function processDailySchedules(bot, now = Date.now()) {
  const db = getDb();
  const schedules = db
    .prepare(`SELECT * FROM schedules WHERE status = 'active'`)
    .all();

  if (schedules.length === 0) return 0;

  let dispatchedCount = 0;

  for (const s of schedules) {
    const parts = getZonedParts(new Date(now), s.tz);
    const curDateStr = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;

    if (s.last_run_date === curDateStr) {
      continue;
    }

    const [hour, minute] = s.time.split(':').map(Number);
    const todaySchedMs = zonedPartsToUtcMs(
      {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour,
        minute,
        second: 0,
      },
      s.tz,
    );

    if (now < todaySchedMs) {
      // Belum waktunya
      continue;
    }

    // Jika sudah lewat lebih dari 2 jam dari jadwal, lewati untuk hari ini agar tidak mengirim sapaan basi
    if (now > todaySchedMs + 2 * 3600_000) {
      db.prepare(`UPDATE schedules SET last_run_date = ? WHERE id = ?`).run(
        curDateStr,
        s.id,
      );
      continue;
    }

    // Lock baris dengan mengupdate last_run_date secara idempoten
    const lock = db
      .prepare(
        `UPDATE schedules
         SET last_run_date = ?
         WHERE id = ? AND status = 'active' AND (last_run_date IS NULL OR last_run_date != ?)`,
      )
      .run(curDateStr, s.id, curDateStr);

    if (lock.changes === 0) {
      continue;
    }

    let persona;
    try {
      persona = getPersonality(process.env.PERSONALITY || 'tsundere');
    } catch {
      persona = { strings: {} };
    }

    let messageText;
    const exprMode = getEffectiveExpressionMode({
      chat: { type: 'private', id: s.user_id },
      from: { id: s.user_id },
    });

    if (s.type === 'morning') {
      let weatherSummary = null;
      try {
        const userCity = getSetting(
          { chat: { type: 'private' }, from: { id: s.user_id } },
          'city',
          null,
        );
        if (userCity) {
          const w = await getWeatherData(userCity);
          if (w) {
            weatherSummary = `• Di *${w.city}*: ${w.conditionText}, suhu ${w.temp}°C (peluang hujan ${w.rainProb}%).`;
          }
        }
      } catch {}

      messageText = buildMorningMessage({
        userId: s.user_id,
        tz: s.tz,
        persona,
        now,
        weatherSummary,
        exprMode,
      });
    } else if (s.type === 'night') {
      messageText = buildNightMessage({
        userId: s.user_id,
        tz: s.tz,
        persona,
        now,
        exprMode,
      });
    }

    if (!messageText) continue;

    try {
      if (bot?.api?.sendMessage) {
        await bot.api.sendMessage(s.chat_id, messageText, {
          parse_mode: 'Markdown',
        });
      }
      dispatchedCount++;
    } catch (err) {
      console.error(
        `Gagal mengirim pesan terjadwal ${s.type} ke chat ${s.chat_id}:`,
        err.message,
      );

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
        db.prepare(`UPDATE schedules SET status = 'disabled' WHERE id = ?`).run(
          s.id,
        );
      }
    }
  }

  return dispatchedCount;
}

export default {
  id: 'schedules',

  commands: [
    {
      name: 'morning',
      description: 'Atur pesan sapaan & ringkasan pagi (/morning 07:00 atau /morning off)',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const arg = ctx.message.text.split(/\s+/)[1]?.trim();

        if (!arg) {
          const sched = getSchedule(ctx.chat.id, ctx.from.id, 'morning');
          if (!sched || sched.status !== 'active') {
            await ctx.reply(
              'Pesan pagi saat ini *mati*.\nKetik `/morning 07:00` untuk menyalakan jam 07:00.',
              { parse_mode: 'Markdown' },
            );
          } else {
            await ctx.reply(
              `Pesan pagi aktif jam *${sched.time}* (${sched.tz}).\nKetik \`/morning off\` untuk mematikan.`,
              { parse_mode: 'Markdown' },
            );
          }
          return;
        }

        if (arg.toLowerCase() === 'off') {
          disableSchedule({
            chatId: ctx.chat.id,
            userId: ctx.from.id,
            type: 'morning',
          });
          const replyText =
            p.strings?.scheduleOff?.replace('{type}', 'pagi') ??
            'Jadwal pesan pagi sudah dimatikan.';
          await ctx.reply(replyText);
          return;
        }

        if (!isValidTimeFormat(arg)) {
          await ctx.reply('Format jam tidak valid! Gunakan format HH:mm (contoh: `/morning 07:00`)', {
            parse_mode: 'Markdown',
          });
          return;
        }

        const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
        setSchedule({
          chatId: ctx.chat.id,
          userId: ctx.from.id,
          type: 'morning',
          time: arg,
          tz,
        });

        const replyTemplate =
          p.strings?.scheduleSet ??
          'Jadwal pesan {type} berhasil diatur pada jam *{time}* ({tz}).';
        const replyText = replyTemplate
          .replace('{type}', 'pagi')
          .replace('{time}', arg)
          .replace('{tz}', tz);

        await ctx.reply(replyText, { parse_mode: 'Markdown' });
      },
    },
    {
      name: 'night',
      description: 'Atur pesan sapaan & ringkasan malam (/night 22:30 atau /night off)',
      handler: async (ctx) => {
        const p = ctx.persona ?? { strings: {} };
        const arg = ctx.message.text.split(/\s+/)[1]?.trim();

        if (!arg) {
          const sched = getSchedule(ctx.chat.id, ctx.from.id, 'night');
          if (!sched || sched.status !== 'active') {
            await ctx.reply(
              'Pesan malam saat ini *mati*.\nKetik `/night 22:30` untuk menyalakan jam 22:30.',
              { parse_mode: 'Markdown' },
            );
          } else {
            await ctx.reply(
              `Pesan malam aktif jam *${sched.time}* (${sched.tz}).\nKetik \`/night off\` untuk mematikan.`,
              { parse_mode: 'Markdown' },
            );
          }
          return;
        }

        if (arg.toLowerCase() === 'off') {
          disableSchedule({
            chatId: ctx.chat.id,
            userId: ctx.from.id,
            type: 'night',
          });
          const replyText =
            p.strings?.scheduleOff?.replace('{type}', 'malam') ??
            'Jadwal pesan malam sudah dimatikan.';
          await ctx.reply(replyText);
          return;
        }

        if (!isValidTimeFormat(arg)) {
          await ctx.reply('Format jam tidak valid! Gunakan format HH:mm (contoh: `/night 22:30`)', {
            parse_mode: 'Markdown',
          });
          return;
        }

        const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
        setSchedule({
          chatId: ctx.chat.id,
          userId: ctx.from.id,
          type: 'night',
          time: arg,
          tz,
        });

        const replyTemplate =
          p.strings?.scheduleSet ??
          'Jadwal pesan {type} berhasil diatur pada jam *{time}* ({tz}).';
        const replyText = replyTemplate
          .replace('{type}', 'malam')
          .replace('{time}', arg)
          .replace('{tz}', tz);

        await ctx.reply(replyText, { parse_mode: 'Markdown' });
      },
    },
    {
      name: 'schedules',
      description: 'Lihat status jadwal pesan pagi & malam terjadwal',
      handler: async (ctx) => {
        const rows = getAllUserSchedules(ctx.chat.id, ctx.from.id);
        const morning = rows.find((r) => r.type === 'morning');
        const night = rows.find((r) => r.type === 'night');

        const morningStatus =
          morning && morning.status === 'active'
            ? `Aktif jam *${morning.time}* (${morning.tz})`
            : 'Mati (`/morning 07:00`)';

        const nightStatus =
          night && night.status === 'active'
            ? `Aktif jam *${night.time}* (${night.tz})`
            : 'Mati (`/night 22:30`)';

        const text =
          `⏰ *Jadwal Pesan Terjadwal:*\n\n` +
          `• 🌅 *Pagi:* ${morningStatus}\n` +
          `• 🌙 *Malam:* ${nightStatus}\n\n` +
          `_Ketik \`/morning off\` atau \`/night off\` untuk mematikan._`;

        await ctx.reply(text, { parse_mode: 'Markdown' });
      },
    },
  ],
};

