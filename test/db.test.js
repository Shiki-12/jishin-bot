import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getDb, runMigrations, importLegacyMemory } from '../src/core/db.js';
import { addMessage, clearHistory, getHistory } from '../src/memory.js';

describe('SQLite Database & Migrations (F-01)', () => {
  it('menjalankan migrasi 001_initial.sql pada in-memory database', () => {
    const db = new Database(':memory:');
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);

    assert.ok(tables.includes('schema_migrations'));
    assert.ok(tables.includes('users'));
    assert.ok(tables.includes('chats'));
    assert.ok(tables.includes('messages'));

    const migrations = db.prepare('SELECT version FROM schema_migrations').all();
    assert.ok(migrations.some((m) => m.version === '001_initial.sql'));

    db.close();
  });

  it('mengimpor legacy memory.json dengan benar', () => {
    const db = new Database(':memory:');
    runMigrations(db);

    const tempJson = path.resolve('data', 'test_memory.json');
    fs.mkdirSync(path.dirname(tempJson), { recursive: true });
    fs.writeFileSync(
      tempJson,
      JSON.stringify({
        12345: [
          { role: 'user', text: 'Halo' },
          { role: 'model', text: 'Hmph!' },
        ],
      }),
    );

    importLegacyMemory(db, tempJson);

    const rows = db.prepare('SELECT * FROM messages WHERE chat_id = 12345').all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].text, 'Halo');
    assert.equal(rows[1].text, 'Hmph!');

    // File harus sudah di-rename ke .migrated
    assert.ok(!fs.existsSync(tempJson));
    assert.ok(fs.existsSync(`${tempJson}.migrated`));

    // Bersihkan file uji
    fs.unlinkSync(`${tempJson}.migrated`);
    db.close();
  });

  it('addMessage, getHistory, dan clearHistory bekerja persisten', () => {
    const testChatId = 999888;
    clearHistory(testChatId);

    addMessage(testChatId, 'user', 'Pesan pertama');
    addMessage(testChatId, 'model', 'Balasan bot');

    const history = getHistory(testChatId);
    assert.equal(history.length, 2);
    assert.equal(history[0].role, 'user');
    assert.equal(history[0].text, 'Pesan pertama');
    assert.equal(history[1].role, 'model');
    assert.equal(history[1].text, 'Balasan bot');

    clearHistory(testChatId);
    const emptyHistory = getHistory(testChatId);
    assert.equal(emptyHistory.length, 0);
  });

  it('menolak akses ke data/bot.db saat NODE_ENV=test (guard throw)', () => {
    process.env.NODE_ENV = 'test';
    const prodPath = path.resolve('data', 'bot.db');
    assert.throws(
      () => getDb(prodPath),
      /GUARD_TRIGGERED/,
      'Harus melempar error saat tes mencoba mengakses data/bot.db',
    );
  });
});

