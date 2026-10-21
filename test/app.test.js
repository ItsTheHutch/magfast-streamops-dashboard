import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
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
      type: 'core',
      name: 'Mega Man X',
      category: 'Speedrun - Lemons%',
      estimate: '1:30:00',
      performers: [{ name: 'BlazeBops', pronouns: 'he/him', social: { platform: 'twitch', handle: 'https://twitch.tv/BlazeBops' } }],
    },
    future: [{ type: 'core', name: 'Potpourri Versus!', performers: 'Valair' }],
  });

  assert.deepEqual(reply, { ok: true, warnings: [] });
  assert.equal((await broadcast).current.name, 'Mega Man X');

  const read = (name) => fs.readFileSync(path.join(config.outputDir, name), 'utf8');
  assert.equal(read('current_name.txt'), 'Mega Man X');
  assert.equal(read('performer1_social.txt'), 'twitch.tv/BlazeBops');
  assert.equal(read('performer2_name.txt'), '');
  assert.equal(read('future1_performers.txt'), 'Valair');

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

test('saving settings writes files to the new locations and rejects bad ones', async (t) => {
  const { client, config } = await startApp(t);
  const settings = await once(client, 'settings');
  assert.equal(settings.files['core.name'], 'current_name.txt');
  assert.equal(settings.defaultOutputDir, config.outputDir);

  await request(client, 'live:save', { current: { type: 'core', name: 'Mega Man X' } });
  const broadcast = once(client, 'settings');
  const reply = await request(client, 'settings:save', { files: { ...settings.files, 'core.name': 'live/title.txt' } });
  assert.equal(reply.ok, true);
  assert.equal((await broadcast).files['core.name'], 'live/title.txt');
  assert.equal(fs.readFileSync(path.join(config.outputDir, 'live', 'title.txt'), 'utf8'), 'Mega Man X');

  const bad = await request(client, 'settings:save', { files: { ...settings.files, 'core.name': 'title.json' } });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Must end in \.txt/);
});

test('Race Mode timer actions are shared with every client and refuse finishes for empty slots', async (t) => {
  const { client } = await startApp(t);
  const first = await once(client, 'timer');
  assert.equal(first.status, 'stopped');
  assert.equal(typeof first.serverNow, 'number');

  await request(client, 'live:save', { current: { type: 'core', name: 'Race', performers: [{ name: 'A' }, { name: 'B' }] } });
  assert.equal((await request(client, 'timer', { action: 'race', on: true })).ok, true);
  const started = once(client, 'timer');
  assert.equal((await request(client, 'timer', { action: 'start' })).ok, true);
  assert.equal((await started).status, 'running');

  const empty = await request(client, 'timer', { action: 'finish', slot: 2 });
  assert.equal(empty.ok, false);
  await request(client, 'timer', { action: 'finish', slot: 0 });
  const done = once(client, 'timer');
  await request(client, 'timer', { action: 'finish', slot: 1 });
  assert.equal((await done).status, 'finished');
});

test('a timer font can be uploaded, served and removed', async (t) => {
  const { client, port } = await startApp(t);
  await once(client, 'settings');
  const url = `http://127.0.0.1:${port}/api/timer-font`;
  const font = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(60)]);

  const bad = await fetch(url, { method: 'PUT', headers: { 'X-Filename': 'notes.txt' }, body: Buffer.from('hello') });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /woff2/);

  const fake = await fetch(url, { method: 'PUT', headers: { 'X-Filename': 'fake.woff2' }, body: Buffer.from('not a font') });
  assert.match((await fake.json()).error, /isn't a valid \.woff2 font/);

  const broadcast = once(client, 'settings');
  const res = await fetch(url, { method: 'PUT', headers: { 'X-Filename': encodeURIComponent('My Timer.woff2') }, body: font });
  assert.equal((await res.json()).font.name, 'My Timer.woff2');
  assert.equal((await broadcast).timerFont.ext, 'woff2');

  const served = await fetch(`http://127.0.0.1:${port}/fonts/timer`);
  assert.equal(served.headers.get('content-type'), 'font/woff2');
  assert.equal(Buffer.from(await served.arrayBuffer()).length, font.length);

  await fetch(url, { method: 'DELETE' });
  assert.equal((await fetch(`http://127.0.0.1:${port}/fonts/timer`)).status, 404);
});

