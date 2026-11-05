-- Skema tabel moods untuk F-24: Mood Check-in & Jurnal
CREATE TABLE IF NOT EXISTS moods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  score INTEGER NOT NULL,
  note TEXT NULL,
  date_str TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moods_user_date ON moods(user_id, date_str);
CREATE INDEX IF NOT EXISTS idx_moods_created ON moods(user_id, created_at DESC);

