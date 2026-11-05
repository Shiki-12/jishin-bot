-- Skema tabel custom_personas untuk F-15
CREATE TABLE IF NOT EXISTS custom_personas (
  chat_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT 'Custom',
  description TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

