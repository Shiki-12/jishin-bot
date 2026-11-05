/**
 * Core module untuk F-41: Jadwal Sholat (Aladhan API Integration).
 * Menggunakan metode Kemenag RI (Method ID: 20).
 * Dilengkapi cache in-memory 1 hari per kota, timeout 8 detik,
 * pemformat jadwal sholat netral, serta sinkronisasi pengingat adzan harian ke F-10.
 */

import { getDb } from './db.js';
import { getZonedParts, zonedPartsToUtcMs } from './time_parser.js';

export const METHOD_KEMENAG = 20;

export const PRAYER_NAMES = {
  Fajr: 'Subuh',
  Dhuhr: 'Dzuhur',
  Asr: 'Ashar',
  Maghrib: 'Maghrib',
  Isha: 'Isya',
};

// In-memory cache per kota per hari: Map<`${city}_${date}`, { data: object, expiresAt: number }>
const PRAYER_CACHE = new Map();
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam

export function clearPrayerCache() {
  PRAYER_CACHE.clear();
}

/**
 * Normalisasi waktu HH:mm dari Aladhan (misal "04:05 (WIB)" -> "04:05").
 */
export function cleanTiming(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return '';
  const match = timeStr.match(/(\d{1,2}:\d{2})/);
  return match ? match[1] : timeStr.trim();
}

/**
 * Singkatan zona waktu Indonesia atau nama zona IANA.
 */
export function getTimezoneLabel(tz = 'Asia/Jakarta') {
  if (tz === 'Asia/Jakarta') return 'WIB';
  if (tz === 'Asia/Makassar') return 'WITA';
  if (tz === 'Asia/Jayapura') return 'WIT';
  return tz;
}

/**
 * Mengambil jadwal sholat dari Aladhan API dengan metode Kemenag RI (id: 20).
 */
export async function fetchPrayerTimes(
  city,
  { dateStr = null, fetchFn = fetch, timeoutMs = 8000 } = {},
) {
  if (!city || typeof city !== 'string') return null;
  const cleanCity = city.trim();
  if (!cleanCity) return null;

  // Endpoint: /timingsByAddress/:date?address=...&method=20
  const datePath = dateStr ? `/${encodeURIComponent(dateStr)}` : '';
  const url = `https://api.aladhan.com/v1/timingsByAddress${datePath}?address=${encodeURIComponent(
    cleanCity,
  )}&method=${METHOD_KEMENAG}`;

  const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    if (res.status === 400 || res.status === 404) {
      return null;
    }
    throw new Error(`Aladhan HTTP error: ${res.status}`);
  }

  const json = await res.json();
  if (json?.code !== 200 || !json?.data?.timings) {
    return null;
  }

  const d = json.data;
  return {
    city: cleanCity,
    meta: d.meta,
    timings: {
      Fajr: cleanTiming(d.timings.Fajr),
      Sunrise: cleanTiming(d.timings.Sunrise),
      Dhuhr: cleanTiming(d.timings.Dhuhr),
      Asr: cleanTiming(d.timings.Asr),
      Sunset: cleanTiming(d.timings.Sunset),
      Maghrib: cleanTiming(d.timings.Maghrib),
      Isha: cleanTiming(d.timings.Isha),
      Imsak: cleanTiming(d.timings.Imsak),
      Midnight: cleanTiming(d.timings.Midnight),
    },
    date: {
      readable: d.date?.readable || '',
      hijri: d.date?.hijri || null,
      gregorian: d.date?.gregorian || null,
    },
  };
}

/**
 * Mengambil jadwal sholat dengan cache per kota per hari.
 */
export async function getPrayerData(
  city,
  { dateStr = null, fetchFn = fetch, timeoutMs = 8000, now = Date.now() } = {},
) {
  if (!city || typeof city !== 'string') return null;
  const cleanCity = city.trim().toLowerCase();
  if (!cleanCity) return null;

  const cacheKey = `${cleanCity}_${dateStr || 'today'}`;
  const cached = PRAYER_CACHE.get(cacheKey);
  if (cached && now < cached.expiresAt) {
    return cached.data;
  }

  const data = await fetchPrayerTimes(city, { dateStr, fetchFn, timeoutMs });
  if (!data) return null;

  PRAYER_CACHE.set(cacheKey, {
    data,
    expiresAt: now + CACHE_TTL_MS,
  });

  return data;
}

