-- Migrasi 004: Tabel to-do list (todos)
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  due_at INTEGER,
  created_at INTEGER NOT NULL,
  done_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_todos_user_done ON todos(user_id, done);

