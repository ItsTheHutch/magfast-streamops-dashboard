import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { ROOT_DIR } from './config.js';
import { createStore } from './store.js';
import { createTextFileWriter } from './outputs/textFiles.js';

// Builds the HTTP + Socket.IO server without starting it, so tests can run it on a spare port.
export function createApp(config) {
  const store = createStore(config.dataDir);
  const textFiles = createTextFileWriter(config.outputDir);

  const startup = textFiles.write(store.getLive());
  for (const error of startup.errors) console.error(`Text file error: ${error}`);

  const app = express();
  const server = http.createServer(app);
  const io = new SocketServer(server);

  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, version: process.env.npm_package_version ?? null, node: process.version });
  });

  app.get('/api/live', (req, res) => {
    res.json(store.getLive());
  });

  app.use('/shared', express.static(path.join(ROOT_DIR, 'public', 'shared')));
  app.use('/overlay', express.static(path.join(ROOT_DIR, 'public', 'overlay')));
  app.use('/', express.static(path.join(ROOT_DIR, 'public', 'dashboard')));

  // Runs a socket request handler and replies through the client's ack callback.
  function handle(socket, event, handler) {
    socket.on(event, async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        reply({ ok: true, ...(await handler(payload)) });
      } catch (err) {
        console.error(`${event} failed: ${err.message}`);
        reply({ ok: false, error: err.message });
      }
    });
  }

  io.on('connection', (socket) => {
    socket.emit('hello', { serverTime: Date.now() });
    socket.emit('live', store.getLive());
    socket.emit('performers', store.getPerformers());

    handle(socket, 'live:save', (payload) => {
      const live = store.saveLive(payload);
      const { errors } = textFiles.write(live);
      io.emit('live', live);
      return { warnings: errors };
    });

    handle(socket, 'performers:upsert', (payload) => {
      const entry = store.upsertPerformer(payload);
      io.emit('performers', store.getPerformers());
      return { performer: entry };
    });

    handle(socket, 'performers:delete', (payload) => {
      store.deletePerformer(payload?.id);
      io.emit('performers', store.getPerformers());
      return {};
    });
  });

  return {
    server,
    io,
    store,
    listen(port, host) {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
    },
    close() {
      return new Promise((resolve) => io.close(() => resolve()));
    },
  };
}