/**
 * Format tampilan jadwal sholat lengkap hari ini secara netral dan hormat.
 */
export function formatPrayerSchedule({ prayerData, cityName = null, tz = 'Asia/Jakarta' }) {
  if (!prayerData || !prayerData.timings) {
    return 'Data jadwal sholat tidak tersedia.';
  }

  const city = cityName || prayerData.city;
  const t = prayerData.timings;
  const tzLabel = getTimezoneLabel(tz);

  let hijriStr = '';
  if (prayerData.date?.hijri) {
    const h = prayerData.date.hijri;
    const monthName = h.month?.en || h.month?.ar || '';
    hijriStr = ` (${h.day} ${monthName} ${h.year} H)`;
  }

  const gregorianStr = prayerData.date?.readable || 'Hari ini';

  return (
    `🕌 *Jadwal Sholat untuk ${city}*\n` +
    `📅 *${gregorianStr}*${hijriStr}\n\n` +
    `• *Imsak:* \`${t.Imsak}\` ${tzLabel}\n` +
    `• *Subuh:* \`${t.Fajr}\` ${tzLabel}\n` +
    `• *Terbit:* \`${t.Sunrise}\` ${tzLabel}\n` +
    `• *Dzuhur:* \`${t.Dhuhr}\` ${tzLabel}\n` +
    `• *Ashar:* \`${t.Asr}\` ${tzLabel}\n` +
    `• *Maghrib:* \`${t.Maghrib}\` ${tzLabel}\n` +
    `• *Isya:* \`${t.Isha}\` ${tzLabel}\n\n` +
    `_Metode: Kemenag RI (Kementerian Agama Republik Indonesia)_`
  );
}

/**
 * Jadwalkan pengingat adzan hari ini ke tabel reminders (F-10) untuk satu user/chat.
 */
export async function schedulePrayerRemindersForTarget({
  chatId,
  userId = null,
  isPrivate = true,
  now = Date.now(),
  fetchFn = fetch,
} = {}) {
  const db = getDb();

  // Ambil data pengaturan
  let row;
  if (isPrivate && userId) {
    row = db
      .prepare(`SELECT city, tz, adzan, adzan_lead, adzan_last_date FROM users WHERE id = ?`)
      .get(userId);
  } else if (chatId) {
    row = db
      .prepare(`SELECT city, tz, adzan, adzan_lead, adzan_last_date FROM chats WHERE id = ?`)
      .get(chatId);
  }

  if (!row || Number(row.adzan) !== 1 || !row.city) {
    return 0;
  }

  const tz = row.tz || 'Asia/Jakarta';
  const tzLabel = getTimezoneLabel(tz);
  const leadMinutes = Number(row.adzan_lead ?? 10);
  const targetCity = row.city;

  const parts = getZonedParts(new Date(now), tz);
  const curDateStr = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const apiDateStr = `${String(parts.day).padStart(2, '0')}-${String(parts.month).padStart(2, '0')}-${parts.year}`;

  if (row.adzan_last_date === curDateStr) {
    return 0; // Sudah dijadwalkan untuk hari ini
  }

  const prayerData = await getPrayerData(targetCity, {
    dateStr: apiDateStr,
    fetchFn,
    now,
  });

  if (!prayerData || !prayerData.timings) {
    return 0;
  }

  const prayers = [
    { key: 'Fajr', name: 'Subuh' },
    { key: 'Dhuhr', name: 'Dzuhur' },
    { key: 'Asr', name: 'Ashar' },
    { key: 'Maghrib', name: 'Maghrib' },
    { key: 'Isha', name: 'Isya' },
  ];

  let scheduledCount = 0;

  for (const p of prayers) {
    const timeStr = prayerData.timings[p.key];
    if (!timeStr) continue;

    const [pHour, pMinute] = timeStr.split(':').map(Number);
    const prayerUtcMs = zonedPartsToUtcMs(
      {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: pHour,
        minute: pMinute,
        second: 0,
      },
      tz,
    );

    const dueAt = prayerUtcMs - leadMinutes * 60_000;

    // Lewati jika waktu pengingat sudah lewat lebih dari 60 detik
    if (dueAt <= now - 60_000) {
      continue;
    }

    const text =
      leadMinutes > 0
        ? `🕌 Pengingat Sholat: ${leadMinutes} menit lagi masuk waktu ${p.name} (${timeStr} ${tzLabel}) untuk wilayah ${targetCity} dan sekitarnya.`
        : `🕌 Pengingat Sholat: Waktu ${p.name} (${timeStr} ${tzLabel}) telah masuk untuk wilayah ${targetCity} dan sekitarnya.`;

    // Cek apakah pengingat untuk waktu ini sudah ada agar idempoten
    const existing = db
      .prepare(
        `SELECT id FROM reminders
         WHERE chat_id = ? AND user_id = ? AND due_at = ? AND text LIKE ?`,
      )
      .get(chatId, userId ?? chatId, dueAt, `%waktu ${p.name}%`);

    if (!existing) {
      db.prepare(
        `INSERT INTO reminders (chat_id, user_id, text, due_at, tz, repeat, status, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, 'pending', ?)`,
      ).run(chatId, userId ?? chatId, text, dueAt, tz, now);
      scheduledCount++;
    }
  }

  // Tandai bahwa jadwal hari ini telah diproses
  if (isPrivate && userId) {
    db.prepare(`UPDATE users SET adzan_last_date = ? WHERE id = ?`).run(curDateStr, userId);
  } else if (chatId) {
    db.prepare(`UPDATE chats SET adzan_last_date = ? WHERE id = ?`).run(curDateStr, chatId);
  }

  return scheduledCount;
}

