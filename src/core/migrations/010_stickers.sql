-- Skema tabel stickers untuk F-21: Stiker
CREATE TABLE IF NOT EXISTS stickers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT NOT NULL UNIQUE,
  mood TEXT NOT NULL,
  set_name TEXT NULL,
  emoji TEXT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stickers_mood ON stickers(mood);

