/**
 * Parser waktu dan repeat untuk fitur pengingat (F-10).
 * Menggunakan Intl bawaan Node.js tanpa dependensi eksternal.
 */

const DAY_MAP = {
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5,
  sabtu: 6,
  minggu: 7,
};

/**
 * Ekstraksi komponen tanggal & jam sesuai zona waktu tertentu.
 */
export function getZonedParts(date = new Date(), tz = 'Asia/Jakarta') {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((p) => [p.type, p.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * Konversi komponen waktu lokal pada timezone tertentu ke UTC epoch milidetik.
 */
export function zonedPartsToUtcMs(
  { year, month, day, hour = 0, minute = 0, second = 0 },
  tz = 'Asia/Jakarta',
) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const inTz = getZonedParts(guess, tz);
  const inTzDate = new Date(
    Date.UTC(inTz.year, inTz.month - 1, inTz.day, inTz.hour, inTz.minute, inTz.second),
  );
  const offset = inTzDate.getTime() - guess.getTime();
  return guess.getTime() - offset;
}

/**
 * Tambah hari ke objek zoned parts.
 */
function addDays(parts, days) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/**
 * Hitung kemunculan pengingat berikutnya strictly setelah nowMs.
 */
export function computeNextDue(dueAt, repeat, tz = 'Asia/Jakarta', nowMs = Date.now()) {
  if (!repeat || repeat === 'none') return null;

  if (repeat.startsWith('every:')) {
    const sec = Number(repeat.slice('every:'.length));
    if (isNaN(sec) || sec <= 0) return null;
    const stepMs = sec * 1000;
    let next = dueAt + stepMs;
    while (next <= nowMs) {
      next += stepMs;
    }
    return next;
  }

  if (repeat === 'daily') {
    let candidate = new Date(dueAt);
    while (candidate.getTime() <= nowMs) {
      const parts = getZonedParts(candidate, tz);
      const nextParts = addDays(parts, 1);
      candidate = new Date(zonedPartsToUtcMs(nextParts, tz));
    }
    return candidate.getTime();
  }

  if (repeat.startsWith('weekly:')) {
    let candidate = new Date(dueAt);
    while (candidate.getTime() <= nowMs) {
      const parts = getZonedParts(candidate, tz);
      const nextParts = addDays(parts, 7);
      candidate = new Date(zonedPartsToUtcMs(nextParts, tz));
    }
    return candidate.getTime();
  }

  if (repeat.startsWith('monthly:')) {
    const targetDay = Number(repeat.slice('monthly:'.length));
    let candidate = new Date(dueAt);
    while (candidate.getTime() <= nowMs) {
      const parts = getZonedParts(candidate, tz);
      let nextMonth = parts.month + 1;
      let nextYear = parts.year;
      if (nextMonth > 12) {
        nextMonth = 1;
        nextYear += 1;
      }
      const nextParts = {
        year: nextYear,
        month: nextMonth,
        day: targetDay,
        hour: parts.hour,
        minute: parts.minute,
        second: parts.second,
      };
      candidate = new Date(zonedPartsToUtcMs(nextParts, tz));
    }
    return candidate.getTime();
  }

  return null;
}

/**
 * Format timestamp ke tampilan teks user-friendly dalam bahasa Indonesia.
 */
export function formatReminderTime(epochMs, tz = 'Asia/Jakarta') {
  const formatter = new Intl.DateTimeFormat('id-ID', {
    timeZone: tz,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
  return formatter.format(new Date(epochMs));
}

/**
 * Parse teks perintah /remind atau argumen tag natural menjadi { dueAt, repeat, text }.
 */
export function parseReminderInput(rawInput, tz = 'Asia/Jakarta', now = Date.now()) {
  if (!rawInput || typeof rawInput !== 'string') {
    throw new Error('Format perintah pengingat tidak boleh kosong.');
  }

  const str = rawInput.trim();
  const nowParts = getZonedParts(new Date(now), tz);

  // 1. Cek format ISO 8601 lengkap (biasanya dari tag [REMIND: ISO | teks | repeat])
  const isoMatch = str.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\s*(.*)$/i,
  );
  if (isoMatch) {
    const dueAt = Date.parse(isoMatch[1]);
    if (isNaN(dueAt)) throw new Error('Format ISO 8601 tidak valid.');
    if (dueAt < now - 60_000) {
      throw new Error('Waktu pengingat sudah terlewat di masa lalu.');
    }
    const text = isoMatch[2].trim();
    return { dueAt, repeat: null, text };
  }

  // 2. Berulang: tiap hari HH:mm
  const tiapHariMatch = str.match(/^tiap\s+hari\s+(\d{1,2}):(\d{2})\s*(.*)$/i);
  if (tiapHariMatch) {
    const hour = Number(tiapHariMatch[1]);
    const minute = Number(tiapHariMatch[2]);
    const text = tiapHariMatch[3].trim();
    if (hour > 23 || minute > 59) throw new Error('Jam atau menit tidak valid.');

    let targetParts = { ...nowParts, hour, minute, second: 0 };
    let dueAt = zonedPartsToUtcMs(targetParts, tz);
    if (dueAt <= now + 60_000) {
      targetParts = addDays(targetParts, 1);
      dueAt = zonedPartsToUtcMs(targetParts, tz);
    }
    return { dueAt, repeat: 'daily', text };
  }

  // 3. Berulang: tiap [senin..minggu] HH:mm
  const tiapHariTertentuMatch = str.match(
    /^tiap\s+(senin|selasa|rabu|kamis|jumat|sabtu|minggu)\s+(\d{1,2}):(\d{2})\s*(.*)$/i,
  );
  if (tiapHariTertentuMatch) {
    const dayName = tiapHariTertentuMatch[1].toLowerCase();
    const targetWeekday = DAY_MAP[dayName];
    const hour = Number(tiapHariTertentuMatch[2]);
    const minute = Number(tiapHariTertentuMatch[3]);
    const text = tiapHariTertentuMatch[4].trim();

    if (hour > 23 || minute > 59) throw new Error('Jam atau menit tidak valid.');

    // Hitung weekday hari ini di tz
    const todayZoned = new Date(zonedPartsToUtcMs(nowParts, tz));
    // getUTCDay(): 0=Sun, 1=Mon... ubah ke 1=Mon .. 7=Sun
    const currentWeekday = todayZoned.getUTCDay() === 0 ? 7 : todayZoned.getUTCDay();

    let diff = targetWeekday - currentWeekday;
    let targetParts = addDays(nowParts, diff);
    targetParts.hour = hour;
    targetParts.minute = minute;
    targetParts.second = 0;

    let dueAt = zonedPartsToUtcMs(targetParts, tz);
    if (dueAt <= now + 60_000) {
      targetParts = addDays(targetParts, 7);
      dueAt = zonedPartsToUtcMs(targetParts, tz);
    }
    return { dueAt, repeat: `weekly:${targetWeekday}`, text };
  }

  // 4. Berulang: tiap N jam / menit
  const tiapDurasiMatch = str.match(
    /^tiap\s+(\d+)\s*(menit|jam|min|sec|j|m|h|s)\s*(.*)$/i,
  );
  if (tiapDurasiMatch) {
    const count = Number(tiapDurasiMatch[1]);
    const unit = tiapDurasiMatch[2].toLowerCase();
    const text = tiapDurasiMatch[3].trim();

    const isHour = ['j', 'jam', 'h'].includes(unit);
    const sec = isHour ? count * 3600 : count * 60;
    if (sec <= 0) throw new Error('Durasi pengulangan harus lebih dari 0.');

    const dueAt = now + sec * 1000;
    return { dueAt, repeat: `every:${sec}`, text };
  }

  // 5. Berulang: tiap tgl N [HH:mm]
  const tiapTglMatch = str.match(
    /^tiap\s+tgl\s+(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?\s*(.*)$/i,
  );
  if (tiapTglMatch) {
    const targetDay = Number(tiapTglMatch[1]);
    const hour = tiapTglMatch[2] ? Number(tiapTglMatch[2]) : 9;
    const minute = tiapTglMatch[3] ? Number(tiapTglMatch[3]) : 0;
    const text = tiapTglMatch[4].trim();

    if (targetDay < 1 || targetDay > 31) throw new Error('Tanggal tidak valid (1-31).');
    if (hour > 23 || minute > 59) throw new Error('Jam atau menit tidak valid.');

    let targetParts = { ...nowParts, day: targetDay, hour, minute, second: 0 };
    let dueAt = zonedPartsToUtcMs(targetParts, tz);
    if (dueAt <= now + 60_000) {
      let m = nowParts.month + 1;
      let y = nowParts.year;
      if (m > 12) {
        m = 1;
        y += 1;
      }
      targetParts = { year: y, month: m, day: targetDay, hour, minute, second: 0 };
      dueAt = zonedPartsToUtcMs(targetParts, tz);
    }
    return { dueAt, repeat: `monthly:${targetDay}`, text };
  }

  // 6. Relatif gabungan (misal 1j 30m, 10m, 2j, 30 detik)
  const relativeRegex = /^((?:\d+\s*(?:menit|detik|jam|min|sec|j|m|d|h|s)\s*)+)(.*)$/i;
  const relMatch = str.match(relativeRegex);
  if (relMatch) {
    const relTokens = relMatch[1];
    const text = relMatch[2].trim();
    let totalMs = 0;

    const unitRegex = /(\d+)\s*(menit|detik|jam|min|sec|j|m|d|h|s)/gi;
    let match;
    while ((match = unitRegex.exec(relTokens)) !== null) {
      const val = Number(match[1]);
      const u = match[2].toLowerCase();
      if (['j', 'jam', 'h'].includes(u)) totalMs += val * 3600_000;
      else if (['m', 'menit', 'min'].includes(u)) totalMs += val * 60_000;
      else if (['d', 'detik', 's', 'sec'].includes(u)) totalMs += val * 1000;
    }

    if (totalMs > 0) {
      const dueAt = now + totalMs;
      return { dueAt, repeat: null, text };
    }
  }

  // 7. Relatif hari: besok HH:mm / lusa HH:mm / hari ini HH:mm
  const dayRelMatch = str.match(/^(besok|lusa|hari\s+ini)\s+(\d{1,2}):(\d{2})\s*(.*)$/i);
  if (dayRelMatch) {
    const dayWord = dayRelMatch[1].toLowerCase().replace(/\s+/, ' ');
    const hour = Number(dayRelMatch[2]);
    const minute = Number(dayRelMatch[3]);
    const text = dayRelMatch[4].trim();

    if (hour > 23 || minute > 59) throw new Error('Jam atau menit tidak valid.');

    const addCount = dayWord === 'besok' ? 1 : dayWord === 'lusa' ? 2 : 0;
    let targetParts = addDays(nowParts, addCount);
    targetParts.hour = hour;
    targetParts.minute = minute;
    targetParts.second = 0;

    const dueAt = zonedPartsToUtcMs(targetParts, tz);
    if (dueAt < now - 60_000) {
      throw new Error('Waktu pengingat sudah terlewat di masa lalu.');
    }
    return { dueAt, repeat: null, text };
  }

  // 8. Tanggal lengkap YYYY-MM-DD HH:mm atau DD-MM-YYYY HH:mm
  const dateMatch = str.match(
    /^(\d{4}-\d{2}-\d{2}|\d{1,2}-\d{1,2}-\d{4})\s+(\d{1,2}):(\d{2})\s*(.*)$/,
  );
  if (dateMatch) {
    const dateStr = dateMatch[1];
    const hour = Number(dateMatch[2]);
    const minute = Number(dateMatch[3]);
    const text = dateMatch[4].trim();

    if (hour > 23 || minute > 59) throw new Error('Jam atau menit tidak valid.');

    let year, month, day;
    if (dateStr.includes('-') && dateStr.indexOf('-') === 4) {
      // YYYY-MM-DD
      const p = dateStr.split('-').map(Number);
      year = p[0];
      month = p[1];
      day = p[2];
    } else {
      // DD-MM-YYYY
      const p = dateStr.split('-').map(Number);
      day = p[0];
      month = p[1];
      year = p[2];
    }

    const dueAt = zonedPartsToUtcMs({ year, month, day, hour, minute, second: 0 }, tz);
    if (dueAt < now - 60_000) {
      throw new Error('Waktu pengingat sudah terlewat di masa lalu.');
    }
    return { dueAt, repeat: null, text };
  }

  // 9. Jam saja HH:mm (hari ini atau besok bila jam sudah lewat)
  const timeOnlyMatch = str.match(/^(\d{1,2}):(\d{2})\s*(.*)$/);
  if (timeOnlyMatch) {
    const hour = Number(timeOnlyMatch[1]);
    const minute = Number(timeOnlyMatch[2]);
    const text = timeOnlyMatch[3].trim();

    if (hour > 23 || minute > 59) throw new Error('Jam atau menit tidak valid.');

    let targetParts = { ...nowParts, hour, minute, second: 0 };
    let dueAt = zonedPartsToUtcMs(targetParts, tz);

    // Jika waktu hari ini sudah lewat (toleransi 60s), maka jadwalkan untuk besok
    if (dueAt <= now + 60_000) {
      targetParts = addDays(targetParts, 1);
      dueAt = zonedPartsToUtcMs(targetParts, tz);
    }

    return { dueAt, repeat: null, text };
  }

  throw new Error(
    'Format waktu tidak dikenali. Contoh: 10m, 2j, 17:30, besok 07:00, tiap hari 06:00',
  );
}
