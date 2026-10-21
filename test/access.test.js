import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { createAccessCheck, isLoopback } from '../src/access.js';

test('isLoopback tells localhost-only from network listening', () => {
  assert.equal(isLoopback('127.0.0.1'), true);
  assert.equal(isLoopback('localhost'), true);
  assert.equal(isLoopback('::1'), true);
  assert.equal(isLoopback(undefined), true);
  assert.equal(isLoopback('0.0.0.0'), false);
});

test('Host check: this computer by name, and with LAN access by IP address only', () => {
  const local = createAccessCheck();
  for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'LOCALHOST']) assert.equal(local.hostAllowed(host), true, host);
  for (const host of ['192.168.1.20:3000', 'rebind.example.com:3000', '', undefined]) assert.equal(local.hostAllowed(host), false, String(host));

  const lan = createAccessCheck({ lan: true });
  assert.equal(lan.hostAllowed('192.168.1.20:3000'), true);
  assert.equal(lan.hostAllowed('rebind.example.com:3000'), false);
});

test('Origin check: none, or the dashboard itself', () => {
  const { originAllowed } = createAccessCheck();
  assert.equal(originAllowed(undefined, 'localhost:3000'), true);
  assert.equal(originAllowed('http://localhost:3000', 'localhost:3000'), true);
  assert.equal(originAllowed('https://evil.example', 'localhost:3000'), false);
  assert.equal(originAllowed('http://localhost:4000', 'localhost:3000'), false);
  assert.equal(originAllowed('null', 'localhost:3000'), false);
});

async function start(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magfast-access-'));
  const app = createApp({ dataDir: path.join(root, 'data'), outputDir: path.join(root, 'output') });
  const { port } = await app.listen(0, '127.0.0.1');
  t.after(async () => {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return port;
}

// A raw request, so the Host header can be set (fetch won't allow it).
function raw(port, { method = 'GET', path: url = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject).end();
  });
}

test('pages and requests addressed to another name are refused', async (t) => {
  const port = await start(t);
  assert.equal(await raw(port), 200);
  assert.equal(await raw(port, { headers: { Host: `localhost:${port}` } }), 200);
  assert.equal(await raw(port, { headers: { Host: `rebind.example.com:${port}` } }), 403);
  assert.equal(await raw(port, { method: 'DELETE', path: '/api/timer-font', headers: { Origin: 'https://evil.example' } }), 403);
});

test('the live connection only accepts the dashboard\'s own pages', async (t) => {
  const port = await start(t);
  const attempt = (origin) => new Promise((resolve) => {
    const client = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], extraHeaders: origin ? { Origin: origin } : {}, reconnection: false });
    client.on('connect', () => { client.close(); resolve('connected'); });
    client.on('connect_error', () => { client.close(); resolve('refused'); });
  });
  assert.equal(await attempt(`http://127.0.0.1:${port}`), 'connected');
  assert.equal(await attempt(undefined), 'connected');
  assert.equal(await attempt('https://evil.example'), 'refused');
});
