-- Migrasi 003: Tabel pengingat (reminders)
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  tz TEXT NOT NULL,
  repeat TEXT,
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  last_sent_at INTEGER,
  snooze_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reminders_status_due ON reminders(status, due_at);
CREATE INDEX IF NOT EXISTS idx_reminders_user_status ON reminders(user_id, status);

