/**
 * Core module untuk F-45: Catat Pengeluaran.
 */

import { getDb } from './db.js';
import { getZonedParts } from './time_parser.js';

export const EXPENSE_CATEGORIES = [
  'makanan',
  'transport',
  'belanja',
  'tagihan',
  'hiburan',
  'kesehatan',
  'lainnya',
];

export const CATEGORY_LABELS = {
  makanan: '🍜 Makanan',
  transport: '🚗 Transport',
  belanja: '🛍️ Belanja',
  tagihan: '📄 Tagihan',
  hiburan: '🎮 Hiburan',
  kesehatan: '💊 Kesehatan',
  lainnya: '📦 Lainnya',
};

/**
 * Format angka nominal ke format mata uang Rupiah (contoh: "Rp 25.000").
 */
export function formatRupiah(amount) {
  const num = Math.round(Number(amount) || 0);
  return `Rp ${new Intl.NumberFormat('id-ID').format(num)}`;
}

/**
 * Parse teks nominal menjadi integer Rupiah.
 * Mendukung format: 25k, 25rb, 25.000, 25000, 1,5jt, 1.5 juta, dsb.
 */
export function parseExpenseAmount(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Nominal pengeluaran tidak boleh kosong.');
  }

  let clean = raw.trim().toLowerCase();

  // Bersihkan prefix mata uang opsional (Rp, Rp., IDR)
  clean = clean.replace(/^(rp\.?|idr)\s*/i, '').trim();

  if (clean.includes('-')) {
    throw new Error('Nominal pengeluaran tidak boleh negatif.');
  }

  // Regex pemisah angka dan unit pengali
  const match = /^([0-9.,]+)\s*(triliun|t|miliar|milyar|m|juta|jt|ribu|rb|k)?$/i.exec(clean);
  if (!match) {
    throw new Error(`Format nominal '${raw}' tidak valid.`);
  }

  const numPart = match[1];
  const unit = match[2]?.toLowerCase();

  let multiplier = 1;
  if (['triliun', 't'].includes(unit)) {
    multiplier = 1_000_000_000_000;
  } else if (['miliar', 'milyar', 'm'].includes(unit)) {
    multiplier = 1_000_000_000;
  } else if (['juta', 'jt'].includes(unit)) {
    multiplier = 1_000_000;
  } else if (['ribu', 'rb', 'k'].includes(unit)) {
    multiplier = 1_000;
  }

  let amount = 0;

  if (multiplier > 1) {
    let normalizedNum = numPart;
    if (normalizedNum.includes('.') && normalizedNum.includes(',')) {
      normalizedNum = normalizedNum.replace(/\./g, '').replace(',', '.');
    } else if (normalizedNum.includes(',')) {
      normalizedNum = normalizedNum.replace(',', '.');
    }
    const val = parseFloat(normalizedNum);
    if (isNaN(val)) {
      throw new Error(`Format nominal '${raw}' tidak valid.`);
    }
    if (val <= 0) {
      throw new Error('Nominal pengeluaran harus lebih dari 0.');
    }
    amount = Math.round(val * multiplier);
  } else {
    let cleanNum = numPart;
    if (/^\d{1,3}(\.\d{3})+$/.test(cleanNum)) {
      cleanNum = cleanNum.replace(/\./g, '');
    } else if (/^\d{1,3}(,\d{3})+$/.test(cleanNum)) {
      cleanNum = cleanNum.replace(/,/g, '');
    } else {
      cleanNum = cleanNum.replace(',', '.');
    }
    const val = parseFloat(cleanNum);
    if (isNaN(val)) {
      throw new Error(`Format nominal '${raw}' tidak valid.`);
    }
    if (val <= 0) {
      throw new Error('Nominal pengeluaran harus lebih dari 0.');
    }
    amount = Math.round(val);
  }

  if (amount <= 0) {
    throw new Error('Nominal pengeluaran harus lebih dari 0.');
  }

  if (amount > 1_000_000_000_000) {
    throw new Error('Nominal pengeluaran maksimal 1 triliun rupiah.');
  }

  return amount;
}

/**
 * Deteksi kategori pengeluaran otomatis berdasarkan kata kunci keterangan.
 */
