import http from 'node:http';
import { webhookCallback } from 'grammy';
import { getActiveModel, isMaintenanceMode } from './admin.js';

let activeServer = null;

/**
 * Buat payload respon status kesehatan bot.
 */
export function createHealthCheckPayload() {
  return {
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    model: getActiveModel(),
    maintenance: isMaintenanceMode(),
  };
}

/**
 * Buat instance HTTP server untuk health check dan webhook Telegram.
 */
export function createHttpServer({
  bot = null,
  healthPath = '/health',
  webhookPath = '/webhook',
  webhookSecret = undefined,
} = {}) {
  const webhookHandler = bot
    ? webhookCallback(bot, 'http', { secretToken: webhookSecret })
    : null;

  const server = http.createServer(async (req, res) => {
    const url = (req.url || '').split('?')[0];

    // 1. Endpoint Health Check (GET /health atau GET /)
    if (req.method === 'GET' && (url === healthPath || url === '/')) {
      const payload = createHealthCheckPayload();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload, null, 2));
      return;
    }

    // 2. Endpoint Webhook Telegram (POST /webhook)
    if (req.method === 'POST' && url === webhookPath && webhookHandler) {
      return webhookHandler(req, res);
    }

    // 3. Fallback Not Found
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  return server;
}

/**
 * Nyalakan HTTP server pada port yang ditentukan.
 */
export async function startServer({
  port = 3000,
  bot = null,
  healthPath = '/health',
  webhookPath = '/webhook',
  webhookSecret = undefined,
} = {}) {
  if (activeServer) {
    await stopServer();
  }

  const server = createHttpServer({ bot, healthPath, webhookPath, webhookSecret });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => {
      activeServer = server;
      resolve(server);
    });
  });
}

/**
 * Hentikan HTTP server secara anggun.
 */
export async function stopServer() {
  if (!activeServer) return;

  const s = activeServer;
  activeServer = null;

  return new Promise((resolve) => {
    s.close(() => resolve());
  });
}

