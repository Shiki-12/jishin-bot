import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIdList,
  isUserAllowed,
  isAdmin,
  isStaleMessage,
  isInputTooLong,
  RateLimiter,
} from '../src/core/guards.js';

describe('Guards: Whitelist, Rate Limiter & Input Bounds (F-04)', () => {
  it('parseIdList mengurai string ID dipisah koma', () => {
    assert.equal(parseIdList('').size, 0);
    assert.equal(parseIdList(null).size, 0);

    const ids = parseIdList('12345, 67890, 111222');
    assert.equal(ids.size, 3);
    assert.ok(ids.has(12345));
    assert.ok(ids.has(67890));
    assert.ok(ids.has(111222));
  });

  it('isUserAllowed mengizinkan semua orang jika whitelist kosong', () => {
    assert.equal(
      isUserAllowed(999, { allowedIds: '', adminIds: '' }),
      true,
    );
  });

  it('isUserAllowed membatasi hanya untuk user terdaftar atau admin', () => {
    const opts = {
      allowedIds: '100, 200',
      adminIds: '999',
    };

    assert.equal(isUserAllowed(100, opts), true);
    assert.equal(isUserAllowed(200, opts), true);
    assert.equal(isUserAllowed(999, opts), true); // Admin selalu diizinkan
    assert.equal(isUserAllowed(300, opts), false); // Tidak terdaftar
  });

  it('isAdmin mengidentifikasi ID admin', () => {
    assert.equal(isAdmin(888, '888, 999'), true);
    assert.equal(isAdmin(777, '888, 999'), false);
    assert.equal(isAdmin(null, '888'), false);
  });

  it('isStaleMessage mendeteksi pesan usang saat bot baru aktif', () => {
    const nowSec = 1700000000;
    // Pesan 10 detik lalu: masih baru
    assert.equal(isStaleMessage(nowSec - 10, nowSec, 180), false);
    // Pesan 300 detik (5 menit) lalu: sudah usang
    assert.equal(isStaleMessage(nowSec - 300, nowSec, 180), true);
  });

  it('isInputTooLong membatasi panjang teks', () => {
    assert.equal(isInputTooLong('Halo', 2000), false);
    assert.equal(isInputTooLong('a'.repeat(2001), 2000), true);
  });

  it('RateLimiter membatasi panggilan LLM per menit', () => {
    const limiter = new RateLimiter({ maxPerMinute: 3 });
    const user = 4455;
    let now = 1000000;

    // Panggilan 1, 2, 3: boleh
    assert.equal(limiter.check(user, now).allowed, true);
    limiter.consume(user, now);

    assert.equal(limiter.check(user, now + 1000).allowed, true);
    limiter.consume(user, now + 1000);

    assert.equal(limiter.check(user, now + 2000).allowed, true);
    limiter.consume(user, now + 2000);

    // Panggilan 4 dalam 1 menit yang sama: DITOLAK
    const check4 = limiter.check(user, now + 3000);
    assert.equal(check4.allowed, false);
    assert.equal(check4.reason, 'minute_limit');
    assert.ok(check4.retryAfterMs > 0);

    // Majukan waktu 61 detik: jendela geser, kembali DIIZINKAN
    const checkAfterWait = limiter.check(user, now + 62000);
    assert.equal(checkAfterWait.allowed, true);
  });

  it('RateLimiter mendukung batas harian (maxPerDay)', () => {
    const limiter = new RateLimiter({ maxPerMinute: 10, maxPerDay: 2 });
    const user = 7788;
    const now = new Date('2026-11-04T10:00:00.000Z').getTime();

    limiter.consume(user, now);
    limiter.consume(user, now + 1000);

    // Panggilan 3 melebihi batas harian
    const check3 = limiter.check(user, now + 2000);
    assert.equal(check3.allowed, false);
    assert.equal(check3.reason, 'day_limit');
  });
});

