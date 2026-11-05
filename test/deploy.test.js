import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

import {
  createHealthCheckPayload,
  createHttpServer,
  startServer,
  stopServer,
} from '../src/core/server.js';
import { backupDatabase } from '../scripts/backup.js';

test('F-62: Deploy (Health Check, Webhook Server, Backup & Configs)', async (t) => {
  await t.test('Payload Health Check (createHealthCheckPayload)', () => {
    const payload = createHealthCheckPayload();
    assert.equal(payload.status, 'ok');
    assert.equal(typeof payload.uptime, 'number');
    assert.ok(payload.timestamp);
    assert.ok(payload.model);
    assert.equal(typeof payload.maintenance, 'boolean');
  });

  await t.test('HTTP Server Health Check Endpoint (/health & /)', async () => {
    const testPort = 39988;
    await startServer({ port: testPort });

    const fetchJson = (urlPath) =>
      new Promise((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${testPort}${urlPath}`, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              try {
                resolve({ status: res.statusCode, data: JSON.parse(data) });
              } catch (e) {
                resolve({ status: res.statusCode, raw: data });
              }
            });
          })
          .on('error', reject);
      });

    // 1. GET /health
    const resHealth = await fetchJson('/health');
    assert.equal(resHealth.status, 200);
    assert.equal(resHealth.data.status, 'ok');

    // 2. GET / (root alias)
    const resRoot = await fetchJson('/');
    assert.equal(resRoot.status, 200);
    assert.equal(resRoot.data.status, 'ok');

    // 3. GET /unknown-path -> 404
    const res404 = await fetchJson('/unknown-path');
    assert.equal(res404.status, 404);
    assert.equal(res404.data.error, 'Not Found');

    await stopServer();
  });

  await t.test('Pencadangan Database SQLite (backupDatabase & Rotasi)', async () => {
    const tempBackupDir = path.resolve('data', 'test_backups');
    if (fs.existsSync(tempBackupDir)) {
      fs.rmSync(tempBackupDir, { recursive: true, force: true });
    }

    // 1. Buat backup pertama
    const res1 = await backupDatabase({ backupDir: tempBackupDir, maxBackups: 2 });
    assert.ok(fs.existsSync(res1.backupFile));
    assert.ok(fs.statSync(res1.backupFile).size > 0);
    assert.equal(res1.totalBackups, 1);

    // Beri jeda kecil agar timestamp berbeda
    await new Promise((r) => setTimeout(r, 1050));

    // 2. Buat backup kedua
    const res2 = await backupDatabase({ backupDir: tempBackupDir, maxBackups: 2 });
    assert.ok(fs.existsSync(res2.backupFile));
    assert.equal(res2.totalBackups, 2);

    await new Promise((r) => setTimeout(r, 1050));

    // 3. Buat backup ketiga (harus merotasi dan mempertahankan hanya 2 file)
    const res3 = await backupDatabase({ backupDir: tempBackupDir, maxBackups: 2 });
    assert.ok(fs.existsSync(res3.backupFile));

    const remainingFiles = fs
      .readdirSync(tempBackupDir)
      .filter((f) => f.startsWith('bot_backup_') && f.endsWith('.db'));
    assert.equal(remainingFiles.length, 2);

    // Bersihkan folder test
    fs.rmSync(tempBackupDir, { recursive: true, force: true });
  });

  await t.test('Validasi Berkas Konfigurasi Deployment (Dockerfile, Compose, PM2)', () => {
    // 1. Dockerfile
    const dockerfile = fs.readFileSync(path.resolve('Dockerfile'), 'utf-8');
    assert.match(dockerfile, /FROM node:22-slim/);
    assert.match(dockerfile, /VOLUME \["\/app\/data"\]/);

    // 2. docker-compose.yml
    const compose = fs.readFileSync(path.resolve('docker-compose.yml'), 'utf-8');
    assert.match(compose, /\.\/data:\/app\/data/);

    // 3. ecosystem.config.cjs (PM2)
    const pm2 = fs.readFileSync(path.resolve('ecosystem.config.cjs'), 'utf-8');
    assert.match(pm2, /instances:\s*1/);
    assert.match(pm2, /telegram-ai-bot/);
  });
});

