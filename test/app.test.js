import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';
import { createApp } from '../src/app.js';

// Starts the app on a random port with throwaway data/output folders.
async function startApp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magfast-app-'));
  const config = { dataDir: path.join(root, 'data'), outputDir: path.join(root, 'output') };
  const app = createApp(config);
  const { port } = await app.listen(0, '127.0.0.1');
  const client = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });

  t.after(async () => {
    client.close();
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { app, client, config, port };
}

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
const request = (socket, event, payload) => socket.timeout(2000).emitWithAck(event, payload);

test('a new client receives the saved state and the directory', async (t) => {
  const { client } = await startApp(t);
  const [live, performers] = await Promise.all([once(client, 'live'), once(client, 'performers')]);
  assert.equal(live.current.performers.length, 4);
  assert.deepEqual(performers, []);
});

test('saving writes OBS text files and broadcasts to every client', async (t) => {
  const { client, config, port } = await startApp(t);
  const other = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  t.after(() => other.close());
  await Promise.all([once(client, 'live'), once(other, 'live')]);

  const broadcast = once(other, 'live');
  const reply = await request(client, 'live:save', {
    current: {
      name: 'Mega Man X',
      category: 'Speedrun - Lemons%',
      estimate: '1:30:00',
      performers: [{ name: 'BlazeBops', pronouns: 'he/him', social: { platform: 'twitch', handle: 'https://twitch.tv/BlazeBops' } }],
    },
    next: { name: 'Potpourri Versus!', performers: 'Valair' },
  });

  assert.deepEqual(reply, { ok: true, warnings: [] });
  assert.equal((await broadcast).current.name, 'Mega Man X');

  const read = (name) => fs.readFileSync(path.join(config.outputDir, name), 'utf8');
  assert.equal(read('current_name.txt'), 'Mega Man X');
  assert.equal(read('performer1_social.txt'), 'twitch.tv/BlazeBops');
  assert.equal(read('performer2_name.txt'), '');
  assert.equal(read('next_performers.txt'), 'Valair');

  const res = await fetch(`http://127.0.0.1:${port}/api/live`);
  assert.equal((await res.json()).current.category, 'Speedrun - Lemons%');
});

test('directory errors come back as failed replies, not crashes', async (t) => {
  const { client } = await startApp(t);
  await once(client, 'performers');

  const added = await request(client, 'performers:upsert', { name: 'BlazeBops' });
  assert.equal(added.ok, true);

  const dupe = await request(client, 'performers:upsert', { name: 'BLAZEBOPS' });
  assert.equal(dupe.ok, false);
  assert.match(dupe.error, /already in the directory/);

  assert.equal((await request(client, 'performers:delete', { id: 'nope' })).ok, false);
});
