-- Migration 020: Skema tabel usage untuk pelacakan token dan latensi (F-64)
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date_str TEXT NOT NULL, -- Format YYYY-MM-DD
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_user_date ON usage(user_id, date_str);
CREATE INDEX IF NOT EXISTS idx_usage_date ON usage(date_str);

