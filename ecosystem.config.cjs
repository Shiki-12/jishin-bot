module.exports = {
  apps: [
    {
      name: 'telegram-ai-bot',
      script: 'src/index.js',
      instances: 1, // Wajib 1: Polling Telegram dilarang multi-instance
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
      time: true,
    },
  ],
};

