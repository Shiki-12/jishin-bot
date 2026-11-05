import path from 'node:path';
import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || path.resolve('data', 'bot.db');
const db = new Database(DB_PATH);

console.log(`[Pembersihan Pengingat] Memeriksa database: ${DB_PATH}`);

// Ambil pengingat dengan status failed atau chat_id tidak valid
const invalidRows = db.prepare(`
  SELECT r.id, r.chat_id, r.user_id, r.text, r.status
  FROM reminders r
  WHERE r.status = 'failed'
     OR (
       r.chat_id > 0
       AND r.chat_id NOT IN (SELECT id FROM users)
     )
     OR r.chat_id IN (880011, 880022, 880033, 880044, 440011, 7771234, 8889991)
`).all();

if (invalidRows.length === 0) {
  console.log('✅ Tidak ada pengingat tidak valid atau gagal yang ditemukan.');
  process.exit(0);
}

console.log(`⚠️ Ditemukan ${invalidRows.length} pengingat tidak valid / gagal:`);
for (const row of invalidRows) {
  console.log(`  - ID: #${row.id} | Chat: ${row.chat_id} | Status: ${row.status} | Teks: "${row.text}"`);
}

const isConfirmed = process.argv.includes('--confirm');

if (!isConfirmed) {
  console.log('\n[KONFIRMASI DIPERLUKAN]');
  console.log('Untuk menghapus pengingat-pengingat di atas secara permanen, jalankan:');
  console.log('  node scripts/clean_invalid_reminders.js --confirm\n');
  process.exit(0);
}

const ids = invalidRows.map((r) => r.id);
const deleteTx = db.transaction(() => {
  const stmt = db.prepare('DELETE FROM reminders WHERE id = ?');
  for (const id of ids) {
    stmt.run(id);
  }
});

deleteTx();
console.log(`\n🗑️ Berhasil menghapus ${ids.length} pengingat tidak valid secara permanen.`);

