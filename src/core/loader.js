import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getAdminIds, isAdmin } from './guards.js';

export const CORE_FEATURE_IDS = new Set(['core', 'settings']);

// Set in-memory pencatat chat_id admin yang scope menunya sudah berhasil didaftarkan
export const registeredAdminChats = new Set();

/**
 * Muat modul fitur dari folder src/features/.
 * Mendukung filter lewat format string FEATURES=reminders,todo atau 'all'.
 * Fitur inti (core, settings) selalu aktif dan tidak perlu ada di FEATURES.
 * Typo pada FEATURES menghasilkan log peringatan 1 baris tanpa crash.
 * Jika fitur admin tidak ada di FEATURES, perintah admin ditiadakan.
 */
export async function loadFeatures({
  dir = path.resolve('src', 'features'),
  enabledFeatures = process.env.FEATURES ?? 'all',
} = {}) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.js') && !file.startsWith('_') && !file.endsWith('.test.js'));

  const isAll = !enabledFeatures || enabledFeatures.trim().toLowerCase() === 'all';
  const enabledSet = new Set(
    (enabledFeatures || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  const loadedModules = [];
  for (const file of files) {
    const filePath = path.join(dir, file);
    const mod = await import(pathToFileURL(filePath).href);
    const feature = mod.default ?? mod;

    if (!feature || !feature.id) {
      console.warn(`Modul fitur di ${file} tidak memiliki properti 'id', dilewati.`);
      continue;
    }
    loadedModules.push(feature);
  }

  // Kumpulkan semua ID modul yang sah untuk validasi typo
  const validFeatureIds = new Set(loadedModules.map((f) => f.id.toLowerCase()));
  for (const coreId of CORE_FEATURE_IDS) {
    validFeatureIds.add(coreId);
  }

  // Peringatan jika ada nama fitur tidak dikenal (typo) di FEATURES
  if (!isAll) {
    const unknownFeatures = [...enabledSet].filter((fid) => !validFeatureIds.has(fid));
    if (unknownFeatures.length > 0) {
      console.warn(`[Features] Peringatan: Fitur tidak dikenal di FEATURES: ${unknownFeatures.join(', ')}`);
    }
  }

  const hasAdminInFeatures = isAll || enabledSet.has('admin');
  const features = [];

  for (const feature of loadedModules) {
    const fid = feature.id.toLowerCase();
    const isCore = CORE_FEATURE_IDS.has(fid);

    if (isCore || isAll || enabledSet.has(fid)) {
      // Jika fitur admin tidak aktif di FEATURES, hilangkan perintah adminOnly
      if (!hasAdminInFeatures && Array.isArray(feature.commands)) {
        features.push({
          ...feature,
          commands: feature.commands.filter((cmd) => !cmd.adminOnly),
        });
      } else {
        features.push(feature);
      }
    }
  }

  return features;
}

/**
 * Daftarkan semua fitur yang dimuat ke bot grammY.
 */
export async function registerFeatures({ bot, features = [], context = {} }) {
  const allCommands = [];
  const allTags = [];
  const allCallbacks = [];

  // Helper agar command handler (seperti /help) bisa tahu daftar seluruh perintah aktif
  const getActiveCommands = () => [...allCommands];

  const fullContext = {
    bot,
    getActiveCommands,
    ...context,
  };

  for (const feature of features) {
    // 1. Eksekusi init bila tersedia
    if (typeof feature.init === 'function') {
      try {
        await feature.init({ ...fullContext, feature });
      } catch (err) {
        console.error(`Gagal inisialisasi fitur "${feature.id}":`, err);
      }
    }

    // 2. Daftarkan perintah (commands)
    if (Array.isArray(feature.commands)) {
      for (const cmd of feature.commands) {
        if (!cmd.name || typeof cmd.handler !== 'function') continue;
        allCommands.push(cmd);

        if (bot && typeof bot.command === 'function') {
          bot.command(cmd.name, async (ctx) => {
            // Pengamanan di sisi bot.command: tolak non-admin secara diam
            if (cmd.adminOnly && !isAdmin(ctx.from?.id)) {
              return;
            }

            try {
              await cmd.handler(ctx);
            } catch (err) {
              console.error(`Error pada perintah /${cmd.name}:`, err);
              const errorMsg =
                ctx.persona?.errorMessage ??
                fullContext.persona?.errorMessage ??
                'Terjadi kesalahan saat memproses perintah.';
              await ctx.reply(errorMsg).catch(() => {});
            }
          });
        }
      }
    }

    // 3. Daftarkan callbacks
    if (Array.isArray(feature.callbacks)) {
      for (const cb of feature.callbacks) {
        if (!cb.prefix || typeof cb.handler !== 'function') continue;
        allCallbacks.push(cb);

        if (bot && typeof bot.callbackQuery === 'function') {
          bot.callbackQuery(new RegExp(`^${cb.prefix}`), async (ctx) => {
            try {
              await cb.handler(ctx);
            } catch (err) {
              console.error(`Error pada callback ${cb.prefix}:`, err);
              await ctx.answerCallbackQuery({ text: 'Terjadi kesalahan.' }).catch(() => {});
            }
          });
        }
      }
    }

    // 4. Kumpulkan tags untuk parser LLM
    if (Array.isArray(feature.tags)) {
      for (const tag of feature.tags) {
        if (tag.name) allTags.push(tag);
      }
    }
  }

  return { allCommands, allTags, allCallbacks };
}

function formatTelegramCommands(commands = []) {
  const seen = new Set();
  const valid = [];
  for (const cmd of commands) {
    if (!cmd.name || !/^[a-z0-9_]{1,32}$/.test(cmd.name)) continue;
    if (seen.has(cmd.name)) continue;
    seen.add(cmd.name);
    valid.push({
      command: cmd.name,
      description: (cmd.description || cmd.name).slice(0, 256),
    });
  }
  return valid;
}

/**
 * Daftarkan daftar perintah aktif ke menu Telegram via setMyCommands.
 * Scope default (all users): hanya perintah publik.
 * Scope chat admin: perintah publik + perintah admin.
 */
export async function syncBotCommands({
  bot,
  commands = [],
  adminIds = getAdminIds(),
}) {
  if (!bot?.api?.setMyCommands) return;

  const publicCommands = commands.filter((cmd) => !cmd.adminOnly);
  const adminCommands = commands.filter((cmd) => cmd.adminOnly);

  const formattedPublic = formatTelegramCommands(publicCommands);
  const formattedAdmin = formatTelegramCommands([...publicCommands, ...adminCommands]);

  // 1. Daftarkan scope default (hanya perintah publik)
  if (formattedPublic.length > 0) {
    try {
      await bot.api.setMyCommands(formattedPublic);
    } catch (err) {
      console.warn('Gagal mendaftarkan menu perintah publik (setMyCommands):', err.message);
    }
  }

  // 2. Daftarkan scope chat per admin (perintah publik + admin)
  if (formattedAdmin.length > 0 && adminCommands.length > 0) {
    for (const adminId of adminIds) {
      try {
        await bot.api.setMyCommands(formattedAdmin, {
          scope: { type: 'chat', chat_id: adminId },
        });
        registeredAdminChats.add(adminId);
      } catch (err) {
        console.warn(`[Commands] Belum dapat mendaftarkan menu admin untuk chat ID ${adminId}: ${err.message}`);
      }
    }
  }
}

/**
 * Pastikan menu admin terdaftar untuk admin yang baru mengirim pesan/start.
 */
export async function ensureAdminCommands({
  bot,
  userId,
  commands = [],
  adminIds = getAdminIds(),
}) {
  if (!bot?.api?.setMyCommands) return;
  if (!userId || registeredAdminChats.has(userId)) return;

  const adminSet = new Set(adminIds);
  if (!adminSet.has(userId)) return;

  const publicCommands = commands.filter((cmd) => !cmd.adminOnly);
  const adminCommands = commands.filter((cmd) => cmd.adminOnly);

  if (adminCommands.length === 0) return;

  const formattedAdmin = formatTelegramCommands([...publicCommands, ...adminCommands]);
  try {
    await bot.api.setMyCommands(formattedAdmin, {
      scope: { type: 'chat', chat_id: userId },
    });
    registeredAdminChats.add(userId);
  } catch (err) {
    console.warn(`[Commands] Gagal memperbarui menu admin untuk chat ID ${userId}: ${err.message}`);
  }
}
