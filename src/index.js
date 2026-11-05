import 'dotenv/config'; // harus paling atas supaya .env terbaca sebelum modul lain

import { Bot, InputFile } from 'grammy';
import { generateReply, generateVisionReply } from './llm.js';
import { addMessage, flush, getHistory } from './memory.js';
import { getPersonality } from './personalities/index.js';
import { loadFeatures, registerFeatures, syncBotCommands, ensureAdminCommands } from './core/loader.js';
import { closeDb, getDb, upsertChat, upsertUser } from './core/db.js';
import { getSetting, getEffectivePersona, getEffectiveExpressionMode } from './core/settings.js';
import { shapeReply } from './core/expression.js';
import { buildSystemPrompt, extractActions } from './core/actions.js';
import { isUserAllowed, isAdmin, isStaleMessage, isInputTooLong, RateLimiter, getAdminIds } from './core/guards.js';
import { startScheduler, stopScheduler } from './core/scheduler.js';
import { extractAndSaveFacts, summarizeOlderHistory } from './core/facts.js';
import { recordInteraction } from './core/affinity.js';
import { getAdminAddStickerMode, addSticker } from './core/stickers.js';
import { resetProactiveUnreplied } from './core/proactive.js';
import { recordGroupMessage, shouldChattyTrigger } from './core/groups.js';
import { isUserBanned, isMaintenanceMode } from './core/admin.js';
import { startServer, stopServer } from './core/server.js';
import { getUserUsageToday, checkAndAlertTokenLimit } from './core/usage.js';
import { logger } from './core/logger.js';
import { textToSpeech, getPersonaVoice } from './core/voice.js';

const { TELEGRAM_BOT_TOKEN, LLM_API_KEY, PERSONALITY } = process.env;

if (!TELEGRAM_BOT_TOKEN || !LLM_API_KEY) {
  console.error('TELEGRAM_BOT_TOKEN dan LLM_API_KEY wajib diisi di file .env');
  process.exit(1);
}

const persona = getPersonality(PERSONALITY || 'tsundere');
const bot = new Bot(TELEGRAM_BOT_TOKEN);
const rateLimiter = new RateLimiter();

// --- Antrian per chat, supaya pesan beruntun diproses berurutan ---------------
const locks = new Map();
const queueCounts = new Map();
const MAX_QUEUE_PER_CHAT = Number(process.env.MAX_QUEUE_PER_CHAT ?? 5);

function withLock(key, task) {
  const current = queueCounts.get(key) ?? 0;
  if (current >= MAX_QUEUE_PER_CHAT) {
    return Promise.reject(new Error('QUEUE_FULL'));
  }
  queueCounts.set(key, current + 1);

  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  locks.set(key, next);
  next
    .catch(() => {})
    .finally(() => {
      const q = (queueCounts.get(key) ?? 1) - 1;
      if (q <= 0) queueCounts.delete(key);
      else queueCounts.set(key, q);

      if (locks.get(key) === next) locks.delete(key);
    });
  return next;
}

// --- Pasang middleware & daftarkan modul fitur --------------------------------
bot.use(async (ctx, next) => {
  // 1. Abaikan pesan dari bot lain
  if (ctx.from?.is_bot) return;

  // 2. Abaikan pesan usang saat bot baru hidup
  if (ctx.message?.date && isStaleMessage(ctx.message.date)) {
    return;
  }

  // 3. Cek user yang diblokir (banned)
  if (ctx.from?.id && isUserBanned(ctx.from.id)) {
    return;
  }

  // 4. Cek mode maintenance (F-60)
  if (isMaintenanceMode() && !isAdmin(ctx.from?.id)) {
    if (ctx.chat?.type === 'private') {
      await ctx.reply('🔧 Bot sedang dalam mode pemeliharaan (maintenance). Silakan coba lagi nanti ya!').catch(() => {});
    }
    return;
  }

  // 5. Cek izin akses user (whitelist)
  if (!isUserAllowed(ctx.from?.id)) {
    if (ctx.chat?.type === 'private') {
      const p = ctx.persona ?? persona;
      const unauth = p.strings?.unauthorized ?? 'Akses tidak diizinkan.';
      await ctx.reply(unauth).catch(() => {});
    }
    return;
  }

  // Jika pengirim adalah admin, pastikan menu perintah chat admin terdaftar
  if (ctx.from?.id && isAdmin(ctx.from.id)) {
    ensureAdminCommands({
      bot,
      userId: ctx.from.id,
      commands: allCommands,
    }).catch(() => {});
  }

  const { persona: activePersona, id: activePersonaId, source: personaSource } = getEffectivePersona(ctx);
  ctx.persona = activePersona;
  ctx.personaId = activePersonaId;
  ctx.personaSource = personaSource;
  if (ctx.from) upsertUser(ctx.from);
  if (ctx.chat) upsertChat(ctx.chat);
  return next();
});

