-- Skema tabel untuk F-14: Memori Jangka Panjang & Ringkasan Percakapan
CREATE TABLE IF NOT EXISTS summaries (
  chat_id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  fact TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, fact)
);

CREATE INDEX IF NOT EXISTS idx_user_facts_user ON user_facts(user_id);

