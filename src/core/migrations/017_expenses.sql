-- Migration 017: Catat Pengeluaran (F-45)
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL, -- Nominal dalam satuan rupiah (integer)
  category TEXT NOT NULL,  -- makanan, transport, belanja, tagihan, hiburan, kesehatan, lainnya
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_user_created ON expenses(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_expenses_user_category ON expenses(user_id, category);

