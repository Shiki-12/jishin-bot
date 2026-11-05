import { InlineKeyboard } from 'grammy';
import { isAdmin } from '../core/guards.js';
import {
  getAdminStats,
  banUser,
  unbanUser,
  isUserBanned,
  listBannedUsers,
  isMaintenanceMode,
  setMaintenanceMode,
  getActiveModel,
  setActiveModel,
  createPendingBroadcast,
  getPendingBroadcast,
  deletePendingBroadcast,
  executeBroadcast,
  logAdminAction,
} from '../core/admin.js';
import { getDb } from '../core/db.js';
import { getSetting } from '../core/settings.js';
import { getPersonality } from '../personalities/index.js';

export default {
  id: 'admin',

  commands: [
    {
      name: 'stats',
      description: 'Statistik operasional bot (khusus admin)',
      adminOnly: true,
      handler: async (ctx) => {
        if (!isAdmin(ctx.from?.id)) {
          return;
        }

        const stats = getAdminStats();
        const msg = [
          '📊 *Statistik Operasional Bot*',
          '',
          '👥 *Pengguna & Aktivitas:*',
          `• Total Pengguna: *${stats.totalUsers}*`,
          `• Total Chat/Grup: *${stats.totalChats}*`,
          `• Pengguna Aktif Hari Ini: *${stats.activeUsersToday}*`,
          `• Pesan Hari Ini: *${stats.messagesToday}*`,
          '',
          '⚙️ *Status Sistem:*',
          `• Model LLM Aktif: \`${stats.activeModel}\``,
          `• Mode Maintenance: *${stats.isMaintenance ? 'ON (Aktif)' : 'OFF (Normal)'}*`,
          `• Pengguna Diblokir (Ban): *${stats.bannedCount}*`,
          `• Pengingat Aktif (Pending): *${stats.pendingReminders}*`,
          `• Memori Fakta Tersimpan: *${stats.factsCount}*`,
          `• Catatan Pengeluaran: *${stats.expensesCount}* (Total: Rp ${stats.expensesTotal.toLocaleString('id-ID')})`,
          '',
          '🪙 *Pemakaian Token & Kinerja LLM (Hari Ini):*',
          `• Total Token: *${stats.tokensToday.toLocaleString('id-ID')}* (${stats.promptTokensToday.toLocaleString('id-ID')} prompt, ${stats.completionTokensToday.toLocaleString('id-ID')} completion)`,
          `• Rata-rata Latensi: *${stats.avgLatencyMs} ms*`,
          stats.usageByModel && stats.usageByModel.length > 0
            ? `• Model Terpakai: ${stats.usageByModel.map((m) => `\`${m.model}\` (${m.tokens.toLocaleString('id-ID')})`).join(', ')}`
            : '• Model Terpakai: _(belum ada panggilan hari ini)_',
        ].join('\n');

        await ctx.reply(msg, { parse_mode: 'Markdown' });
      },
    },
    {
      name: 'ban',
      description: 'Blokir user dari akses bot (/ban <user_id> [alasan])',
      adminOnly: true,
      handler: async (ctx) => {
        if (!isAdmin(ctx.from?.id)) {
          return;
        }

        const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
        const targetId = Number(args[0]);
        const reason = args.slice(1).join(' ').trim() || 'Melanggar aturan';

        if (!targetId || isNaN(targetId) || targetId <= 0) {
          await ctx.reply(
            '⚠️ Format salah!\nGunakan: `/ban <user_id> [alasan]`\nContoh: `/ban 123456789 spamming`',
            { parse_mode: 'Markdown' },
          );
          return;
        }

        if (isAdmin(targetId)) {
          await ctx.reply('⚠️ Tidak dapat memblokir sesama admin bot!');
          return;
        }

        try {
          banUser({ userId: targetId, reason, adminId: ctx.from.id });
          await ctx.reply(
            `⛔ *User Berhasil Diblokir!*\n• User ID: \`${targetId}\`\n• Alasan: ${reason}`,
            { parse_mode: 'Markdown' },
          );
        } catch (err) {
          await ctx.reply(`⚠️ Gagal memblokir user: ${err.message}`);
        }
      },
    },
    {
      name: 'unban',
      description: 'Buka blokir user (/unban <user_id>)',
      adminOnly: true,
      handler: async (ctx) => {
        if (!isAdmin(ctx.from?.id)) {
          return;
        }

        const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
        const targetId = Number(args[0]);

        if (!targetId || isNaN(targetId) || targetId <= 0) {
          await ctx.reply(
            '⚠️ Format salah!\nGunakan: `/unban <user_id>`\nContoh: `/unban 123456789`',
            { parse_mode: 'Markdown' },
          );
          return;
        }

        const success = unbanUser({ userId: targetId, adminId: ctx.from.id });
        if (success) {
          await ctx.reply(
            `✅ *User Berhasil Dibuka Blokirnya!*\n• User ID: \`${targetId}\``,
            { parse_mode: 'Markdown' },
          );
        } else {
          await ctx.reply(`⚠️ User ID \`${targetId}\` tidak ditemukan di daftar blokir.`, {
            parse_mode: 'Markdown',
          });
        }
      },
    },
    {
      name: 'broadcast',
      description: 'Kirim pesan siaran ke semua user terdaftar (/broadcast <teks>)',
      adminOnly: true,
      handler: async (ctx) => {
        if (!isAdmin(ctx.from?.id)) {
          return;
        }

        const text = ctx.message?.text?.split(/\s+/).slice(1).join(' ').trim();
        if (!text) {
          await ctx.reply(
            '📢 Format salah!\nGunakan: `/broadcast <isi pesan pengumuman>`',
            { parse_mode: 'Markdown' },
          );
          return;
        }

        const db = getDb();
        const targetCount =
          db.prepare('SELECT count(*) as c FROM users WHERE id > 0').get()?.c ?? 0;

        const bcId = createPendingBroadcast({
          adminId: ctx.from.id,
          text,
          targetCount,
        });

        const keyboard = new InlineKeyboard()
          .text('✅ Kirim Sekarang', `adm:bc:send:${bcId}`)
          .text('❌ Batal', `adm:bc:cancel:${bcId}`);

        const previewMsg = [
          '📢 *Konfirmasi Siaran (Broadcast)*',
          '',
          `• Target Penerima: *${targetCount} pengguna*`,
          '',
          '*Isi Pesan:*',
          text,
          '',
          'Apakah kamu yakin ingin mengirimkan pesan ini ke seluruh pengguna terdaftar?',
        ].join('\n');

        await ctx.reply(previewMsg, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      },
    },
    {
      name: 'model',
      description: 'Cek atau ganti model LLM aktif sementara (/model [nama_model])',
      adminOnly: true,
      handler: async (ctx) => {
        if (!isAdmin(ctx.from?.id)) {
          return;
        }

        const newModel = ctx.message?.text?.split(/\s+/).slice(1).join(' ').trim();

        if (!newModel) {
          const current = getActiveModel();
          await ctx.reply(
            `🤖 *Model LLM Saat Ini:*\n\`${current}\`\n\nUntuk mengganti model sementara tanpa restart:\n\`/model <nama_model>\``,
            { parse_mode: 'Markdown' },
          );
          return;
        }

        try {
          setActiveModel(newModel, ctx.from.id);
          await ctx.reply(
            `🤖 *Model LLM Berhasil Diganti!*\nModel aktif sekarang: \`${newModel}\`\nPerubahan langsung berlaku untuk panggilan LLM berikutnya.`,
            { parse_mode: 'Markdown' },
          );
        } catch (err) {
          await ctx.reply(`⚠️ Gagal mengubah model: ${err.message}`);
        }
      },
    },
    {
      name: 'maintenance',
      description: 'Atur mode pemeliharaan bot (/maintenance [on|off])',
      adminOnly: true,
      handler: async (ctx) => {
        if (!isAdmin(ctx.from?.id)) {
          return;
        }

        const mode = ctx.message?.text?.split(/\s+/)[1]?.toLowerCase();

        if (mode === 'on') {
          setMaintenanceMode(true, ctx.from.id);
          await ctx.reply(
            '🔧 *Mode Maintenance Diaktifkan (ON)*\nPengguna non-admin tidak dapat mengakses atau memanggil bot.',
            { parse_mode: 'Markdown' },
          );
          return;
        }

        if (mode === 'off') {
          setMaintenanceMode(false, ctx.from.id);
          await ctx.reply(
            '✅ *Mode Maintenance Dimatikan (OFF)*\nBot kembali aktif dan dapat digunakan oleh seluruh pengguna.',
            { parse_mode: 'Markdown' },
          );
          return;
        }

        const current = isMaintenanceMode();
        await ctx.reply(
          `🔧 *Status Mode Maintenance:*\n• Status: *${current ? 'ON (Aktif)' : 'OFF (Mati)'}*\n\nGunakan: \`/maintenance on\` atau \`/maintenance off\`.`,
          { parse_mode: 'Markdown' },
        );
      },
    },
    {
      name: 'cleanreminders',
      description: 'Bersihkan pengingat failed & chat palsu/tidak valid (khusus admin)',
      adminOnly: true,
      handler: async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return;

        const db = getDb();
        const invalidRows = db.prepare(`
          SELECT r.id, r.chat_id, r.text, r.status
          FROM reminders r
          WHERE r.status = 'failed'
             OR (
               r.chat_id > 0
               AND r.chat_id NOT IN (SELECT id FROM users)
             )
             OR r.chat_id IN (880011, 880022, 880033, 880044, 440011, 7771234, 8889991)
        `).all();

        if (invalidRows.length === 0) {
          await ctx.reply('✅ Tidak ada pengingat tidak valid yang perlu dibersihkan.');
          return;
        }

        const previewList = invalidRows
          .slice(0, 5)
          .map((r) => `• #${r.id} (chat: \`${r.chat_id}\`): "${r.text}"`)
          .join('\n');

        const keyboard = new InlineKeyboard()
          .text(`🗑️ Hapus ${invalidRows.length} Pengingat`, 'adm:cleanrem:confirm')
          .text('❌ Batal', 'adm:cleanrem:cancel');

        const msg = [
          '⚠️ *Konfirmasi Pembersihan Pengingat Tidak Valid*',
          '',
          `Ditemukan *${invalidRows.length}* pengingat berstatus 'failed' atau dari chat tidak valid/palsu:`,
          previewList,
          invalidRows.length > 5 ? `_...dan ${invalidRows.length - 5} lainnya_` : '',
          '',
          'Apakah kamu yakin ingin menghapus seluruh pengingat ini dari database?',
        ].filter(Boolean).join('\n');

        await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: keyboard });
      },
    },
  ],

  callbacks: [
    {
      prefix: 'adm:cleanrem:confirm',
      handler: async (ctx) => {
        if (!isAdmin(ctx.from?.id)) {
          await ctx.answerCallbackQuery({ text: 'Akses ditolak.' }).catch(() => {});
          return;
        }

        const db = getDb();
        const res = db.prepare(`
          DELETE FROM reminders
          WHERE status = 'failed'
             OR (
               chat_id > 0
               AND chat_id NOT IN (SELECT id FROM users)
             )
             OR chat_id IN (880011, 880022, 880033, 880044, 440011, 7771234, 8889991)
        `).run();

        logAdminAction({
          adminId: ctx.from.id,
          action: 'clean_reminders',
          details: `Menghapus ${res.changes} pengingat tidak valid`,
        });

        await ctx.answerCallbackQuery({ text: 'Pembersihan berhasil!' }).catch(() => {});
        await ctx.editMessageText(`✅ *Pembersihan Selesai!*\nBerhasil menghapus *${res.changes}* pengingat tidak valid dari database.`, {
          parse_mode: 'Markdown',
        }).catch(() => {});
      },
    },
    {
      prefix: 'adm:cleanrem:cancel',
      handler: async (ctx) => {
        if (!isAdmin(ctx.from?.id)) {
          await ctx.answerCallbackQuery({ text: 'Akses ditolak.' }).catch(() => {});
          return;
        }
        await ctx.answerCallbackQuery({ text: 'Dibatalkan.' }).catch(() => {});
        await ctx.editMessageText('❌ *Pembersihan pengingat dibatalkan.*', {
          parse_mode: 'Markdown',
        }).catch(() => {});
      },
    },
    {
      prefix: 'adm:bc:send:',
      handler: async (ctx) => {
        if (!isAdmin(ctx.from?.id)) {
          await ctx.answerCallbackQuery({ text: 'Akses ditolak.' }).catch(() => {});
          return;
        }

        const bcId = ctx.callbackQuery.data.slice('adm:bc:send:'.length);
        const bc = getPendingBroadcast(bcId);

        if (!bc) {
          await ctx.answerCallbackQuery({
            text: 'Data siaran sudah kedaluwarsa atau tidak ditemukan.',
          }).catch(() => {});
          return;
        }

        deletePendingBroadcast(bcId);
        await ctx.answerCallbackQuery({ text: 'Memulai pengiriman siaran...' }).catch(() => {});

        await ctx.editMessageText('⏳ *Sedang mengirim siaran ke seluruh pengguna...*', {
          parse_mode: 'Markdown',
        }).catch(() => {});

        const botApi = ctx.api || ctx.bot?.api;
        const result = await executeBroadcast({
          bot: { api: botApi },
          text: bc.text,
          delayMs: 30,
        });

        logAdminAction({
          adminId: ctx.from.id,
          action: 'broadcast',
          details: `Total: ${result.total}, Sukses: ${result.successCount}, Gagal: ${result.failCount}`,
        });

        const reportMsg = [
          '📢 *Siaran Selesai Dikirim!*',
          '',
          `• Total Target: *${result.total}*`,
          `• Berhasil: *${result.successCount}*`,
          `• Gagal / Blokir: *${result.failCount}*`,
        ].join('\n');

        await ctx.editMessageText(reportMsg, { parse_mode: 'Markdown' }).catch(() => {});
      },
    },
    {
      prefix: 'adm:bc:cancel:',
      handler: async (ctx) => {
        if (!isAdmin(ctx.from?.id)) {
          await ctx.answerCallbackQuery({ text: 'Akses ditolak.' }).catch(() => {});
          return;
        }

        const bcId = ctx.callbackQuery.data.slice('adm:bc:cancel:'.length);
        deletePendingBroadcast(bcId);

        await ctx.answerCallbackQuery({ text: 'Siaran dibatalkan.' }).catch(() => {});
        await ctx.editMessageText('❌ *Siaran pesan telah dibatalkan.*', {
          parse_mode: 'Markdown',
        }).catch(() => {});
      },
    },
  ],
};

