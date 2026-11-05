-- Migrasi 022: Ubah kolom persona pada users dan chats agar default NULL dan reset data lama
PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY,
  first_name TEXT,
  username TEXT,
  tz TEXT DEFAULT 'Asia/Jakarta',
  persona TEXT DEFAULT NULL,
  lang TEXT DEFAULT 'id',
  created_at INTEGER NOT NULL,
  gif_freq TEXT DEFAULT 'normal',
  city TEXT DEFAULT NULL,
  adzan INTEGER DEFAULT 0,
  adzan_lead INTEGER DEFAULT 10,
  adzan_last_date TEXT DEFAULT NULL,
  voice_reply INTEGER DEFAULT 0
);

INSERT INTO users_new (
  id, first_name, username, tz, persona, lang, created_at,
  gif_freq, city, adzan, adzan_lead, adzan_last_date, voice_reply
)
SELECT
  id, first_name, username, tz, NULL, lang, created_at,
  gif_freq, city, adzan, adzan_lead, adzan_last_date, voice_reply
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE TABLE chats_new (
  id INTEGER PRIMARY KEY,
  type TEXT,
  persona TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL,
  tz TEXT DEFAULT 'Asia/Jakarta',
  lang TEXT DEFAULT 'id',
  gif_freq TEXT DEFAULT 'normal',
  city TEXT DEFAULT NULL,
  adzan INTEGER DEFAULT 0,
  adzan_lead INTEGER DEFAULT 10,
  adzan_last_date TEXT DEFAULT NULL,
  voice_reply INTEGER DEFAULT 0
);

INSERT INTO chats_new (
  id, type, persona, created_at, tz, lang, gif_freq,
  city, adzan, adzan_lead, adzan_last_date, voice_reply
)
SELECT
  id, type, NULL, created_at, tz, lang, gif_freq,
  city, adzan, adzan_lead, adzan_last_date, voice_reply
FROM chats;

DROP TABLE chats;
ALTER TABLE chats_new RENAME TO chats;

PRAGMA foreign_keys = ON;

