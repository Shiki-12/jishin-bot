-- Skema tabel affinity untuk F-20: Sistem Affinity (Level Dere)
CREATE TABLE IF NOT EXISTS affinity (
  user_id INTEGER PRIMARY KEY,
  points INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 0,
  last_gain_date TEXT NULL,
  gained_today INTEGER NOT NULL DEFAULT 0,
  last_chat_at INTEGER NOT NULL
);