const features = await loadFeatures();
let allCommands = [];
let allTags = [];

const regResult = await registerFeatures({
  bot,
  features,
  context: {
    persona,
    withLock,
    rateLimiter,
    getAllTags: () => allTags,
    handleChatMessage: (...args) => handleUserChatMessage(...args),
  },
});
allCommands = regResult.allCommands;
allTags = regResult.allTags;

const publicCommands = allCommands.filter((c) => !c.adminOnly);
const adminIds = getAdminIds();
console.log(
  `[Startup] Fitur aktif: ${features.map((f) => f.id).join(', ')} | Perintah publik: ${publicCommands.length} | Admin terdaftar: ${adminIds.length}`,
);

// --- Pipeline pemrosesan balasan LLM untuk chat user -------------------------
async function handleUserChatMessage(ctx, rawText, isPrivate, replyOptions = {}, extra = {}) {
  // Pengaman: Perintah slash tidak boleh masuk ke pipeline LLM atau menambah affinity
  if (rawText && typeof rawText === 'string' && rawText.startsWith('/')) {
    return;
  }

  const chatId = ctx.chat.id;
  const activePersona = ctx.persona ?? persona;

  // Cek batas panjang pesan masuk
  const MAX_INPUT_LENGTH = Number(process.env.MAX_INPUT_LENGTH ?? 2000);
  if (isInputTooLong(rawText, MAX_INPUT_LENGTH)) {
    const tooLongMsg =
      activePersona.strings?.inputTooLong ??
      'Pesan terlalu panjang! Maksimal 2000 karakter.';
    await ctx.reply(tooLongMsg).catch(() => {});
    return;
  }

  // Cek rate limit sebelum masuk antrian LLM
  const rateStatus = rateLimiter.check(ctx.from?.id);
  if (!rateStatus.allowed) {
    const rateMsg =
      activePersona.strings?.rateLimited ??
      'Sabar! Jangan spam, tunggu sebentar sebelum memanggil lagi.';
    await ctx.reply(rateMsg).catch(() => {});
    return;
  }

  // Di grup, sertakan nama pengirim supaya AI tahu siapa yang bicara.
  const senderName = ctx.from?.first_name || 'User';
  const senderTag = ctx.from?.username ? `${senderName} (@${ctx.from.username})` : senderName;
  const userText = isPrivate ? rawText : `${senderTag}: ${rawText}`;

  try {
    await withLock(chatId, async () => {
      rateLimiter.consume(ctx.from?.id);

      if (ctx.from?.id) {
        const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
        recordInteraction(ctx.from.id, tz);
        resetProactiveUnreplied(ctx.from.id);
      }

      const dynamicPrompt = buildSystemPrompt({
        persona: activePersona,
        tags: allTags,
        ctx,
      });

      try {
        await ctx.replyWithChatAction('typing');

        let raw;
        if (extra?.vision) {
          try {
            raw = await generateVisionReply({
              systemPrompt: dynamicPrompt,
              history: getHistory(chatId),
              caption: extra.vision.caption,
              imageDataUrl: extra.vision.imageUrl,
              userId: ctx.from?.id,
            });
          } catch (vErr) {
            if (
              vErr.status === 400 ||
              vErr.status === 422 ||
              vErr.name === 'VisionUnsupportedError' ||
              /vision|unsupported/i.test(vErr.message)
            ) {
              const unsupportedMsg =
                activePersona.strings?.visionUnsupported ??
                'Aku tidak bisa melihat atau memproses gambar ini.';
              await ctx.reply(unsupportedMsg).catch(() => {});
              return;
            }
            throw vErr;
          }
        } else {
          raw = await generateReply({
            systemPrompt: dynamicPrompt,
            history: getHistory(chatId),
            userText,
            userId: ctx.from?.id,
          });
        }

        if (!raw) {
          await ctx.reply('...Hmph. Aku nggak mau jawab itu.');
          return;
        }

        const exprMode = getEffectiveExpressionMode(ctx);
        raw = shapeReply(raw, {
          mode: exprMode,
          persona: activePersona.id,
        });

        let { text: reply, actions, invalidTags } = extractActions(raw, allTags);

        // Jangan kirim STICKER dan GIF bersamaan di balasan yang sama
        const hasSticker = actions.some((a) => a.name === 'STICKER');
        const hasGif = actions.some((a) => a.name === 'GIF');
        if (hasSticker && hasGif) {
          const firstMedia = actions.find((a) => a.name === 'STICKER' || a.name === 'GIF');
          const dropType = firstMedia.name === 'STICKER' ? 'GIF' : 'STICKER';
          actions = actions.filter((a) => a.name !== dropType);
        }

        if (invalidTags.length > 0) {
          console.warn('Tag aksi tidak valid atau gagal:', invalidTags);
        }

        const historyUserText = extra?.vision?.placeholder ?? userText;
        addMessage(chatId, 'user', historyUserText);
        addMessage(chatId, 'model', raw);

        // F-64: Peringatan jika pemakaian token harian melebihi batas limit
        if (ctx.from?.id && process.env.DAILY_TOKEN_LIMIT) {
          const limit = Number(process.env.DAILY_TOKEN_LIMIT);
          if (limit > 0) {
            const usageToday = getUserUsageToday(ctx.from.id);
            checkAndAlertTokenLimit({
              bot,
              userId: ctx.from.id,
              userTotalToday: usageToday.totalTokens,
              limit,
            }).catch(() => {});
          }
        }

        // F-14: Ekstraksi fakta berkala & ringkasan riwayat percakapan lama di latar belakang
        (async () => {
          try {
            const count =
              getDb()
                .prepare('SELECT count(*) as count FROM messages WHERE chat_id = ?')
                .get(chatId)?.count ?? 0;

            if (ctx.from?.id && count > 0 && count % 20 === 0) {
              await extractAndSaveFacts({
                userId: ctx.from.id,
                chatId,
                generateReplyFn: generateReply,
              });
            }

            const maxHist = Number(process.env.MAX_HISTORY ?? 24);
            if (count > maxHist + 12) {
              await summarizeOlderHistory({
                chatId,
                generateReplyFn: generateReply,
                threshold: maxHist,
                batchSize: 12,
              });
            }
          } catch (mErr) {
            console.error('Error background memory tasks:', mErr.message);
          }
        })().catch(() => {});

        if (reply) {
          await ctx.reply(reply, replyOptions);

          // F-31: Jika balasan suara (TTS) aktif & teks pendek (<= 250 karakter), kirimkan juga voice note
          if (getSetting(ctx, 'voice_reply') === 1 && reply.length <= 250) {
            try {
              const voiceId = getPersonaVoice(activePersona.id);
              const audioBuffer = await textToSpeech({ text: reply, voice: voiceId });
              if (audioBuffer && audioBuffer.length > 0) {
                await ctx.replyWithVoice(new InputFile(audioBuffer, 'voice.mp3'), replyOptions).catch(() => {});
              }
            } catch (vErr) {
              logger.warn('Failed to send TTS voice reply', { error: vErr.message });
            }
          }
        } else if (invalidTags.length > 0) {
          await ctx.reply(activePersona.errorMessage).catch(() => {});
        }

        // Eksekusi semua handler aksi tag
        for (const action of actions) {
          if (typeof action.def?.handle === 'function') {
            try {
              await action.def.handle(ctx, action.args);
            } catch (err) {
              console.error(`Gagal menjalankan aksi tag [${action.name}]:`, err.message);
            }
          }
        }
      } catch (err) {
        console.error('Gagal membalas:', err);
        await ctx.reply(activePersona.errorMessage).catch(() => {});
      }
    });
  } catch (err) {
    if (err.message === 'QUEUE_FULL') {
      const qMsg =
        activePersona.strings?.queueFull ??
        'Antrian chat penuh! Tunggu balasan sebelumnya selesai.';
      await ctx.reply(qMsg).catch(() => {});
      return;
    }
    console.error('Gagal proses antrian chat:', err);
  }
}

