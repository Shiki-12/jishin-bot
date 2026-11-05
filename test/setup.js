// Setup lingkungan pengujian otomatis (in-memory database & guard data/bot.db)
process.env.NODE_ENV = 'test';
if (!process.env.DB_PATH) {
  process.env.DB_PATH = ':memory:';
}
if (!process.env.EXPRESSION_MODE) {
  process.env.EXPRESSION_MODE = 'off';
}


