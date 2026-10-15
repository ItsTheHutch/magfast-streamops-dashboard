import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.js';

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magfast-store-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('saved live state survives a restart', () => withTempDir((dir) => {
  createStore(dir).saveLive({ current: { name: 'Mega Man X' } });
  assert.equal(createStore(dir).getLive().current.name, 'Mega Man X');
}));

test('performers are added, updated, de-duplicated and deleted', () => withTempDir((dir) => {
  const store = createStore(dir);
  const added = store.upsertPerformer({ name: 'BlazeBops', pronouns: 'he/him' });
  assert.ok(added.id);

  store.upsertPerformer({ ...added, pronouns: 'they/them' });
  assert.equal(store.getPerformers().length, 1);
  assert.equal(store.getPerformers()[0].pronouns, 'they/them');

  assert.throws(() => store.upsertPerformer({ name: 'blazebops' }), /already in the directory/);
  assert.throws(() => store.upsertPerformer({ name: '  ' }), /name is required/);

  assert.equal(createStore(dir).getPerformers()[0].name, 'BlazeBops');

  store.deletePerformer(added.id);
  assert.equal(store.getPerformers().length, 0);
  assert.throws(() => store.deletePerformer(added.id), /not found/);
}));

test('a corrupt state file is backed up instead of crashing', () => withTempDir((dir) => {
  fs.writeFileSync(path.join(dir, 'state.json'), '{ not json');
  const store = createStore(dir);
  assert.equal(store.getLive().current.name, '');
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('state.json.corrupt-')));
}));
