/**
 * Core module untuk F-40: Cuaca (Open-Meteo Integration).
 * Mengambil koordinat via Geocoding API dan prakiraan via Forecast API,
 * dilengkapi cache in-memory 10 menit, timeout 8 detik, serta saran in-character.
 */

export const WMO_CODES = {
  0: { description: 'Cerah', type: 'clear' },
  1: { description: 'Cerah Berawan', type: 'clear' },
  2: { description: 'Sebagian Berawan', type: 'cloudy' },
  3: { description: 'Berawan Tebal', type: 'cloudy' },
  45: { description: 'Berkabut', type: 'cloudy' },
  48: { description: 'Kabut Tebal', type: 'cloudy' },
  51: { description: 'Gerimis Ringan', type: 'rain' },
  53: { description: 'Gerimis Sedang', type: 'rain' },
  55: { description: 'Gerimis Lebat', type: 'rain' },
  56: { description: 'Gerimis Dingin', type: 'rain' },
  57: { description: 'Gerimis Dingin Lebat', type: 'rain' },
  61: { description: 'Hujan Ringan', type: 'rain' },
  63: { description: 'Hujan Sedang', type: 'rain' },
  65: { description: 'Hujan Lebat', type: 'rain' },
  66: { description: 'Hujan Es Ringan', type: 'rain' },
  67: { description: 'Hujan Es Lebat', type: 'rain' },
  71: { description: 'Salju Ringan', type: 'snow' },
  73: { description: 'Salju Sedang', type: 'snow' },
  75: { description: 'Salju Lebat', type: 'snow' },
  77: { description: 'Butiran Salju', type: 'snow' },
  80: { description: 'Hujan Rintik', type: 'rain' },
  81: { description: 'Hujan Deras', type: 'rain' },
  82: { description: 'Hujan Sangat Deras', type: 'rain' },
  85: { description: 'Hujan Salju Ringan', type: 'snow' },
  86: { description: 'Hujan Salju Lebat', type: 'snow' },
  95: { description: 'Badai Petir', type: 'thunder' },
  96: { description: 'Badai Petir dengan Hujan Es', type: 'thunder' },
  99: { description: 'Badai Petir Hebat', type: 'thunder' },
};

export function interpretWeatherCode(code) {
  return WMO_CODES[code] ?? { description: 'Berawan', type: 'cloudy' };
}

export const WEATHER_ADVICE = {
  tsundere: {
    rain: 'Hujan tuh! Jangan lupa bawa payung, awas kalau sampai kehujanan dan sakit, bikin repot aja! 😤',
    hot: 'Panas banget hari ini! Minum air yang banyak, jangan sampai dehidrasi di jalan! B-bukan berarti aku khawatir ya! 😤',
    cold: 'Dingin banget di luar! Pakai jaket tebal napa, jangan sok kuat! 🙄',
    pleasant: 'Cuacanya lagi cerah dan lumayan adem. Manfaatin hari ini buat beraktivitas, jangan cuma rebahan! 🙄',
  },
  kalem: {
    rain: 'Kemungkinan akan turun hujan. Jangan lupa siapkan payung dan jaga kesehatanmu ya. 🌿',
    hot: 'Cuacanya cukup terik. Jangan lupa banyak minum air putih agar tetap terhidrasi ya. ☀️',
    cold: 'Udaranya cukup dingin. Kenakan pakaian yang hangat agar tidak masuk angin ya. ☕',
    pleasant: 'Cuaca hari ini cukup cerah dan sejuk. Waktu yang baik untuk beraktivitas di luar. ✨',
  },
  ceria: {
    rain: 'Ada potensi hujan nih! Jangan lupa bawa payung atau jas hujan yaaa! ☔✨',
    hot: 'Waaah panas dan cerah banget! Pakai tabir surya dan bawa botol minum yaaa! 🥤✨',
    cold: 'Dingiiin! Enak nih pakai jaket hangat atau minum cokelat panas! 🧣✨',
    pleasant: 'Yaaay cuacanya bersahabat banget! Waktu yang pas buat jalan-jalan atau produktif bareng! 🚀🎉',
  },
  sarkas: {
    rain: 'Hujan. Kalau kamu sengaja tidak membawa payung lalu basah kuyup, jangan salahkan cuaca. ☕',
    hot: 'Suhunya cukup untuk memanggang roti di aspal. Tetap di dalam ruangan jika tidak ada urusan darurat. 🕶️',
    cold: 'Udara dingin. Pilihan tepat untuk pura-pura sibuk sambil berselimut. ☕',
    pleasant: 'Cuacanya bagus. Tidak ada alasan menyalahkan alam semesta untuk kemalasanmu hari ini. ☕',
  },
  custom: {
    rain: 'Kemungkinan hujan. Disarankan membawa payung atau jas hujan saat bepergian.',
    hot: 'Cuaca panas terik. Jaga hidrasi tubuh dengan minum air yang cukup.',
    cold: 'Udara cukup dingin. Kenakan pakaian hangat yang nyaman.',
    pleasant: 'Cuaca hari ini bersahabat untuk beraktivitas.',
  },
};

/**
 * Memberikan saran satu kalimat in-character berdasarkan kode cuaca, suhu, dan peluang hujan.
 */
