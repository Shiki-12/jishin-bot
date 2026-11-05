-- Skema tabel proactive_settings untuk F-22: Proactive Chat
CREATE TABLE IF NOT EXISTS proactive_settings (
  user_id INTEGER PRIMARY KEY,
  enabled INTEGER DEFAULT 0,
  quiet_start TEXT DEFAULT '22:00',
  quiet_end TEXT DEFAULT '07:00',
  min_idle_hours INTEGER DEFAULT 8,
  unreplied_count INTEGER DEFAULT 0,
  last_sent_at INTEGER DEFAULT 0,
  last_sent_date TEXT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proactive_enabled ON proactive_settings(enabled);

