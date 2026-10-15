import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { loadConfig, ROOT_DIR } from './config.js';

const config = loadConfig();

fs.mkdirSync(config.outputDir, { recursive: true });
fs.mkdirSync(config.dataDir, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server);

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: process.env.npm_package_version ?? null, node: process.version });
});

app.use('/overlay', express.static(path.join(ROOT_DIR, 'public', 'overlay')));
app.use('/', express.static(path.join(ROOT_DIR, 'public', 'dashboard')));

io.on('connection', (socket) => {
  socket.emit('hello', { serverTime: Date.now() });
});

server.listen(config.port, config.host, () => {
  console.log(`magFAST StreamOps listening on http://localhost:${config.port}`);
  console.log(`  Dashboard: http://localhost:${config.port}/`);
  console.log(`  OBS text files: ${config.outputDir}`);
  if (!config.hasLocalConfig) {
    console.log('  Note: using defaults. Copy config/config.example.json to config/config.json to customize.');
  }
});
