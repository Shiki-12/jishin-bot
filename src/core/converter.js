/**
 * Core module untuk F-42: Kurs, Kalkulator Aman, dan Konversi Satuan.
 * - Kurs: Integrasi open.er-api.com (cache 1 jam, timeout 8s)
 * - Kalkulator: Parser aritmetika rekursif aman (NO eval, NO Function)
 * - Konversi: Tabel konversi satuan panjang, berat, volume, dan suhu
 */

// ============================================================================
// 1. KALKULATOR AMAN (NO eval / NO Function)
// ============================================================================

/**
 * Tokenize ekspresi matematika.
 * Mendukung angka (bulat & desimal), operator (+, -, *, /, %, ^), dan kurung.
 */
export function tokenizeMath(expr) {
  if (typeof expr !== 'string') {
    throw new Error('Ekspresi matematika harus berupa string.');
  }

  const tokens = [];
  let i = 0;
  const s = expr.trim();

  while (i < s.length) {
    const ch = s[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      let numStr = '';
      while (i < s.length && (/[0-9]/.test(s[i]) || s[i] === '.')) {
        if (s[i] === '.' && numStr.includes('.')) {
          throw new Error('Format angka desimal tidak valid (titik ganda).');
        }
        numStr += s[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr) });
      continue;
    }

    if ('+-*/%^()'.includes(ch)) {
      tokens.push({ type: ch, value: ch });
      i++;
      continue;
    }

    throw new Error(`Karakter tidak valid dalam ekspresi: '${ch}'`);
  }

  return tokens;
}

/**
 * Parser & Evaluator ekspresi matematika menggunakan Recursive Descent.
 * Precedence:
 *   1. Kurung: ( expr )
 *   2. Unary: +expr, -expr
 *   3. Pangkat: ^ (right-associative)
 *   4. Perkalian, Pembagian, Modulo: *, /, % (left-associative)
 *   5. Penjumlahan, Pengurangan: +, - (left-associative)
 */
export function evaluateMath(expression) {
  const tokens = tokenizeMath(expression);
  if (tokens.length === 0) {
    throw new Error('Ekspresi matematika kosong.');
  }

  let index = 0;

  function peek() {
    return tokens[index];
  }

  function match(...types) {
    const tok = peek();
    if (tok && types.includes(tok.type)) {
      index++;
      return tok;
    }
    return null;
  }

  function expect(type, errMsg) {
    const tok = match(type);
    if (!tok) {
      throw new Error(errMsg || `Diharapkan '${type}' tetapi menemukan '${peek()?.value ?? 'EOF'}'`);
    }
    return tok;
  }

  // expr := term (('+' | '-') term)*
  function parseExpression() {
    let left = parseTerm();

    while (true) {
      const op = match('+', '-');
      if (!op) break;

      const right = parseTerm();
      if (op.type === '+') left = left + right;
      else if (op.type === '-') left = left - right;
    }

    return left;
  }

  // term := unary (('*' | '/' | '%') unary)*
  function parseTerm() {
    let left = parseUnary();

    while (true) {
      const op = match('*', '/', '%');
      if (!op) break;

      const right = parseUnary();
      if (op.type === '*') {
        left = left * right;
      } else if (op.type === '/') {
        if (right === 0) {
          throw new Error('Pembagian dengan nol tidak terdefinisi.');
        }
        left = left / right;
      } else if (op.type === '%') {
        if (right === 0) {
          throw new Error('Operasi modulo dengan nol tidak terdefinisi.');
        }
        left = left % right;
      }
    }

    return left;
  }

  // unary := ('+' | '-') unary | power
  function parseUnary() {
    if (match('+')) {
      return parseUnary();
    }
    if (match('-')) {
      return -parseUnary();
    }
    return parsePower();
  }

  // power := primary ('^' unary)?  (right-associative)
  function parsePower() {
    const base = parsePrimary();
    if (match('^')) {
      const exp = parseUnary();
      return Math.pow(base, exp);
    }
    return base;
  }

  // primary := NUMBER | '(' expr ')'
  function parsePrimary() {
    const numTok = match('NUMBER');
    if (numTok) {
      return numTok.value;
    }

    if (match('(')) {
      const val = parseExpression();
      expect(')', 'Kurung tutup ")" tidak ditemukan.');
      return val;
    }

    throw new Error(`Sintaks ekspresi tidak valid di '${peek()?.value ?? 'akhir input'}'.`);
  }

  const result = parseExpression();

  if (index < tokens.length) {
    throw new Error(`Sintaks matematika tidak lengkap setelah '${tokens[index - 1]?.value}'.`);
  }

  if (!Number.isFinite(result)) {
    throw new Error('Hasil perhitungan melebihi batas angka (overflow/tak hingga).');
  }

  // Bersihkan floating point precision error (misal 0.1 + 0.2 -> 0.3)
  return Math.round(result * 1e10) / 1e10;
}

