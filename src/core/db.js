import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB_PATH = path.resolve('data', 'bot.db');
const DEFAULT_MIGRATIONS_DIR = path.resolve('src', 'core', 'migrations');

let instance = null;

/**
 * Jalankan migrasi SQL berurutan dari folder migrations.
 */
export function runMigrations(db, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  if (!fs.existsSync(migrationsDir)) return;

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const getApplied = db.prepare('SELECT version FROM schema_migrations WHERE version = ?');
  const recordMigration = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  for (const file of files) {
    const isApplied = getApplied.get(file);
    if (!isApplied) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const applyTx = db.transaction(() => {
        db.exec(sql);
        recordMigration.run(file, Date.now());
      });
      applyTx();
    }
  }
}

/**
 * Migrasi satu kali dari file data/memory.json lama ke tabel messages.
 */
export function importLegacyMemory(db, legacyPath = path.resolve('data', 'memory.json')) {
  if (!fs.existsSync(legacyPath)) return;

  try {
    const raw = fs.readFileSync(legacyPath, 'utf8');
    const data = JSON.parse(raw);

    const insert = db.prepare(
      'INSERT INTO messages (chat_id, role, text, created_at) VALUES (?, ?, ?, ?)',
    );

    const tx = db.transaction(() => {
      let time = Date.now() - 500_000;
      for (const [chatIdStr, messages] of Object.entries(data)) {
        const chatId = Number(chatIdStr);
        if (!Array.isArray(messages)) continue;
        for (const msg of messages) {
          if (!msg.role || !msg.text) continue;
          insert.run(chatId, msg.role, msg.text, time++);
        }
      }
    });

    tx();

    // Beri nama .migrated agar tidak diimpor ulang
    fs.renameSync(legacyPath, `${legacyPath}.migrated`);
  } catch (err) {
    console.error('Gagal migrasi memory.json ke SQLite:', err.message);
  }
}

/**
 * Dapatkan atau buat koneksi database SQLite (singleton).
 */
export function getDb(dbPath = process.env.DB_PATH || DEFAULT_DB_PATH) {
  const isTestEnv = process.env.NODE_ENV === 'test';
  const targetPath = dbPath !== ':memory:' ? path.resolve(dbPath) : ':memory:';

  // Guard: Larang keras koneksi ke production data/bot.db saat NODE_ENV=test
  if (isTestEnv && targetPath === DEFAULT_DB_PATH) {
    throw new Error('GUARD_TRIGGERED: Database data/bot.db dilarang diakses saat NODE_ENV=test! Gunakan :memory: atau DB_PATH.');
  }

  if (instance && (instance.name === targetPath || (dbPath === ':memory:' && instance.name === ':memory:'))) {
    return instance;
  }

  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const db = new Database(dbPath);
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }

  runMigrations(db);

  if (targetPath === DEFAULT_DB_PATH) {
    importLegacyMemory(db);
  }

  instance = db;
  return db;
}

/**
 * Simpan atau perbarui data user Telegram.
 */
export function upsertUser(user) {
  if (!user?.id) return;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO users (id, first_name, username, created_at)
    VALUES (@id, @first_name, @username, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      first_name = COALESCE(excluded.first_name, users.first_name),
      username = COALESCE(excluded.username, users.username)
  `);

  stmt.run({
    id: user.id,
    first_name: user.first_name ?? null,
    username: user.username ?? null,
    created_at: Date.now(),
  });
}

/**
 * Simpan atau perbarui data chat Telegram.
 */
export function upsertChat(chat) {
  if (!chat?.id) return;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO chats (id, type, created_at)
    VALUES (@id, @type, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      type = COALESCE(excluded.type, chats.type)
  `);

  stmt.run({
    id: chat.id,
    type: chat.type ?? 'private',
    created_at: Date.now(),
  });
}

/**
 * Tutup koneksi database saat shutdown.
 */
export function closeDb() {
  if (instance) {
    try {
      instance.close();
    } catch {}
    instance = null;
  }
}

