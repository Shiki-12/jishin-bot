-- Skema tabel schedules untuk pesan pagi & malam terjadwal (F-13)
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'morning' | 'night'
  time TEXT NOT NULL, -- 'HH:mm'
  tz TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'disabled'
  last_run_date TEXT NULL, -- 'YYYY-MM-DD'
  created_at INTEGER NOT NULL,
  UNIQUE(chat_id, user_id, type)
);

CREATE INDEX IF NOT EXISTS idx_schedules_active ON schedules(status, type);

