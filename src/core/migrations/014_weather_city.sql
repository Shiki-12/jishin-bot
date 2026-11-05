-- Migrasi 014: Kolom kota untuk users dan chats (F-40: Cuaca)
ALTER TABLE users ADD COLUMN city TEXT DEFAULT NULL;
ALTER TABLE chats ADD COLUMN city TEXT DEFAULT NULL;

