-- Migration 016: Habit tracker dan logs (F-44)
CREATE TABLE IF NOT EXISTS habits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  remind_time TEXT NULL, -- Format HH:mm (opsional)
  last_remind_date TEXT NULL, -- Format YYYY-MM-DD
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS habit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id INTEGER NOT NULL,
  date TEXT NOT NULL, -- Format YYYY-MM-DD di zona waktu user
  status TEXT NOT NULL, -- 'done' | 'skipped'
  created_at INTEGER NOT NULL,
  UNIQUE(habit_id, date),
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id);
CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_date ON habit_logs(habit_id, date);

