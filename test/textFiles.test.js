import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeLive } from '../public/shared/model.js';
import { buildTextFiles, createTextFileWriter } from '../src/outputs/textFiles.js';

const sample = normalizeLive({
  current: {
    name: 'Mega Man X',
    category: 'Speedrun - Lemons%',
    estimate: '1:30:00',
    performers: [{ name: 'BlazeBops', pronouns: 'he/him', social: { platform: 'twitch', handle: 'BlazeBops' } }],
  },
  next: { name: 'Potpourri Versus!', category: 'Interstitial', estimate: '0:15:00', performers: 'Valair' },
});

test('buildTextFiles writes every slot, leaving unused ones empty', () => {
  const files = buildTextFiles(sample);
  assert.equal(files['current_name.txt'], 'Mega Man X');
  assert.equal(files['performer1_social.txt'], 'twitch.tv/BlazeBops');
  assert.equal(files['performer1_handle.txt'], 'BlazeBops');
  assert.equal(files['performer4_name.txt'], '');
  assert.equal(files['next_performers.txt'], 'Valair');
  assert.equal(Object.keys(files).length, 3 + 4 * 4 + 4);
});

test('the writer only rewrites files whose contents changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magfast-text-'));
  try {
    const writer = createTextFileWriter(dir);
    assert.deepEqual(writer.write(sample).errors, []);
    assert.equal(fs.readFileSync(path.join(dir, 'current_name.txt'), 'utf8'), 'Mega Man X');

    // Overwrite a file behind the writer's back; it should stay as-is because its contents didn't change.
    fs.writeFileSync(path.join(dir, 'current_category.txt'), 'untouched marker');
    const changed = normalizeLive({ ...sample, current: { ...sample.current, name: 'Mega Man X2' } });
    writer.write(changed);

    assert.equal(fs.readFileSync(path.join(dir, 'current_name.txt'), 'utf8'), 'Mega Man X2');
    assert.equal(fs.readFileSync(path.join(dir, 'current_category.txt'), 'utf8'), 'untouched marker');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
