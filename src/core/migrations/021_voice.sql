-- Migrasi 021: Kolom voice_reply untuk balasan suara TTS (F-31)
ALTER TABLE users ADD COLUMN voice_reply INTEGER DEFAULT 0;
ALTER TABLE chats ADD COLUMN voice_reply INTEGER DEFAULT 0;