// --- Pesan teks ----------------------------------------------------------------
bot.on('message:text', async (ctx) => {
  let text = ctx.message.text;
  if (text.startsWith('/')) return; // perintah yang tidak dikenal, abaikan

  const isPrivate = ctx.chat.type === 'private';
  const botMention = `@${ctx.me.username}`;

  if (!isPrivate) {
    // Catat pesan ke penyangga riwayat grup untuk /rangkum_grup (maks 200 pesan)
    const senderName =
      ctx.from?.first_name || (ctx.from?.username ? `@${ctx.from.username}` : 'User');
    recordGroupMessage({
      chatId: ctx.chat.id,
      userId: ctx.from?.id || 0,
      senderName,
      text,
    });

    const mentioned = text.toLowerCase().includes(botMention.toLowerCase());
    const repliedToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;
    const chattyTriggered = !mentioned && !repliedToBot && shouldChattyTrigger(ctx.chat.id);

    if (!mentioned && !repliedToBot && !chattyTriggered) {
      return; // di grup hanya jawab kalau dipanggil atau chatty terpicu
    }

    if (mentioned) {
      text = text.replace(new RegExp(botMention, 'gi'), '').trim() || '...';
    }
  }

  const replyOptions = isPrivate
    ? {}
    : { reply_parameters: { message_id: ctx.message.message_id } };

  await handleUserChatMessage(ctx, text, isPrivate, replyOptions);
});