/**
 * Batalkan seluruh pengingat adzan yang masih pending untuk user/chat.
 */
export function cancelPrayerRemindersForTarget(chatId, userId = null) {
  const db = getDb();
  const res = db
    .prepare(
      `UPDATE reminders
       SET status = 'cancelled'
       WHERE chat_id = ? AND (user_id = ? OR user_id = chat_id)
         AND status = 'pending'
         AND text LIKE '🕌 Pengingat Sholat:%'`,
    )
    .run(chatId, userId ?? chatId);
  return res.changes;
}

/**
 * Sinkronisasi harian pengingat adzan untuk seluruh user dan chat aktif.
 * Dipanggil oleh loop scheduler F-10.
 */
export async function syncDailyPrayerReminders(bot, { now = Date.now(), fetchFn = fetch } = {}) {
  const db = getDb();

  // Ambil users dengan adzan aktif & kota terisi
  const users = db
    .prepare(
      `SELECT id, city, tz, adzan_last_date FROM users
       WHERE adzan = 1 AND city IS NOT NULL`,
    )
    .all();

  // Ambil chats (grup) dengan adzan aktif & kota terisi
  const chats = db
    .prepare(
      `SELECT id, city, tz, adzan_last_date FROM chats
       WHERE adzan = 1 AND city IS NOT NULL`,
    )
    .all();

  let totalScheduled = 0;

  for (const u of users) {
    try {
      const count = await schedulePrayerRemindersForTarget({
        chatId: u.id,
        userId: u.id,
        isPrivate: true,
        now,
        fetchFn,
      });
      totalScheduled += count;
    } catch (err) {
      console.error(`Gagal jadwalkan adzan untuk user ${u.id}:`, err.message);
    }
  }

  for (const c of chats) {
    try {
      const count = await schedulePrayerRemindersForTarget({
        chatId: c.id,
        userId: c.id,
        isPrivate: false,
        now,
        fetchFn,
      });
      totalScheduled += count;
    } catch (err) {
      console.error(`Gagal jadwalkan adzan untuk chat ${c.id}:`, err.message);
    }
  }

  return totalScheduled;
}

