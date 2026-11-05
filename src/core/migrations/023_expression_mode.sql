-- Migrasi 023: Kolom pengaturan gaya ekspresi untuk users dan chats
ALTER TABLE users ADD COLUMN expression_mode TEXT DEFAULT NULL;
ALTER TABLE chats ADD COLUMN expression_mode TEXT DEFAULT NULL;

