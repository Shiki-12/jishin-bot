import { InlineKeyboard } from 'grammy';
import { getDb } from '../core/db.js';
import { getSetting } from '../core/settings.js';

const PAGE_SIZE = 10;

function getPersona(ctx) {
  return ctx?.persona ?? { strings: {} };
}

/**
 * Ekstraksi tag hashtag (#ide #kerja) dari teks catatan.
 */
export function extractHashtags(rawText) {
  if (!rawText) return { text: '', tags: [] };

  const tagMatches = rawText.match(/#([a-zA-Z0-9_]+)/g) || [];
  const tags = [...new Set(tagMatches.map((t) => t.slice(1).toLowerCase()))];

  return {
    text: rawText.trim(),
    tags,
  };
}

/**
 * Simpan catatan baru.
 */
export function insertNote({ userId, text, tags = [] }) {
  const db = getDb();
  const tagsStr = Array.isArray(tags) && tags.length > 0 ? tags.join(',') : null;
  const info = db
    .prepare(
      `INSERT INTO notes (user_id, text, tags, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(userId, text.trim(), tagsStr, Date.now());

  return info.lastInsertRowid;
}

/**
 * Ambil catatan berdasarkan ID dan kepemilikan user.
 */
export function getNoteById(userId, noteId) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM notes WHERE id = ? AND user_id = ?`)
    .get(noteId, userId);
}

/**
 * Hapus catatan berdasarkan ID.
 */
export function deleteNote(userId, noteId) {
  const db = getDb();
  return db
    .prepare(`DELETE FROM notes WHERE id = ? AND user_id = ?`)
    .run(noteId, userId);
}

/**
 * Cari catatan dengan pencarian kata kunci (LIKE di teks atau tags).
 */
export function findNotes(userId, query) {
  const db = getDb();
  const term = `%${query.trim()}%`;
  return db
    .prepare(
      `SELECT * FROM notes
       WHERE user_id = ? AND (text LIKE ? OR tags LIKE ?)
       ORDER BY id DESC
       LIMIT 20`,
    )
    .all(userId, term, term);
}

/**
 * Ambil daftar catatan dengan paginasi 10 item per halaman.
 */
export function getNotesPage(userId, page = 1, pageSize = PAGE_SIZE) {
  const db = getDb();
  const totalRow = db
    .prepare(`SELECT count(*) as count FROM notes WHERE user_id = ?`)
    .get(userId);
  const total = totalRow?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const offset = (currentPage - 1) * pageSize;

  const notes = db
    .prepare(
      `SELECT * FROM notes
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, pageSize, offset);

  return {
    notes,
    total,
    page: currentPage,
    totalPages,
  };
}

/**
 * Render pesan dan keyboard paginasi untuk daftar catatan.
 */
export function renderNotesPage(userId, page = 1, tz = 'Asia/Jakarta') {
  const { notes, total, totalPages, page: curPage } = getNotesPage(
    userId,
    page,
    PAGE_SIZE,
  );

  if (total === 0) {
    return {
      text: 'Kamu belum memiliki catatan tersimpan. Buat dengan `/note <teks>`!',
      keyboard: null,
    };
  }

  const formatter = new Intl.DateTimeFormat('id-ID', {
    timeZone: tz,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const lines = [
    `📚 *Daftar Catatan* (Hal ${curPage}/${totalPages} — Total: ${total})`,
    '',
  ];

  notes.forEach((note) => {
    const preview =
      note.text.length > 60 ? note.text.slice(0, 57) + '...' : note.text;
    const dateStr = formatter.format(new Date(note.created_at));
    const tagDisplay = note.tags
      ? ` _[#${note.tags.split(',').join(' #')}]_`
      : '';
    lines.push(`• *#${note.id}* (${dateStr})${tagDisplay}\n  ${preview}`);
  });

  lines.push('');
  lines.push('_Ketik `/note <id>` untuk membaca isi lengkap._');

  const keyboard = new InlineKeyboard();
  if (curPage > 1) {
    keyboard.text('⬅️ Sebelumnya', `note:page:${curPage - 1}`);
  }
  keyboard.text(`${curPage}/${totalPages}`, 'note:noop');
  if (curPage < totalPages) {
    keyboard.text('Selanjutnya ➡️', `note:page:${curPage + 1}`);
  }

  return { text: lines.join('\n'), keyboard };
}

export default {
  id: 'notes',

  commands: [
    {
      name: 'note',
      description: 'Simpan catatan (/note teks) atau lihat catatan (/note <id>)',
      handler: async (ctx) => {
        const p = getPersona(ctx);
        const args = ctx.message.text.split(/\s+/).slice(1).join(' ').trim();

        if (!args) {
          await ctx.reply(
            'Format perintah `/note`:\n' +
              '• Simpan: `/note password wifi rumah adalah 12345`\n' +
              '• Simpan dengan label: `/note #kerja #ide rancangan arsitektur bot`\n' +
              '• Baca catatan: `/note 5`\n' +
              '• Daftar semua: `/notes`\n' +
              '• Cari catatan: `/findnote wifi`',
            { parse_mode: 'Markdown' },
          );
          return;
        }

        // Cek jika argumen hanya satu angka -> lihat catatan dengan ID tersebut
        const singleNumber = Number(args);
        if (!isNaN(singleNumber) && Number.isInteger(singleNumber) && singleNumber > 0) {
          const note = getNoteById(ctx.from.id, singleNumber);
          if (!note) {
            await ctx.reply(
              p.strings?.noteNotFound?.replace('{id}', singleNumber) ??
                `Catatan #${singleNumber} tidak ditemukan.`,
            );
            return;
          }

          const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
          const dateStr = new Intl.DateTimeFormat('id-ID', {
            timeZone: tz,
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(note.created_at));

          const tagInfo = note.tags
            ? `\nLabel: #${note.tags.split(',').join(' #')}`
            : '';
          const replyText = `📄 *Catatan #${note.id}* (${dateStr})${tagInfo}\n\n${note.text}`;

          await ctx.reply(replyText, { parse_mode: 'Markdown' });
          return;
        }

        // Simpan catatan baru
        const { text, tags } = extractHashtags(args);
        const id = insertNote({ userId: ctx.from.id, text, tags });

        let confirmMsg = `Catatan disimpan (*#${id}*)!`;
        if (tags.length > 0) {
          confirmMsg += `\nLabel: #${tags.join(' #')}`;
        }

        const template = p.strings?.noteSaved;
        if (template) {
          confirmMsg = template.replace('{id}', id);
          if (tags.length > 0) confirmMsg += `\nLabel: #${tags.join(' #')}`;
        }

        await ctx.reply(confirmMsg, { parse_mode: 'Markdown' });
      },
    },
    {
      name: 'notes',
      description: 'Lihat daftar catatan dengan paginasi 10 per halaman',
      handler: async (ctx) => {
        const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
        const args = ctx.message.text.split(/\s+/).slice(1);
        const page = Number(args[0]) || 1;

        const { text, keyboard } = renderNotesPage(ctx.from.id, page, tz);
        await ctx.reply(text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard ?? undefined,
        });
      },
    },
    {
      name: 'delnote',
      description: 'Hapus catatan berdasarkan ID (contoh: /delnote 3)',
      handler: async (ctx) => {
        const p = getPersona(ctx);
        const args = ctx.message.text.split(/\s+/).slice(1);
        const noteId = Number(args[0]);

        if (!noteId || isNaN(noteId)) {
          await ctx.reply('Sebutkan ID catatan yang ingin dihapus. Contoh: `/delnote 3`', {
            parse_mode: 'Markdown',
          });
          return;
        }

        const res = deleteNote(ctx.from.id, noteId);
        if (res.changes === 0) {
          await ctx.reply(
            p.strings?.noteNotFound?.replace('{id}', noteId) ??
              `Catatan #${noteId} tidak ditemukan.`,
          );
          return;
        }

        const msg =
          p.strings?.noteDeleted?.replace('{id}', noteId) ??
          `Catatan #${noteId} berhasil dihapus.`;
        await ctx.reply(msg);
      },
    },
    {
      name: 'findnote',
      description: 'Cari catatan berdasarkan kata kunci atau tag (contoh: /findnote wifi)',
      handler: async (ctx) => {
        const query = ctx.message.text.split(/\s+/).slice(1).join(' ').trim();
        if (!query) {
          await ctx.reply('Sebutkan kata kunci pencarian. Contoh: `/findnote password`', {
            parse_mode: 'Markdown',
          });
          return;
        }

        const cleanTerm = query.startsWith('#') ? query.slice(1) : query;
        const matches = findNotes(ctx.from.id, cleanTerm);

        if (matches.length === 0) {
          await ctx.reply(`Tidak ditemukan catatan yang mengandung "${query}".`);
          return;
        }

        const lines = [`🔍 *Hasil Pencarian "${query}"* (${matches.length} ditemukan):`, ''];
        matches.forEach((m) => {
          const preview = m.text.length > 60 ? m.text.slice(0, 57) + '...' : m.text;
          const tagInfo = m.tags ? ` _[#${m.tags.split(',').join(' #')}]_` : '';
          lines.push(`• *#${m.id}*${tagInfo}: ${preview}`);
        });

        lines.push('');
        lines.push('_Ketik `/note <id>` untuk membaca isi lengkap._');

        await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
      },
    },
  ],

  tags: [
    {
      name: 'NOTE',
      minArgs: 1,
      maxArgs: 1,
      maxArgLength: 1000,
      promptHint:
        'Simpan catatan penting user. Format: [NOTE: isi catatan]. Contoh: [NOTE: wifi rumah passwordnya 12345]',
      handle: async (ctx, [rawText]) => {
        const { text, tags } = extractHashtags(rawText);
        const id = insertNote({ userId: ctx.from.id, text, tags });

        let confirm = `📝 *Catatan Disimpan (#${id})*:\n"${text}"`;
        if (tags.length > 0) confirm += `\nLabel: #${tags.join(' #')}`;

        await ctx.reply(confirm, { parse_mode: 'Markdown' });
      },
    },
  ],

  callbacks: [
    {
      prefix: 'note:',
      handler: async (ctx) => {
        const data = ctx.callbackQuery.data; // note:page:<page> or note:noop
        if (data === 'note:noop') {
          await ctx.answerCallbackQuery().catch(() => {});
          return;
        }

        const parts = data.split(':');
        const action = parts[1];
        const page = Number(parts[2]) || 1;

        if (action === 'page') {
          const tz = getSetting(ctx, 'tz', 'Asia/Jakarta');
          const { text, keyboard } = renderNotesPage(ctx.from.id, page, tz);

          await ctx.answerCallbackQuery().catch(() => {});
          await ctx
            .editMessageText(text, {
              parse_mode: 'Markdown',
              reply_markup: keyboard ?? undefined,
            })
            .catch(() => {});
        }
      },
    },
  ],
};