// ============================================================================
// 2. KURS MATA UANG (open.er-api.com)
// ============================================================================

const RATES_CACHE = new Map();
export const KURS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 jam

export function clearKursCache() {
  RATES_CACHE.clear();
}

/**
 * Format angka nominal sesuai standar pembacaan Indonesia.
 */
export function formatCurrencyAmount(num) {
  if (num == null || isNaN(num)) return '0';
  return new Intl.NumberFormat('id-ID', {
    maximumFractionDigits: 4,
  }).format(num);
}

/**
 * Ambil data kurs dari open.er-api.com dengan cache in-memory 1 jam.
 */
export async function getExchangeRates(
  baseCurrency = 'USD',
  { fetchFn = fetch, timeoutMs = 8000, now = Date.now() } = {},
) {
  const base = baseCurrency.trim().toUpperCase();
  if (!base || base.length !== 3) {
    throw new Error(`Kode mata uang '${baseCurrency}' tidak valid. Gunakan kode 3 huruf (misal: USD, IDR, JPY).`);
  }

  const cached = RATES_CACHE.get(base);
  if (cached && now < cached.expiresAt) {
    return cached.data;
  }

  const url = `https://open.er-api.com/v6/latest/${base}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });

  if (!res.ok) {
    throw new Error(`Gagal menghubungi server kurs: HTTP ${res.status}`);
  }

  const json = await res.json();
  if (json?.result !== 'success' || !json?.rates) {
    throw new Error(`Mata uang dasar '${base}' tidak didukung oleh penyedia kurs.`);
  }

  const data = {
    base: json.base_code || base,
    rates: json.rates,
    lastUpdateUtc: json.time_last_update_utc || '',
  };

  RATES_CACHE.set(base, {
    data,
    expiresAt: now + KURS_CACHE_TTL_MS,
  });

  return data;
}

/**
 * Hitung konversi nilai mata uang.
 */
export async function convertCurrency(
  amount,
  fromCurr,
  toCurr,
  { fetchFn = fetch, timeoutMs = 8000, now = Date.now() } = {},
) {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(',', '.'));
  if (isNaN(num) || num < 0) {
    throw new Error('Nominal konversi harus berupa angka positif.');
  }

  const from = fromCurr.trim().toUpperCase();
  const to = toCurr.trim().toUpperCase();

  const ratesData = await getExchangeRates(from, { fetchFn, timeoutMs, now });
  const rate = ratesData.rates[to];

  if (rate == null) {
    throw new Error(`Mata uang tujuan '${to}' tidak ditemukan.`);
  }

  const converted = Math.round(num * rate * 1e4) / 1e4;

  return {
    amount: num,
    from,
    to,
    rate,
    result: converted,
    lastUpdateUtc: ratesData.lastUpdateUtc,
  };
}

// ============================================================================
// 3. KONVERSI SATUAN (Panjang, Berat, Suhu, Volume)
// ============================================================================

// Satuan Panjang (Base: meter)
const LENGTH_UNITS = {
  km: 1000,
  kilometer: 1000,
  m: 1,
  meter: 1,
  cm: 0.01,
  centimeter: 0.01,
  sentimeter: 0.01,
  mm: 0.001,
  millimeter: 0.001,
  milimeter: 0.001,
  mil: 1609.344,
  mile: 1609.344,
  mi: 1609.344,
  yd: 0.9144,
  yard: 0.9144,
  ft: 0.3048,
  kaki: 0.3048,
  foot: 0.3048,
  feet: 0.3048,
  in: 0.0254,
  inci: 0.0254,
  inch: 0.0254,
  inches: 0.0254,
};

// Satuan Berat / Massa (Base: gram)
const WEIGHT_UNITS = {
  ton: 1_000_000,
  t: 1_000_000,
  kg: 1000,
  kilogram: 1000,
  ons: 100, // Standar Indonesia: 1 ons = 100 gram
  g: 1,
  gram: 1,
  mg: 0.001,
  milligram: 0.001,
  miligram: 0.001,
  lb: 453.59237,
  pon: 453.59237,
  pound: 453.59237,
  lbs: 453.59237,
  oz: 28.349523125,
  ounce: 28.349523125,
};

// Satuan Volume (Base: milliliter)
const VOLUME_UNITS = {
  m3: 1_000_000,
  l: 1000,
  liter: 1000,
  ltr: 1000,
  dl: 100,
  desiliter: 100,
  cl: 10,
  sentiliter: 10,
  ml: 1,
  milliliter: 1,
  mililiter: 1,
  gal: 3785.411784, // US liquid gallon
  galon: 3785.411784,
  gallon: 3785.411784,
  cup: 240,
  cangkir: 240,
  sdm: 15,
  tbsp: 15,
  sdt: 5,
  tsp: 5,
};

// Satuan Suhu (Special calculation)
const TEMPERATURE_UNITS = new Set([
  'c',
  'celcius',
  'celsius',
  'f',
  'fahrenheit',
  'k',
  'kelvin',
  'r',
  'reamur',
]);

function normalizeTempUnit(unit) {
  const u = unit.toLowerCase();
  if (['c', 'celcius', 'celsius'].includes(u)) return 'C';
  if (['f', 'fahrenheit'].includes(u)) return 'F';
  if (['k', 'kelvin'].includes(u)) return 'K';
  if (['r', 'reamur'].includes(u)) return 'R';
  return null;
}

function convertTemperature(value, fromU, toU) {
  const from = normalizeTempUnit(fromU);
  const to = normalizeTempUnit(toU);

  if (!from || !to) {
    throw new Error(`Satuan suhu tidak dikenal: '${fromU}' atau '${toU}'`);
  }

  // 1. Konversi dari asal ke Celsius
  let c;
  if (from === 'C') c = value;
  else if (from === 'F') c = ((value - 32) * 5) / 9;
  else if (from === 'K') c = value - 273.15;
  else if (from === 'R') c = (value * 5) / 4;

  // 2. Konversi dari Celsius ke tujuan
  let res;
  if (to === 'C') res = c;
  else if (to === 'F') res = (c * 9) / 5 + 32;
  else if (to === 'K') res = c + 273.15;
  else if (to === 'R') res = (c * 4) / 5;

  return Math.round(res * 1e6) / 1e6;
}

/**
 * Deteksi kategori satuan (panjang, berat, volume, suhu).
 */
export function getUnitCategory(unitStr) {
  if (!unitStr || typeof unitStr !== 'string') return null;
  const u = unitStr.trim().toLowerCase();

  if (TEMPERATURE_UNITS.has(u)) return 'suhu';
  if (u in LENGTH_UNITS) return 'panjang';
  if (u in WEIGHT_UNITS) return 'berat';
  if (u in VOLUME_UNITS) return 'volume';

  return null;
}

/**
 * Konversi nilai antar satuan dari kategori yang sama.
 */
export function convertUnit(val, fromUnit, toUnit) {
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
  if (isNaN(num)) {
    throw new Error(`Nilai konversi '${val}' bukan angka yang valid.`);
  }

  const uFrom = fromUnit.trim().toLowerCase();
  const uTo = toUnit.trim().toLowerCase();

  const catFrom = getUnitCategory(uFrom);
  const catTo = getUnitCategory(uTo);

  if (!catFrom) {
    throw new Error(`Satuan asal '${fromUnit}' tidak dikenali.`);
  }
  if (!catTo) {
    throw new Error(`Satuan tujuan '${toUnit}' tidak dikenali.`);
  }
  if (catFrom !== catTo) {
    throw new Error(`Tidak bisa mengonversi satuan '${catFrom}' ke '${catTo}' (kategori berbeda).`);
  }

  if (catFrom === 'suhu') {
    const res = convertTemperature(num, uFrom, uTo);
    return {
      value: num,
      from: normalizeTempUnit(uFrom),
      to: normalizeTempUnit(uTo),
      result: res,
      category: 'suhu',
    };
  }

  let table;
  if (catFrom === 'panjang') table = LENGTH_UNITS;
  else if (catFrom === 'berat') table = WEIGHT_UNITS;
  else if (catFrom === 'volume') table = VOLUME_UNITS;

  const inBase = num * table[uFrom];
  const res = inBase / table[uTo];
  const rounded = Math.round(res * 1e8) / 1e8;

  return {
    value: num,
    from: uFrom,
    to: uTo,
    result: rounded,
    category: catFrom,
  };
}