export function categorizeExpense(note) {
  if (!note || typeof note !== 'string') return 'lainnya';
  const text = note.toLowerCase();

  const rules = [
    {
      cat: 'kesehatan',
      keywords: [
        'obat', 'apotek', 'apotik', 'dokter', 'klinik', 'rumah sakit', 'rs',
        'periksa', 'vitamin', 'suplemen', 'tensi', 'gigi', 'rawat', 'medis',
      ],
    },
    {
      cat: 'tagihan',
      keywords: [
        'listrik', 'pln', 'token', 'air', 'pdam', 'wifi', 'indihome',
        'internet', 'pulsa', 'kuota', 'paket data', 'bpjs', 'sewa',
        'kos', 'kost', 'kontrakan', 'cicilan', 'kartu kredit', 'asuransi',
        'pajak', 'iuran',
      ],
    },
    {
      cat: 'transport',
      keywords: [
        'bensin', 'pertalite', 'pertamax', 'solar', 'spbu', 'ojol', 'gojek',
        'goride', 'gocar', 'grab', 'grabcar', 'grabbike', 'maxim', 'taksi',
        'taxi', 'parkir', 'tol', 'krl', 'mrt', 'lrt', 'bus', 'busway',
        'kereta', 'tiket', 'pesawat', 'angkot', 'ojek',
      ],
    },
    {
      cat: 'hiburan',
      keywords: [
        'bioskop', 'nonton', 'cinema', 'xxi', 'cgv', 'netflix', 'spotify',
        'youtube', 'game', 'steam', 'playstation', 'ps', 'topup', 'karaoke',
        'jalan-jalan', 'liburan', 'hotel', 'staycation', 'wisata',
      ],
    },
    {
      cat: 'makanan',
      keywords: [
        'makan', 'nasi', 'mi', 'mie', 'ayam', 'sate', 'bakso', 'burger',
        'pizza', 'roti', 'kopi', 'coffee', 'cafe', 'kafe', 'sarapan',
        'siang', 'malam', 'dinner', 'lunch', 'jajan', 'cemilan', 'camilan',
        'snack', 'es', 'teh', 'boba', 'warteg', 'padang', 'gofood',
        'grabfood', 'shopeefood', 'minum', 'jus',
      ],
    },
    {
      cat: 'belanja',
      keywords: [
        'alfamart', 'indomaret', 'superindo', 'supermarket', 'pasar',
        'belanja', 'baju', 'celana', 'sepatu', 'sandal', 'skincare',
        'sabun', 'sampo', 'shampoo', 'kosmetik', 'toko', 'mall', 'olshop',
        'shopee', 'tokopedia', 'lazada', 'tiktok shop', 'beli',
      ],
    },
  ];

  for (const r of rules) {
    for (const kw of r.keywords) {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      if (regex.test(text)) {
        return r.cat;
      }
    }
  }

  return 'lainnya';
}

/**
 * Konversi tanggal, jam, dan zona waktu ke epoch ms UTC secara presisi.
 */
export function getZonedTimestamp(
  { year, month, day, hour = 0, minute = 0, second = 0 },
  tz = 'Asia/Jakarta',
) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const parts = getZonedParts(new Date(utcGuess), tz);
  const localGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offset = localGuess - utcGuess;
  return utcGuess - offset;
}

/**
 * Hitung rentang epoch ms untuk periode: 'hari', 'minggu', 'bulan'.
 */
export function getPeriodRange(period = 'hari', tz = 'Asia/Jakarta', nowMs = Date.now()) {
  const p = getZonedParts(new Date(nowMs), tz);
  const cleanPeriod = (period || 'hari').toLowerCase().trim();

  if (cleanPeriod === 'minggu' || cleanPeriod === 'week') {
    // Cari hari Senin di minggu ini
    // getZonedParts: dayOfWeek (0: Minggu, 1: Senin, ..., 6: Sabtu)
    // Jika 0 (Minggu), mundurkan 6 hari ke Senin sebelumnya
    const dayOfWeek = p.dayOfWeek ?? new Date(nowMs).getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const startZoned = new Date(nowMs - diffToMonday * 86_400_000);
    const sp = getZonedParts(startZoned, tz);

    const startMs = getZonedTimestamp(
      { year: sp.year, month: sp.month, day: sp.day, hour: 0, minute: 0, second: 0 },
      tz,
    );
    const endMs = startMs + 7 * 86_400_000 - 1;

    return {
      period: 'minggu',
      startMs,
      endMs,
      label: `Minggu Ini (${String(sp.day).padStart(2, '0')}/${String(sp.month).padStart(2, '0')})`,
    };
  }

  if (cleanPeriod === 'bulan' || cleanPeriod === 'month') {
    const startMs = getZonedTimestamp(
      { year: p.year, month: p.month, day: 1, hour: 0, minute: 0, second: 0 },
      tz,
    );
    // Bulan berikutnya tanggal 1 dikurangi 1ms
    const nextMonthYear = p.month === 12 ? p.year + 1 : p.year;
    const nextMonth = p.month === 12 ? 1 : p.month + 1;
    const endMs =
      getZonedTimestamp(
        { year: nextMonthYear, month: nextMonth, day: 1, hour: 0, minute: 0, second: 0 },
        tz,
      ) - 1;

    return {
      period: 'bulan',
      startMs,
      endMs,
      label: `Bulan Ini (${p.year}-${String(p.month).padStart(2, '0')})`,
    };
  }

  // Default: hari ini
  const startMs = getZonedTimestamp(
    { year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0 },
    tz,
  );
  const endMs = startMs + 86_400_000 - 1;

  return {
    period: 'hari',
    startMs,
    endMs,
    label: `Hari Ini (${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')})`,
  };
}