test('the Horaro schedule is imported (hidden key kept across the redirect) and can fill Edit Segment', async (t) => {
  const fixture = fs.readFileSync(new URL('./fixtures/horaro-magfast-2026.json', import.meta.url), 'utf8');
  const seen = [];
  const horaro = http.createServer((req, res) => {
    seen.push(req.url);
    if (req.url.startsWith('/-/api/v1/events/magfast/schedules/2026')) {
      res.writeHead(302, { Location: '/-/api/v1/schedules/abc123' }).end();
    } else if (req.url.startsWith('/-/api/v1/schedules/abc123')) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(fixture);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => horaro.listen(0, '127.0.0.1', resolve));
  t.after(() => horaro.close());

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magfast-app-'));
  const app = createApp({
    dataDir: path.join(root, 'data'),
    outputDir: path.join(root, 'output'),
    horaro: { event: 'magfast', schedule: '2026', hiddenKey: 's3cret', apiBase: `http://127.0.0.1:${horaro.address().port}` },
  });
  const { port } = await app.listen(0, '127.0.0.1');
  const client = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  t.after(async () => {
    client.close();
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  let schedule = await once(client, 'schedule');
  while (!schedule.items.length && !schedule.error) schedule = await once(client, 'schedule');
  assert.equal(schedule.error, null);
  assert.equal(schedule.items.length, 11);
  assert.equal(schedule.name, 'magFAST 2026');
  assert.equal(schedule.settings.intervalMinutes, 5);
  assert.ok(seen.some((url) => url === '/-/api/v1/schedules/abc123?hiddenkey=s3cret'), seen.join(' '));

  const updated = once(client, 'live');
  assert.equal((await request(client, 'schedule:load', { index: 1 })).ok, true);
  const live = await updated;
  assert.equal(live.next.name, 'Mega Man X');
  assert.equal(live.future[0].name, 'Potpourri Versus!');
  assert.equal(live.schedule.nextIndex, 1);

  assert.equal((await request(client, 'schedule:refresh')).ok, true);
  const bad = await request(client, 'schedule:settings', { url: 'not a schedule' });
  assert.equal(bad.ok, false);
});

test('Reset All Data erases all data and settings, blanks every text file, and keeps a backup', async (t) => {
  const { client, config, port } = await startApp(t);
  await once(client, 'settings');
  await request(client, 'performers:upsert', { name: 'BlazeBops' });
  await request(client, 'live:save', {
    current: { type: 'core', name: 'Mega Man X', performers: [{ name: 'BlazeBops' }] },
    next: { type: 'host', name: 'Host chat' },
    future: [{ type: 'core', name: 'Super Metroid' }],
  });
  await request(client, 'settings:save', { files: { 'core.name': 'live/title.txt' } });
  await request(client, 'timer', { action: 'start' });
  const font = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(60)]);
  await fetch(`http://127.0.0.1:${port}/api/timer-font`, { method: 'PUT', headers: { 'X-Filename': 'clock.woff2' }, body: font });
  const read = (name) => fs.readFileSync(path.join(config.outputDir, name), 'utf8');
  assert.equal(read('live/title.txt'), 'Mega Man X');

  const reply = await request(client, 'data:reset');
  assert.equal(reply.ok, true);

  const directory = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'performers.json'), 'utf8'));
  assert.deepEqual(directory, []);

  // Every field's file is blank, Core and Host sets alike, at the old and the default locations.
  for (const name of ['live/title.txt', 'current_name.txt', 'performer1_name.txt', 'host_name.txt', 'host1_name.txt', 'next_name.txt', 'future1_name.txt', 'future4_performers.txt']) {
    assert.equal(read(name), '', name);
  }
  const backup = path.join(config.dataDir, 'backups', path.basename(reply.backup));
  assert.equal(JSON.parse(fs.readFileSync(path.join(backup, 'state.json'), 'utf8')).live.current.name, 'Mega Man X');
  assert.equal(JSON.parse(fs.readFileSync(path.join(backup, 'performers.json'), 'utf8'))[0].name, 'BlazeBops');
  const state = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'state.json'), 'utf8'));
  assert.equal(state.live.current.name, '');
  assert.equal(state.timer.status, 'stopped');
  const settings = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'settings.json'), 'utf8'));
  assert.equal(settings.files['core.name'], 'current_name.txt', 'file locations are back to defaults');
  assert.equal(settings.timerFont, null);
  assert.equal(fs.existsSync(path.join(config.dataDir, 'fonts', 'timer-font.woff2')), false);
  assert.equal(fs.existsSync(path.join(backup, 'fonts', 'timer-font.woff2')), true, 'the font is in the backup');
  assert.equal(JSON.parse(fs.readFileSync(path.join(backup, 'settings.json'), 'utf8')).files['core.name'], 'live/title.txt');
});
