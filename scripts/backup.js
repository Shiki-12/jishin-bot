import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../src/core/db.js';

/**
 * Cadangkan file database SQLite secara online dan aman (WAL-safe).
 * @param {object} options
 * @param {string} [options.backupDir] Folder target pencadangan (default: data/backups)
 * @param {number} [options.maxBackups] Jumlah file cadangan maksimal yang disimpan (default: 7)
 * @returns {Promise<{ backupFile: string, totalBackups: number }>}
 */
export async function backupDatabase({
  backupDir = path.resolve('data', 'backups'),
  maxBackups = 7,
} = {}) {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backupFile = path.join(backupDir, `bot_backup_${timestamp}.db`);

  const db = getDb();
  await db.backup(backupFile);

  // Bersihkan cadangan lama jika melebihi batas maksimal (retensi rotasi)
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('bot_backup_') && f.endsWith('.db'))
    .map((f) => ({
      name: f,
      fullPath: path.join(backupDir, f),
      mtime: fs.statSync(path.join(backupDir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime); // Urutkan dari yang terbaru ke terlama

  if (files.length > maxBackups) {
    for (const old of files.slice(maxBackups)) {
      try {
        fs.unlinkSync(old.fullPath);
      } catch (err) {
        console.warn(`Gagal menghapus file cadangan lama ${old.name}:`, err.message);
      }
    }
  }

  const remaining = Math.min(files.length, maxBackups);
  return { backupFile, totalBackups: remaining };
}

// Jika dijalankan langsung dari terminal: node scripts/backup.js
const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  try {
    const res = await backupDatabase();
    console.log(`✅ Cadangan database berhasil dibuat: ${res.backupFile}`);
    console.log(`📦 Total cadangan tersimpan: ${res.totalBackups}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Gagal mencadangkan database:', err);
    process.exit(1);
  }
}

