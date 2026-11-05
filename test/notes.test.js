import './setup.js';
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, closeDb } from '../src/core/db.js';
import notesFeature, {
  extractHashtags,
  insertNote,
  getNoteById,
  deleteNote,
  findNotes,
  getNotesPage,
  renderNotesPage,
} from '../src/features/notes.js';

describe('F-12: Catatan / Notes', () => {
  const TEST_USER = 999901;
  const OTHER_USER = 999902;

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM notes WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
  });

  after(() => {
    const db = getDb();
    db.prepare('DELETE FROM notes WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
  });

  describe('extractHashtags', () => {
    it('ekstraksi teks tanpa tag', () => {
      const res = extractHashtags('ini catatan biasa');
      assert.equal(res.text, 'ini catatan biasa');
      assert.deepEqual(res.tags, []);
    });

    it('ekstraksi hashtag dan deduplikasi case-insensitive', () => {
      const res = extractHashtags('#ide #proyek #IDE buat bot telegram #KERJA');
      assert.equal(res.text, '#ide #proyek #IDE buat bot telegram #KERJA');
      assert.deepEqual(res.tags, ['ide', 'proyek', 'kerja']);
    });
  });

  describe('Database Operations', () => {
    it('insert dan get note berdasarkan ID', () => {
      const id = insertNote({
        userId: TEST_USER,
        text: 'rahasia dapur #resep',
        tags: ['resep'],
      });
      assert.ok(id > 0);

      const note = getNoteById(TEST_USER, id);
      assert.ok(note);
      assert.equal(note.text, 'rahasia dapur #resep');
      assert.equal(note.tags, 'resep');

      // User lain tidak boleh bisa ambil note milik user ini
      const foreignNote = getNoteById(OTHER_USER, id);
      assert.equal(foreignNote, undefined);
    });

    it('delete note dengan kepemilikan user', () => {
      const id = insertNote({
        userId: TEST_USER,
        text: 'catatan yang akan dihapus',
      });

      // User lain coba hapus
      const foreignDelete = deleteNote(OTHER_USER, id);
      assert.equal(foreignDelete.changes, 0);

      // Pemilik hapus
      const ownDelete = deleteNote(TEST_USER, id);
      assert.equal(ownDelete.changes, 1);

      assert.equal(getNoteById(TEST_USER, id), undefined);
    });

    it('pencarian findNotes mencari teks dan tags', () => {
      insertNote({ userId: TEST_USER, text: 'daftar belanja mingguan: apel, jeruk #belanja' });
      insertNote({ userId: TEST_USER, text: 'ide startup baru #kerja', tags: ['kerja'] });
      insertNote({ userId: OTHER_USER, text: 'belanja user lain' });

      const resBelanja = findNotes(TEST_USER, 'belanja');
      assert.equal(resBelanja.length, 1);
      assert.ok(resBelanja[0].text.includes('daftar belanja'));

      const resTag = findNotes(TEST_USER, 'kerja');
      assert.equal(resTag.length, 1);
      assert.ok(resTag[0].text.includes('startup'));
    });

    it('paginasi getNotesPage membagi 10 item per halaman', () => {
      for (let i = 1; i <= 15; i++) {
        insertNote({ userId: TEST_USER, text: `Catatan nomor ${i}` });
      }

      const p1 = getNotesPage(TEST_USER, 1, 10);
      assert.equal(p1.total, 15);
      assert.equal(p1.page, 1);
      assert.equal(p1.totalPages, 2);
      assert.equal(p1.notes.length, 10);

      const p2 = getNotesPage(TEST_USER, 2, 10);
      assert.equal(p2.page, 2);
      assert.equal(p2.notes.length, 5);
    });

    it('renderNotesPage menampilkan teks kosong jika tidak ada catatan', () => {
      const res = renderNotesPage(TEST_USER, 1);
      assert.ok(res.text.includes('belum memiliki catatan'));
      assert.equal(res.keyboard, null);
    });

    it('renderNotesPage membuat inline keyboard navigasi', () => {
      for (let i = 1; i <= 15; i++) {
        insertNote({ userId: TEST_USER, text: `Catatan ${i}` });
      }

      const res = renderNotesPage(TEST_USER, 1);
      assert.ok(res.keyboard);
      assert.ok(res.text.includes('Daftar Catatan'));
    });
  });

  describe('Commands & Action Tags', () => {
    it('/note simpan teks baru', async () => {
      const replies = [];
      const ctx = {
        from: { id: TEST_USER },
        message: { text: '/note rencana liburan ke pantai #liburan' },
        reply: async (msg, opts) => replies.push({ msg, opts }),
      };

      const noteCmd = notesFeature.commands.find((c) => c.name === 'note');
      await noteCmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].msg.includes('Catatan disimpan'));
      assert.ok(replies[0].msg.includes('#liburan'));
    });

    it('/note <id> baca catatan tersimpan', async () => {
      const id = insertNote({
        userId: TEST_USER,
        text: 'kunci lemari di atas kulkas',
      });

      const replies = [];
      const ctx = {
        from: { id: TEST_USER },
        message: { text: `/note ${id}` },
        reply: async (msg, opts) => replies.push({ msg, opts }),
      };

      const noteCmd = notesFeature.commands.find((c) => c.name === 'note');
      await noteCmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].msg.includes(`Catatan #${id}`));
      assert.ok(replies[0].msg.includes('kunci lemari'));
    });

    it('/delnote menghapus catatan', async () => {
      const id = insertNote({
        userId: TEST_USER,
        text: 'catatan sementara',
      });

      const replies = [];
      const ctx = {
        from: { id: TEST_USER },
        message: { text: `/delnote ${id}` },
        reply: async (msg) => replies.push(msg),
      };

      const delCmd = notesFeature.commands.find((c) => c.name === 'delnote');
      await delCmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].includes('berhasil dihapus'));
      assert.equal(getNoteById(TEST_USER, id), undefined);
    });

    it('/findnote menampilkan hasil pencarian', async () => {
      insertNote({
        userId: TEST_USER,
        text: 'wifi kantor password rahasia123',
      });

      const replies = [];
      const ctx = {
        from: { id: TEST_USER },
        message: { text: '/findnote kantor' },
        reply: async (msg) => replies.push(msg),
      };

      const findCmd = notesFeature.commands.find((c) => c.name === 'findnote');
      await findCmd.handler(ctx);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].includes('Hasil Pencarian'));
      assert.ok(replies[0].includes('wifi kantor'));
    });

    it('Tag [NOTE: ...] menyimpan catatan dari AI', async () => {
      const replies = [];
      const ctx = {
        from: { id: TEST_USER },
        reply: async (msg) => replies.push(msg),
      };

      const noteTag = notesFeature.tags.find((t) => t.name === 'NOTE');
      await noteTag.handle(ctx, ['alamat pengiriman paket di bandung #kirim']);

      assert.equal(replies.length, 1);
      assert.ok(replies[0].includes('Catatan Disimpan'));
      assert.ok(replies[0].includes('#kirim'));

      const found = findNotes(TEST_USER, 'bandung');
      assert.equal(found.length, 1);
    });
  });
});

