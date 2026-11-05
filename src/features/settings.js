import { InlineKeyboard } from 'grammy';
import { getSetting, setSetting, isValidTimezone } from '../core/settings.js';
import { listPersonalities } from '../personalities/index.js';

function getPersona(ctx) {
  return ctx?.persona ?? { strings: {} };
}

function renderMainMenu(ctx) {
  const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
  const gifFreq = getSetting(ctx, 'gif_freq', 'normal');
  const personaId = getSetting(ctx, 'persona', 'tsundere');
  const lang = getSetting(ctx, 'lang', 'id');

  const p = getPersona(ctx);
  const header = p.strings?.settingsHeader ?? '⚙️ *Pengaturan Bot*';

  const text = [
    header,
    '',
    `• Zona Waktu: \`${tz}\``,
    `• Frekuensi GIF: \`${gifFreq}\``,
    `• Persona: \`${personaId}\``,
    `• Bahasa: \`${lang}\``,
    '',
    'Pilih opsi di bawah untuk mengubah:',
  ].join('\n');

  const keyboard = new InlineKeyboard()
    .text('🌐 Zona Waktu', 'set:menu:tz')
    .text('🎬 Frekuensi GIF', 'set:menu:gif')
    .row()
    .text('🎭 Persona', 'set:menu:persona')
    .text('🗣️ Bahasa', 'set:menu:lang')
    .row()
    .text('✖️ Tutup', 'set:close');

  return { text, keyboard };
}

function renderTzMenu() {
  const text = [
    '🌐 *Pengaturan Zona Waktu*',
    '',
    'Pilih zona waktu cepat Indonesia, atau gunakan perintah manual:',
    '`/timezone Asia/Makassar`',
  ].join('\n');

  const keyboard = new InlineKeyboard()
    .text('WIB (Jakarta)', 'set:val:tz:Asia/Jakarta')
    .text('WITA (Makassar)', 'set:val:tz:Asia/Makassar')
    .row()
    .text('WIT (Jayapura)', 'set:val:tz:Asia/Jayapura')
    .row()
    .text('🔙 Kembali', 'set:menu:main');

  return { text, keyboard };
}

function renderGifMenu() {
  const text = [
    '🎬 *Frekuensi GIF*',
    '',
    'Atur seberapa sering bot mengirimkan animasi GIF:',
  ].join('\n');

  const keyboard = new InlineKeyboard()
    .text('Mati', 'set:val:gif_freq:off')
    .text('Jarang (1/10)', 'set:val:gif_freq:rare')
    .row()
    .text('Normal (1/4)', 'set:val:gif_freq:normal')
    .text('Sering (1/2)', 'set:val:gif_freq:often')
    .row()
    .text('🔙 Kembali', 'set:menu:main');

  return { text, keyboard };
}

function renderPersonaMenu() {
  const personas = listPersonalities();
  const keyboard = new InlineKeyboard();

  for (const id of personas) {
    keyboard.text(id, `set:val:persona:${id}`);
  }
  keyboard.row().text('🔙 Kembali', 'set:menu:main');

  const text = '🎭 *Pilih Persona Aktif:*\n(Pengaturan persona per-chat)';
  return { text, keyboard };
}

function renderLangMenu() {
  const text = '🗣️ *Pilih Bahasa / Language:*';
  const keyboard = new InlineKeyboard()
    .text('🇮🇩 Indonesia', 'set:val:lang:id')
    .text('🇬🇧 English', 'set:val:lang:en')
    .row()
    .text('🔙 Kembali', 'set:menu:main');

  return { text, keyboard };
}

export default {
  id: 'settings',

  commands: [
    {
      name: 'settings',
      description: 'Atur preferensi bot (zona waktu, GIF, bahasa, persona)',
      handler: async (ctx) => {
        const { text, keyboard } = renderMainMenu(ctx);
        await ctx.reply(text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      },
    },
    {
      name: 'timezone',
      description: 'Ganti zona waktu (contoh: /timezone Asia/Makassar)',
      handler: async (ctx) => {
        const p = getPersona(ctx);
        const args = ctx.message.text.split(/\s+/).slice(1);
        const inputTz = args[0]?.trim();

        if (!inputTz) {
          const currentTz = getSetting(ctx, 'tz', 'Asia/Jakarta');
          await ctx.reply(
            `Zona waktumu saat ini: ${currentTz}\nUntuk mengganti, ketik: /timezone <nama_iana>\nContoh: /timezone Asia/Makassar atau /timezone Europe/London`,
          );
          return;
        }

        if (!isValidTimezone(inputTz)) {
          const errMsg =
            p.strings?.tzInvalid ??
            `Format zona waktu '${inputTz}' tidak valid. Gunakan nama IANA yang benar seperti Asia/Jakarta atau Asia/Makassar.`;
          await ctx.reply(errMsg);
          return;
        }

        setSetting(ctx, 'tz', inputTz);

        const successMsg =
          p.strings?.tzSuccess?.replace('{tz}', inputTz) ??
          `Zona waktu berhasil diubah ke ${inputTz}.`;
        await ctx.reply(successMsg);
      },
    },
  ],

  callbacks: [
    {
      prefix: 'set:',
      handler: async (ctx) => {
        const data = ctx.callbackQuery.data; // e.g. set:menu:tz or set:val:tz:Asia/Jakarta

        if (data === 'set:close') {
          await ctx.deleteMessage().catch(() => {});
          await ctx.answerCallbackQuery().catch(() => {});
          return;
        }

        if (data === 'set:menu:main') {
          const { text, keyboard } = renderMainMenu(ctx);
          await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          }).catch(() => {});
          await ctx.answerCallbackQuery().catch(() => {});
          return;
        }

        if (data === 'set:menu:tz') {
          const { text, keyboard } = renderTzMenu();
          await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          }).catch(() => {});
          await ctx.answerCallbackQuery().catch(() => {});
          return;
        }

        if (data === 'set:menu:gif') {
          const { text, keyboard } = renderGifMenu();
          await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          }).catch(() => {});
          await ctx.answerCallbackQuery().catch(() => {});
          return;
        }

        if (data === 'set:menu:persona') {
          const { text, keyboard } = renderPersonaMenu();
          await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          }).catch(() => {});
          await ctx.answerCallbackQuery().catch(() => {});
          return;
        }

        if (data === 'set:menu:lang') {
          const { text, keyboard } = renderLangMenu();
          await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          }).catch(() => {});
          await ctx.answerCallbackQuery().catch(() => {});
          return;
        }

        // Penanganan pemilihan nilai: set:val:<key>:<value>
        if (data.startsWith('set:val:')) {
          const parts = data.slice('set:val:'.length).split(':');
          const key = parts[0];
          const val = parts.slice(1).join(':');

          try {
            setSetting(ctx, key, val);
            const p = getPersona(ctx);
            const savedMsg = p.strings?.settingsSaved ?? 'Pengaturan berhasil diperbarui.';
            await ctx.answerCallbackQuery({ text: savedMsg }).catch(() => {});

            // Kembali ke menu utama dengan status terbaru
            const { text, keyboard } = renderMainMenu(ctx);
            await ctx.editMessageText(text, {
              parse_mode: 'Markdown',
              reply_markup: keyboard,
            }).catch(() => {});
          } catch (err) {
            await ctx.answerCallbackQuery({ text: err.message }).catch(() => {});
          }
        }
      },
    },
  ],
};

