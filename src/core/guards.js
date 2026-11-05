/**
 * Modul Penjaga (Guards): Whitelist, Rate Limiter, Batas Panjang Pesan, dan Pesan Kedaluwarsa.
 */

export function parseIdList(envVal) {
  if (!envVal || typeof envVal !== 'string') return new Set();
  return new Set(
    envVal
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => !isNaN(n)),
  );
}

/**
 * Cek apakah user diperbolehkan menggunakan bot.
 * Jika ALLOWED_USER_IDS kosong, semua user diizinkan.
 * Admin (ADMIN_IDS) selalu diizinkan.
 */
export function isUserAllowed(
  userId,
  {
    allowedIds = process.env.ALLOWED_USER_IDS,
    adminIds = process.env.ADMIN_IDS,
  } = {},
) {
  if (!userId) return false;

  const admins = parseIdList(adminIds);
  if (admins.has(userId)) return true;

  const allowed = parseIdList(allowedIds);
  if (allowed.size === 0) return true;

  return allowed.has(userId);
}

/**
 * Cek apakah user memiliki hak akses admin.
 */
export function isAdmin(userId, adminIds = process.env.ADMIN_IDS) {
  if (!userId) return false;
  return parseIdList(adminIds).has(userId);
}

/**
 * Dapatkan daftar seluruh ID admin dari environment.
 */
export function getAdminIds(adminIds = process.env.ADMIN_IDS) {
  return [...parseIdList(adminIds)];
}

/**
 * Cek apakah pesan sudah kedaluwarsa (misal menumpuk saat bot offline).
 */
export function isStaleMessage(
  messageDateSeconds,
  nowSeconds = Math.floor(Date.now() / 1000),
  maxAgeSeconds = 180,
) {
  if (!messageDateSeconds) return false;
  return nowSeconds - messageDateSeconds > maxAgeSeconds;
}

/**
 * Cek apakah panjang teks melebihi batas yang ditentukan.
 */
export function isInputTooLong(text, maxLength = 2000) {
  if (!text || typeof text !== 'string') return false;
  return text.length > maxLength;
}

/**
 * Rate limiter berbasis in-memory sliding window per user.
 */
export class RateLimiter {
  constructor({
    maxPerMinute = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 8),
    maxPerDay = Number(process.env.RATE_LIMIT_PER_DAY ?? 0),
  } = {}) {
    this.maxPerMinute = maxPerMinute;
    this.maxPerDay = maxPerDay;
    this.minuteBuckets = new Map(); // userId -> number[] (timestamps in ms)
    this.dayBuckets = new Map(); // userId -> { dateStr: string, count: number }
  }

  /**
   * Cek apakah user terkena rate limit tanpa menambah hitungan.
   */
  check(userId, now = Date.now()) {
    if (!userId) return { allowed: true };

    // Cek batas per menit
    const minuteWindow = 60_000;
    const timestamps = (this.minuteBuckets.get(userId) ?? []).filter(
      (ts) => now - ts < minuteWindow,
    );
    this.minuteBuckets.set(userId, timestamps);

    if (timestamps.length >= this.maxPerMinute) {
      const oldest = timestamps[0];
      const retryAfterMs = Math.max(0, minuteWindow - (now - oldest));
      return {
        allowed: false,
        reason: 'minute_limit',
        retryAfterMs,
      };
    }

    // Cek batas harian bila diaktifkan (maxPerDay > 0)
    if (this.maxPerDay > 0) {
      const today = new Date(now).toISOString().slice(0, 10);
      const dayData = this.dayBuckets.get(userId);

      if (dayData && dayData.dateStr === today && dayData.count >= this.maxPerDay) {
        return {
          allowed: false,
          reason: 'day_limit',
          retryAfterMs: 86_400_000,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Catat 1 pemanggilan LLM oleh user.
   */
  consume(userId, now = Date.now()) {
    if (!userId) return;

    // Tambah ke bucket menit
    const timestamps = (this.minuteBuckets.get(userId) ?? []).filter(
      (ts) => now - ts < 60_000,
    );
    timestamps.push(now);
    this.minuteBuckets.set(userId, timestamps);

    // Tambah ke bucket harian
    if (this.maxPerDay > 0) {
      const today = new Date(now).toISOString().slice(0, 10);
      const dayData = this.dayBuckets.get(userId);

      if (dayData && dayData.dateStr === today) {
        dayData.count += 1;
      } else {
        this.dayBuckets.set(userId, { dateStr: today, count: 1 });
      }
    }
  }

  /**
   * Reset data limiter untuk user tertentu (berguna untuk testing).
   */
  reset(userId) {
    if (userId) {
      this.minuteBuckets.delete(userId);
      this.dayBuckets.delete(userId);
    } else {
      this.minuteBuckets.clear();
      this.dayBuckets.clear();
    }
  }
}