export function getWeatherAdvice({ code = 0, temp = 28, rainProb = 0, personaId = 'tsundere' } = {}) {
  const personaGroup = WEATHER_ADVICE[personaId] || WEATHER_ADVICE.tsundere;
  const wmo = interpretWeatherCode(code);

  if (wmo.type === 'rain' || wmo.type === 'thunder' || rainProb >= 60) {
    return personaGroup.rain;
  }
  if (temp >= 33) {
    return personaGroup.hot;
  }
  if (temp <= 20) {
    return personaGroup.cold;
  }
  return personaGroup.pleasant;
}

// In-memory cache: Map<cityName, { data: object, expiresAt: number }>
const WEATHER_CACHE = new Map();
export const CACHE_TTL_MS = 10 * 60 * 1000; // 10 menit

export function clearWeatherCache() {
  WEATHER_CACHE.clear();
}

/**
 * Mengambil koordinat geocoding dari Open-Meteo.
 */
export async function fetchCoordinates(cityName, { fetchFn = fetch, timeoutMs = 8000 } = {}) {
  if (!cityName || typeof cityName !== 'string') return null;
  const cleanName = cityName.trim();
  if (!cleanName) return null;

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    cleanName,
  )}&count=1&language=id&format=json`;

  const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    throw new Error(`Geocoding HTTP error: ${res.status}`);
  }

  const data = await res.json();
  if (!data?.results || data.results.length === 0) {
    return null;
  }

  const item = data.results[0];
  return {
    name: item.name,
    latitude: item.latitude,
    longitude: item.longitude,
    country: item.country || '',
    admin1: item.admin1 || '',
    timezone: item.timezone || 'Asia/Jakarta',
  };
}

/**
 * Mengambil data prakiraan cuaca dari Open-Meteo Forecast API.
 */
export async function fetchForecast(lat, lon, { fetchFn = fetch, timeoutMs = 8000 } = {}) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;

  const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    throw new Error(`Forecast HTTP error: ${res.status}`);
  }

  return await res.json();
}

/**
 * Mengambil cuaca lengkap per kota dengan cache in-memory.
 */
export async function getWeatherData(
  cityName,
  { fetchFn = fetch, timeoutMs = 8000, now = Date.now() } = {},
) {
  if (!cityName || typeof cityName !== 'string') return null;
  const normalizedKey = cityName.trim().toLowerCase();
  if (!normalizedKey) return null;

  // Cek cache
  const cached = WEATHER_CACHE.get(normalizedKey);
  if (cached && now < cached.expiresAt) {
    return cached.data;
  }

  // 1. Ambil koordinat
  const geo = await fetchCoordinates(cityName, { fetchFn, timeoutMs });
  if (!geo) {
    return null;
  }

  // 2. Ambil prakiraan cuaca
  const raw = await fetchForecast(geo.latitude, geo.longitude, { fetchFn, timeoutMs });
  const current = raw?.current || {};
  const daily = raw?.daily || {};

  const weatherCode = current.weather_code ?? 0;
  const condition = interpretWeatherCode(weatherCode);

  const temp = Math.round(current.temperature_2m ?? 0);
  const feelsLike = Math.round(current.apparent_temperature ?? temp);
  const humidity = Math.round(current.relative_humidity_2m ?? 0);
  const windSpeed = Math.round(current.wind_speed_10m ?? 0);

  const minTemp = daily.temperature_2m_min?.[0] != null ? Math.round(daily.temperature_2m_min[0]) : temp;
  const maxTemp = daily.temperature_2m_max?.[0] != null ? Math.round(daily.temperature_2m_max[0]) : temp;
  const rainProb = daily.precipitation_probability_max?.[0] ?? Math.round((current.precipitation || 0) > 0 ? 80 : 10);

  const locationTitle = [geo.name, geo.admin1, geo.country].filter(Boolean).join(', ');

  const result = {
    city: geo.name,
    locationTitle,
    temp,
    feelsLike,
    minTemp,
    maxTemp,
    humidity,
    windSpeed,
    rainProb,
    weatherCode,
    conditionText: condition.description,
    conditionType: condition.type,
  };

  // Simpan ke cache
  WEATHER_CACHE.set(normalizedKey, {
    data: result,
    expiresAt: now + CACHE_TTL_MS,
  });

  return result;
}

/**
 * Format laporan cuaca lengkap untuk dikirimkan ke chat Telegram.
 */
export function formatWeatherReport({ weather, personaId = 'tsundere' }) {
  if (!weather) return 'Data cuaca tidak tersedia.';

  const advice = getWeatherAdvice({
    code: weather.weatherCode,
    temp: weather.temp,
    rainProb: weather.rainProb,
    personaId,
  });

  const icon =
    weather.conditionType === 'rain'
      ? '🌧️'
      : weather.conditionType === 'thunder'
      ? '⛈️'
      : weather.conditionType === 'snow'
      ? '❄️'
      : weather.temp >= 33
      ? '☀️'
      : '🌤️';

  return (
    `${icon} *Cuaca di ${weather.locationTitle}:*\n` +
    `• *Kondisi:* ${weather.conditionText}\n` +
    `• *Suhu:* ${weather.temp}°C (terasa seperti ${weather.feelsLike}°C)\n` +
    `• *Rentang:* ${weather.minTemp}°C - ${weather.maxTemp}°C\n` +
    `• *Kelembapan:* ${weather.humidity}%\n` +
    `• *Peluang Hujan:* ${weather.rainProb}%\n` +
    `• *Kecepatan Angin:* ${weather.windSpeed} km/jam\n\n` +
    `💬 _"${advice}"_`
  );
}