// --- Pesan stiker --------------------------------------------------------------
bot.on('message:sticker', async (ctx) => {
  const userId = ctx.from?.id;
  const adminMode = getAdminAddStickerMode(userId);

  // Jika admin sedang dalam mode /addsticker <mood>, simpan stiker ke database
  if (adminMode && isAdmin(userId)) {
    const sticker = ctx.message.sticker;
    if (!sticker?.file_id) return;

    try {
      const saved = addSticker({
        fileId: sticker.file_id,
        mood: adminMode.mood,
        setName: sticker.set_name ?? null,
        emoji: sticker.emoji ?? null,
      });

      const confirmMsg =
        ctx.persona?.strings?.stickerSaved
          ?.replace('{mood}', adminMode.mood)
          ?.replace('{id}', saved.id)
          ?.replace('{emoji}', sticker.emoji || '-') ??
        `Stiker mood "${adminMode.mood}" tersimpan (ID: #${saved.id}, emoji: ${sticker.emoji || '-'}).\nKirim lagi untuk menambah stiker ke mood ini, atau ketik /cancelsticker.`;
      await ctx.reply(confirmMsg);
    } catch (err) {
      console.error('Gagal menyimpan stiker:', err);
      await ctx.reply(`Gagal menyimpan stiker: ${err.message}`);
    }
    return;
  }

  // Jika stiker biasa dari user, teruskan deskripsinya ke LLM
  const isPrivate = ctx.chat.type === 'private';
  if (!isPrivate) {
    const repliedToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;
    if (!repliedToBot) return; // di grup hanya respons jika stiker me-reply bot
  }

  const emoji = ctx.message.sticker?.emoji;
  const setName = ctx.message.sticker?.set_name;
  let stickerDesc = '[user mengirim stiker]';
  if (emoji && setName) {
    stickerDesc = `[user mengirim stiker ${emoji} (set: ${setName})]`;
  } else if (emoji) {
    stickerDesc = `[user mengirim stiker ${emoji}]`;
  }

  const replyOptions = isPrivate
    ? {}
    : { reply_parameters: { message_id: ctx.message.message_id } };

  await handleUserChatMessage(ctx, stickerDesc, isPrivate, replyOptions);
});

bot.catch((err) => console.error('Error di bot:', err.error ?? err));

// --- Jalankan ------------------------------------------------------------------
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    stopScheduler();
    await stopServer();
    flush();
    closeDb();
    await bot.stop();
    process.exit(0);
  });
}

const {
  PORT,
  HEALTH_PORT,
  WEBHOOK_URL,
  WEBHOOK_SECRET,
} = process.env;

const serverPort = Number(PORT || HEALTH_PORT || 0);

if (WEBHOOK_URL) {
  const listenPort = serverPort || 3000;
  const webhookUrlObj = new URL(WEBHOOK_URL);
  const webhookPath = webhookUrlObj.pathname || '/webhook';

  await startServer({
    port: listenPort,
    bot,
    webhookPath,
    webhookSecret: WEBHOOK_SECRET,
  });

  await bot.api.setWebhook(WEBHOOK_URL, {
    secret_token: WEBHOOK_SECRET || undefined,
  });

  const me = await bot.api.getMe();
  startScheduler({ bot });
  await syncBotCommands({ bot, commands: allCommands, adminIds });
  console.log(`Bot @${me.username} jalan (mode WEBHOOK) di port ${listenPort} [${WEBHOOK_URL}] dengan personality "${persona.id}".`);
} else {
  if (serverPort > 0) {
    await startServer({
      port: serverPort,
      bot: null,
    });
    console.log(`Server health check aktif di port ${serverPort}.`);
  }

  await bot.api.deleteWebhook().catch(() => {});

  bot.start({
    onStart: async (me) => {
      startScheduler({ bot });
      await syncBotCommands({ bot, commands: allCommands, adminIds });
      console.log(`Bot @${me.username} jalan (mode POLLING) dengan personality "${persona.id}".`);
    },
  });
}
