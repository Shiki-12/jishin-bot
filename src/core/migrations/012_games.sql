-- Skema tabel game_scores untuk F-23: Game Kecil
CREATE TABLE IF NOT EXISTS game_scores (
  user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  points INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_game_scores_chat ON game_scores(chat_id, points DESC);