/**
 * Tambah catatan pengeluaran baru.
 */
export function addExpense({
  userId,
  amount,
  category = null,
  note = '',
  now = Date.now(),
}) {
  if (!userId) throw new Error('User ID diperlukan.');
  const numAmount = typeof amount === 'number' ? amount : parseExpenseAmount(amount);
  const cleanNote = (note || '').trim();
  const finalCategory =
    category && EXPENSE_CATEGORIES.includes(category.toLowerCase())
      ? category.toLowerCase()
      : categorizeExpense(cleanNote);

  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO expenses (user_id, amount, category, note, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(userId, numAmount, finalCategory, cleanNote, now);

  return {
    id: res.lastInsertRowid,
    userId,
    amount: numAmount,
    category: finalCategory,
    note: cleanNote,
    createdAt: now,
  };
}

/**
 * Ambil satu catatan pengeluaran berdasarkan ID.
 */
export function getExpenseById(expenseId, userId = null) {
  const db = getDb();
  if (userId) {
    return (
      db
        .prepare(`SELECT * FROM expenses WHERE id = ? AND user_id = ?`)
        .get(expenseId, userId) || null
    );
  }
  return (
    db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(expenseId) || null
  );
}

/**
 * Hapus catatan pengeluaran berdasarkan ID.
 */
export function deleteExpense(expenseId, userId) {
  const db = getDb();
  const res = db
    .prepare(`DELETE FROM expenses WHERE id = ? AND user_id = ?`)
    .run(expenseId, userId);
  return res.changes > 0;
}

/**
 * Ubah kategori pengeluaran yang sudah tersimpan.
 */
export function updateExpenseCategory(expenseId, userId, newCategory) {
  const cat = (newCategory || '').toLowerCase();
  if (!EXPENSE_CATEGORIES.includes(cat)) {
    throw new Error(`Kategori '${newCategory}' tidak valid.`);
  }

  const db = getDb();
  const res = db
    .prepare(
      `UPDATE expenses SET category = ? WHERE id = ? AND user_id = ?`,
    )
    .run(cat, expenseId, userId);

  return res.changes > 0;
}

/**
 * Ambil rekap pengeluaran berdasarkan periode ('hari', 'minggu', 'bulan').
 */
export function getExpensesSummary({
  userId,
  period = 'hari',
  tz = 'Asia/Jakarta',
  now = Date.now(),
}) {
  const db = getDb();
  const range = getPeriodRange(period, tz, now);

  const rows = db
    .prepare(
      `SELECT category, SUM(amount) as total_amount, COUNT(*) as count
       FROM expenses
       WHERE user_id = ? AND created_at >= ? AND created_at <= ?
       GROUP BY category
       ORDER BY total_amount DESC`,
    )
    .all(userId, range.startMs, range.endMs);

  const grand = db
    .prepare(
      `SELECT SUM(amount) as grand_total, COUNT(*) as total_count
       FROM expenses
       WHERE user_id = ? AND created_at >= ? AND created_at <= ?`,
    )
    .get(userId, range.startMs, range.endMs);

  const totalAmount = grand?.grand_total || 0;
  const totalCount = grand?.total_count || 0;

  const breakdown = rows.map((r) => ({
    category: r.category,
    label: CATEGORY_LABELS[r.category] || r.category,
    amount: r.total_amount,
    count: r.count,
    percentage:
      totalAmount > 0
        ? Math.round((r.total_amount / totalAmount) * 100)
        : 0,
  }));

  return {
    period: range.period,
    periodLabel: range.label,
    totalAmount,
    totalCount,
    breakdown,
  };
}

/**
 * Format string tanggal lokal untuk file CSV.
 */
export function formatLocalTimestamp(epochMs, tz = 'Asia/Jakarta') {
  const p = getZonedParts(new Date(epochMs), tz);
  const yyyy = String(p.year);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  const hh = String(p.hour).padStart(2, '0');
  const min = String(p.minute).padStart(2, '0');
  const ss = String(p.second).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

/**
 * Escape teks untuk nilai kolom CSV.
 */
export function escapeCsvField(field) {
  if (field === null || field === undefined) return '';
  const str = String(field);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate dokumen CSV seluruh pengeluaran milik user.
 */
export function generateExpensesCsv(userId, tz = 'Asia/Jakarta') {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM expenses WHERE user_id = ? ORDER BY created_at ASC`,
    )
    .all(userId);

  const lines = ['ID,Tanggal,Kategori,Nominal,Keterangan'];

  for (const r of rows) {
    const timeStr = formatLocalTimestamp(r.created_at, tz);
    lines.push(
      [
        r.id,
        timeStr,
        r.category,
        r.amount,
        escapeCsvField(r.note || ''),
      ].join(','),
    );
  }

  return lines.join('\n');
}
