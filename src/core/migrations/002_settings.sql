-- Migrasi 002: Kolom pengaturan tambahan untuk users dan chats
ALTER TABLE users ADD COLUMN gif_freq TEXT DEFAULT 'normal';
ALTER TABLE chats ADD COLUMN tz TEXT DEFAULT 'Asia/Jakarta';
ALTER TABLE chats ADD COLUMN lang TEXT DEFAULT 'id';
ALTER TABLE chats ADD COLUMN gif_freq TEXT DEFAULT 'normal';

