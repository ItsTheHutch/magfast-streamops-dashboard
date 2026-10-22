import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { macroAction } from '../src/macros.js';
import { emptyTimer } from '../public/shared/timer.js';

const timer = (fields) => ({ ...emptyTimer(), ...fields });

test('macros follow the timer\'s state', () => {
  assert.deepEqual(macroAction('timer-toggle', timer({ status: 'stopped' }), [0]), { action: 'start' });
  assert.deepEqual(macroAction('timer-toggle', timer({ status: 'running' }), [0]), { action: 'pause' });
  assert.deepEqual(macroAction('timer-toggle', timer({ status: 'paused' }), [0]), { action: 'resume' });
  assert.throws(() => macroAction('timer-toggle', timer({ status: 'finished' }), [0]), /Reset the timer/);
  assert.equal(macroAction('nonsense', timer(), [0]), null);
});

test('in Race Mode, runners finish by slot and undo takes back the latest finish', () => {
  const race = timer({ status: 'running', raceMode: true, finishes: [5000, null, 9000, null] });
  assert.deepEqual(macroAction('finish-runner-2', race, [0, 1, 2]), { action: 'finish', slot: 1 });
  assert.deepEqual(macroAction('timer-undo-finish', race, [0, 1, 2]), { action: 'unfinish', slot: 2 });
  assert.throws(() => macroAction('timer-finish', race, [0, 1, 2]), /Finish runner/);
  assert.throws(() => macroAction('finish-runner-1', timer({ status: 'running' }), [0]), /Race Mode isn't on/);
  assert.deepEqual(macroAction('race-mode', timer(), [0, 1]), { action: 'race', on: true });
});

test('a Stream Deck can run the timer through /api/macro with the key', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magfast-macros-'));
  const app = createApp({ dataDir: path.join(root, 'data'), outputDir: path.join(root, 'output') });
  const { port } = await app.listen(0, '127.0.0.1');
  const client = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  t.after(async () => {
    client.close();
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const notices = [];
  client.on('notice', (n) => notices.push(n.message));
  const { macroKey } = await new Promise((resolve) => client.once('settings', resolve));
  assert.match(macroKey, /^[0-9a-f]{32}$/);
  const press = async (id, { key = macroKey, method = 'GET' } = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/macro/${id}?key=${key}`, { method });
    return { status: res.status, ...(await res.json()) };
  };

  assert.equal((await press('timer-toggle', { key: 'wrong' })).status, 403);
  assert.equal((await press('timer-toggle', { key: '' })).status, 403);
  assert.equal((await press('no-such-thing')).status, 404);

  assert.equal((await press('timer-toggle')).timer, 'running');
  assert.equal((await press('timer-toggle')).timer, 'paused');
  assert.equal((await press('timer-toggle', { method: 'POST' })).timer, 'running');
  assert.equal((await press('timer-start')).status, 409, 'already started');

  // Race Mode with two runners.
  await client.timeout(2000).emitWithAck('live:save', { current: { type: 'core', name: 'Race', performers: [{ name: 'A' }, { name: 'B' }] } });
  assert.equal((await press('race-mode')).status, 200);
  assert.equal((await press('finish-runner-2')).status, 200);
  assert.equal((await press('finish-runner-1')).timer, 'finished');
  assert.equal((await press('timer-undo-finish')).timer, 'running', 'undoes runner 1, the latest');
  assert.equal((await press('finish-runner-3')).status, 409, 'no runner in slot 3');

  // Reset takes two presses within 3 seconds.
  const first = await press('timer-reset');
  assert.equal(first.status, 202);
  assert.equal(first.timer, 'running');
  // The notice is broadcast over the live connection, so it can arrive just after the HTTP reply.
  for (let i = 0; i < 50 && !notices.length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.match(notices.at(-1), /press Reset again/);
  assert.equal((await press('timer-reset')).timer, 'stopped');

  // A new key replaces the old one.
  await client.timeout(2000).emitWithAck('macros:new-key');
  assert.equal((await press('timer-toggle')).status, 403);
});
