CREATE TABLE IF NOT EXISTS group_settings (
  chat_id INTEGER PRIMARY KEY,
  chatty INTEGER DEFAULT 0,
  chatty_prob REAL DEFAULT 0.05,
  last_chatty_at INTEGER DEFAULT 0,
  welcome_enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  sender_name TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_group_messages_chat_created ON group_messages(chat_id, created_at);

