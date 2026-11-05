import './setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/core/db.js';
import { getSetting, setSetting } from '../src/core/settings.js';
import {
  WMO_CODES,
  interpretWeatherCode,
  getWeatherAdvice,
  fetchCoordinates,
  fetchForecast,
  getWeatherData,
  formatWeatherReport,
  clearWeatherCache,
  CACHE_TTL_MS,
} from '../src/core/weather.js';
import weatherFeature from '../src/features/weather.js';
import { buildMorningMessage } from '../src/features/schedules.js';
import { extractActions } from '../src/core/actions.js';

describe('F-40: Cuaca (Open-Meteo)', () => {
  const TEST_USER = 665544;
  const TEST_CHAT = 665544;

  beforeEach(() => {
    clearWeatherCache();
    const db = getDb();
    db.prepare('UPDATE users SET city = NULL WHERE id = ?').run(TEST_USER);
    db.prepare('UPDATE chats SET city = NULL WHERE id = ?').run(TEST_CHAT);
  });

  describe('WMO Code Interpreter', () => {
    it('menerjemahkan kode WMO cuaca dengan deskripsi dan tipe yang tepat', () => {
      assert.equal(interpretWeatherCode(0).description, 'Cerah');
      assert.equal(interpretWeatherCode(0).type, 'clear');

      assert.equal(interpretWeatherCode(2).description, 'Sebagian Berawan');
      assert.equal(interpretWeatherCode(2).type, 'cloudy');

      assert.equal(interpretWeatherCode(61).description, 'Hujan Ringan');
      assert.equal(interpretWeatherCode(61).type, 'rain');

      assert.equal(interpretWeatherCode(95).description, 'Badai Petir');
      assert.equal(interpretWeatherCode(95).type, 'thunder');
    });

    it('fallback ke berawan jika kode cuaca tidak dikenal', () => {
      const fallback = interpretWeatherCode(9999);
      assert.equal(fallback.description, 'Berawan');
      assert.equal(fallback.type, 'cloudy');
    });
  });

  describe('getWeatherAdvice (Saran In-Character)', () => {
    it('memberikan saran hujan jika cuaca hujan atau peluang hujan tinggi', () => {
      const tsundereRain = getWeatherAdvice({ code: 61, rainProb: 70, personaId: 'tsundere' });
      assert.ok(tsundereRain.includes('payung'));
      assert.ok(tsundereRain.includes('bodoh') || tsundereRain.includes('repot'));

      const kalemRain = getWeatherAdvice({ code: 61, rainProb: 70, personaId: 'kalem' });
      assert.ok(kalemRain.includes('payung'));
      assert.ok(kalemRain.includes('kesehatan'));

      const ceriaRain = getWeatherAdvice({ code: 61, rainProb: 70, personaId: 'ceria' });
      assert.ok(ceriaRain.includes('payung'));

      const sarkasRain = getWeatherAdvice({ code: 61, rainProb: 70, personaId: 'sarkas' });
      assert.ok(sarkasRain.includes('payung'));
    });

    it('memberikan saran cuaca panas jika suhu >= 33 derajat', () => {
      const tsundereHot = getWeatherAdvice({ code: 0, temp: 34, rainProb: 10, personaId: 'tsundere' });
      assert.ok(tsundereHot.includes('Panas') || tsundereHot.includes('dehidrasi'));

      const sarkasHot = getWeatherAdvice({ code: 0, temp: 35, rainProb: 5, personaId: 'sarkas' });
      assert.ok(sarkasHot.includes('memanggang') || sarkasHot.includes('ruangan'));
    });

    it('memberikan saran cuaca sejuk/cerah jika kondisi normal', () => {
      const tsunderePleasant = getWeatherAdvice({ code: 0, temp: 27, rainProb: 10, personaId: 'tsundere' });
      assert.ok(tsunderePleasant.includes('rebahan') || tsunderePleasant.includes('beraktivitas'));
    });
  });

  describe('fetchCoordinates & Geocoding API', () => {
    it('mengembalikan koordinat kota dari mock geocoding', async () => {
      const mockFetch = async (url) => {
        assert.ok(url.includes('search?name=Bandung'));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              {
                id: 1650357,
                name: 'Bandung',
                latitude: -6.90389,
                longitude: 107.61861,
                country: 'Indonesia',
                admin1: 'Jawa Barat',
                timezone: 'Asia/Jakarta',
              },
            ],
          }),
        };
      };

      const geo = await fetchCoordinates('Bandung', { fetchFn: mockFetch });
      assert.ok(geo);
      assert.equal(geo.name, 'Bandung');
      assert.equal(geo.latitude, -6.90389);
      assert.equal(geo.longitude, 107.61861);
      assert.equal(geo.country, 'Indonesia');
    });

    it('mengembalikan null jika kota tidak ditemukan atau input kosong', async () => {
      const mockFetchEmpty = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      const notFound = await fetchCoordinates('KotaTidakPernahAda123', { fetchFn: mockFetchEmpty });
      assert.equal(notFound, null);

      assert.equal(await fetchCoordinates(''), null);
      assert.equal(await fetchCoordinates(null), null);
    });

    it('melemparkan error jika server geocoding gagal HTTP', async () => {
      const mockFetchFail = async () => ({
        ok: false,
        status: 500,
      });

      await assert.rejects(() => fetchCoordinates('Jakarta', { fetchFn: mockFetchFail }), /HTTP error: 500/);
    });
  });

  describe('getWeatherData & In-Memory Cache', () => {
    const fakeGeo = {
      name: 'Yogyakarta',
      latitude: -7.7956,
      longitude: 110.3695,
      country: 'Indonesia',
      admin1: 'Daerah Istimewa Yogyakarta',
      timezone: 'Asia/Jakarta',
    };

    const fakeForecast = {
      current: {
        time: '2026-11-05T07:00',
        temperature_2m: 30.2,
        apparent_temperature: 34.5,
        relative_humidity_2m: 72,
        wind_speed_10m: 8.5,
        weather_code: 1,
        precipitation: 0.0,
      },
      daily: {
        temperature_2m_max: [33.0],
        temperature_2m_min: [24.0],
        precipitation_probability_max: [20],
      },
    };

    it('menggabungkan geocoding dan forecast ke struktur data cuaca yang rapi', async () => {
      let callCount = 0;
      const mockFetch = async (url) => {
        callCount++;
        if (url.includes('geocoding-api')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ results: [fakeGeo] }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => fakeForecast,
        };
      };

      const weather = await getWeatherData('Yogyakarta', { fetchFn: mockFetch });
      assert.ok(weather);
      assert.equal(weather.city, 'Yogyakarta');
      assert.equal(weather.temp, 30);
      assert.equal(weather.feelsLike, 35);
      assert.equal(weather.humidity, 72);
      assert.equal(weather.rainProb, 20);
      assert.equal(weather.conditionText, 'Cerah Berawan');

      // Panggilan kedua dalam batas waktu TTL: harus mengambil dari cache (tidak memanggil fetch lagi)
      const cachedWeather = await getWeatherData('yogyakarta', { fetchFn: mockFetch });
      assert.equal(callCount, 2); // 1 geocoding + 1 forecast dari putaran pertama
      assert.deepEqual(cachedWeather, weather);
    });

    it('mengambil ulang data dari jaringan setelah waktu cache kedaluwarsa', async () => {
      let fetchCount = 0;
      const mockFetch = async (url) => {
        fetchCount++;
        if (url.includes('geocoding-api')) {
          return { ok: true, status: 200, json: async () => ({ results: [fakeGeo] }) };
        }
        return { ok: true, status: 200, json: async () => fakeForecast };
      };

      const now = 1000000;
      await getWeatherData('Yogyakarta', { fetchFn: mockFetch, now });
      assert.equal(fetchCount, 2);

      // Lewat dari CACHE_TTL_MS: harus memanggil fetch lagi
      await getWeatherData('Yogyakarta', { fetchFn: mockFetch, now: now + CACHE_TTL_MS + 1000 });
      assert.equal(fetchCount, 4);
    });
  });

  describe('formatWeatherReport', () => {
    it('merender kartu cuaca markdown yang lengkap dan rapi', () => {
      const sampleWeather = {
        city: 'Surabaya',
        locationTitle: 'Surabaya, Jawa Timur, Indonesia',
        temp: 34,
        feelsLike: 39,
        minTemp: 26,
        maxTemp: 35,
        humidity: 68,
        windSpeed: 14,
        rainProb: 15,
        weatherCode: 0,
        conditionText: 'Cerah',
        conditionType: 'clear',
      };

      const report = formatWeatherReport({ weather: sampleWeather, personaId: 'tsundere' });
      assert.ok(report.includes('Cuaca di Surabaya, Jawa Timur, Indonesia'));
      assert.ok(report.includes('34°C'));
      assert.ok(report.includes('Cerah'));
      assert.ok(report.includes('68%'));
      assert.ok(report.includes('dehidrasi') || report.includes('Panas'));
    });
  });

  describe('Penyimpanan Kota User (/kota)', () => {
    it('setSetting dan getSetting menyimpan preferensi city di SQLite', () => {
      const ctx = {
        chat: { type: 'private', id: TEST_CHAT },
        from: { id: TEST_USER },
      };

      setSetting(ctx, 'city', 'Semarang');
      assert.equal(getSetting(ctx, 'city'), 'Semarang');
    });

    it('/kota tanpa argumen menampilkan status kota saat ini atau panduan', async () => {
      const replies = [];
      const ctx = {
        chat: { type: 'private', id: TEST_CHAT },
        from: { id: TEST_USER },
        message: { text: '/kota' },
        reply: async (text) => replies.push(text),
      };

      const cmd = weatherFeature.commands.find((c) => c.name === 'kota');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].includes('Belum ada kota'));

      // Setelah diatur:
      setSetting(ctx, 'city', 'Denpasar');
      replies.length = 0;
      await cmd.handler(ctx);
      assert.ok(replies[0].includes('Denpasar'));
    });

    it('/kota <nama> memvalidasi kota dan menyimpannya', async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        if (url.includes('search?name=Bogor')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              results: [{ name: 'Bogor', latitude: -6.5944, longitude: 106.7892, country: 'Indonesia' }],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ results: [] }) };
      };

      try {
        const replies = [];
        const ctx = {
          chat: { type: 'private', id: TEST_CHAT },
          from: { id: TEST_USER },
          message: { text: '/kota Bogor' },
          replyWithChatAction: async () => {},
          reply: async (text) => replies.push(text),
        };

        const cmd = weatherFeature.commands.find((c) => c.name === 'kota');
        await cmd.handler(ctx);

        assert.equal(replies.length, 1);
        assert.ok(replies[0].includes('Bogor'));
        assert.equal(getSetting(ctx, 'city'), 'Bogor');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('/kota dengan nama kota fiktif mengembalikan pesan error', async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      try {
        const replies = [];
        const ctx = {
          chat: { type: 'private', id: TEST_CHAT },
          from: { id: TEST_USER },
          message: { text: '/kota KotaAntahBerantah123' },
          replyWithChatAction: async () => {},
          reply: async (text) => replies.push(text),
        };

        const cmd = weatherFeature.commands.find((c) => c.name === 'kota');
        await cmd.handler(ctx);

        assert.equal(replies.length, 1);
        assert.ok(replies[0].includes('tidak ditemukan'));
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  describe('Perintah /cuaca', () => {
    it('/cuaca meminta user mengatur kota jika belum ada kota tersimpan', async () => {
      const replies = [];
      const ctx = {
        chat: { type: 'private', id: TEST_CHAT },
        from: { id: TEST_USER },
        message: { text: '/cuaca' },
        reply: async (text) => replies.push(text),
      };

      const cmd = weatherFeature.commands.find((c) => c.name === 'cuaca');
      await cmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].includes('belum mengatur kota'));
    });

    it('/cuaca <kota> mengambil cuaca untuk kota yang diminta', async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        if (url.includes('geocoding-api')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              results: [{ name: 'Malang', latitude: -7.9797, longitude: 112.6304, country: 'Indonesia' }],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            current: { temperature_2m: 25, relative_humidity_2m: 80, weather_code: 61 },
            daily: { temperature_2m_max: [28], temperature_2m_min: [20], precipitation_probability_max: [85] },
          }),
        };
      };

      try {
        const replies = [];
        const ctx = {
          chat: { type: 'private', id: TEST_CHAT },
          from: { id: TEST_USER },
          message: { text: '/cuaca Malang' },
          replyWithChatAction: async () => {},
          reply: async (text) => replies.push(text),
        };

        const cmd = weatherFeature.commands.find((c) => c.name === 'cuaca');
        await cmd.handler(ctx);

        assert.equal(replies.length, 1);
        assert.ok(replies[0].includes('Cuaca di Malang'));
        assert.ok(replies[0].includes('25°C'));
        assert.ok(replies[0].includes('Hujan'));
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  describe('Tag Aksi [WEATHER: kota]', () => {
    it('mengekstrak tag WEATHER secara bersih', () => {
      const raw = 'Hari ini sepertinya cerah ya! [WEATHER: Jakarta]';
      const { text, actions } = extractActions(raw, weatherFeature.tags);

      assert.equal(text, 'Hari ini sepertinya cerah ya!');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].name, 'WEATHER');
      assert.deepEqual(actions[0].args, ['Jakarta']);
    });

    it('handler tag WEATHER mengirim kartu cuaca', async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        if (url.includes('geocoding-api')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              results: [{ name: 'Medan', latitude: 3.5952, longitude: 98.6722, country: 'Indonesia' }],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            current: { temperature_2m: 31, relative_humidity_2m: 75, weather_code: 2 },
            daily: { temperature_2m_max: [33], temperature_2m_min: [24], precipitation_probability_max: [30] },
          }),
        };
      };

      try {
        const replies = [];
        const ctx = {
          reply: async (text) => replies.push(text),
        };

        const tagDef = weatherFeature.tags.find((t) => t.name === 'WEATHER');
        await tagDef.handle(ctx, ['Medan']);

        assert.equal(replies.length, 1);
        assert.ok(replies[0].includes('Cuaca di Medan'));
        assert.ok(replies[0].includes('31°C'));
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  describe('Integrasi Pesan Pagi (F-13)', () => {
    it('buildMorningMessage menyertakan cuaca jika weatherSummary diberikan', () => {
      const summary = '• Di *Bandung*: Sebagian Berawan, suhu 24°C (peluang hujan 20%).';
      const msg = buildMorningMessage({
        userId: TEST_USER,
        tz: 'Asia/Jakarta',
        weatherSummary: summary,
      });

      assert.ok(msg.includes('Prakiraan Cuaca Hari Ini:'));
      assert.ok(msg.includes('Di *Bandung*'));
      assert.ok(msg.includes('24°C'));
    });
  });
});

