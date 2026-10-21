import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeLive } from '../public/shared/model.js';
import { buildTextFiles, createTextFileWriter } from '../src/outputs/textFiles.js';
import { defaultOutputSettings } from '../public/shared/outputFiles.js';

const sample = normalizeLive({
  current: {
    type: 'core',
    name: 'Mega Man X',
    category: 'Speedrun - Lemons%',
    estimate: '1:30:00',
    performers: [{ name: 'BlazeBops', pronouns: 'he/him', social: { platform: 'twitch', handle: 'BlazeBops' } }],
  },
  next: { type: 'host', name: 'Potpourri Versus!', estimate: '0:15:00', performers: [{ name: 'Valair' }, { name: 'Kirara' }] },
  future: [{ type: 'core', name: 'Super Metroid', estimate: '1:20:00', performers: 'MegaMarty' }],
});

test('a Core Content live segment writes current_* and performerN_* files', () => {
  const files = buildTextFiles(sample);
  assert.equal(files['current_name.txt'], 'Mega Man X');
  assert.equal(files['performer1_social.txt'], 'twitch.tv/BlazeBops');
  assert.equal(files['performer1_handle.txt'], 'BlazeBops');
  assert.equal(files['performer4_name.txt'], '');
  assert.equal('host_name.txt' in files, false);
  assert.equal(files['next_name.txt'], 'Potpourri Versus!');
  assert.equal(files['next_performers.txt'], 'Valair, Kirara');
  assert.equal(files['future1_name.txt'], 'Super Metroid');
  assert.equal(files['future4_name.txt'], '');
  assert.equal(Object.keys(files).length, 3 + 4 * 4 + 4 + 4 * 4);
});

test('a Host/Interstitial live segment writes host_* and hostN_* files instead', () => {
  const files = buildTextFiles(normalizeLive({ ...sample, current: { ...sample.current, type: 'host', name: 'Host chat' } }));
  assert.equal(files['host_name.txt'], 'Host chat');
  assert.equal(files['host1_name.txt'], 'BlazeBops');
  assert.equal('current_name.txt' in files, false);
  assert.equal('performer1_name.txt' in files, false);
});

test('a live segment with no type writes neither set', () => {
  const files = buildTextFiles(normalizeLive({ ...sample, current: { name: 'Untyped' } }));
  assert.equal('current_name.txt' in files, false);
  assert.equal('host_name.txt' in files, false);
});

test('the writer only rewrites files whose contents changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magfast-text-'));
  try {
    const settings = { outputDir: dir, files: defaultOutputSettings().files };
    const writer = createTextFileWriter();
    assert.deepEqual(writer.write(sample, settings).errors, []);
    assert.equal(fs.readFileSync(path.join(dir, 'current_name.txt'), 'utf8'), 'Mega Man X');

    // Overwrite a file behind the writer's back; it should stay as-is because its contents didn't change.
    fs.writeFileSync(path.join(dir, 'current_category.txt'), 'untouched marker');
    const changed = normalizeLive({ ...sample, current: { ...sample.current, name: 'Mega Man X2' } });
    writer.write(changed, settings);

    assert.equal(fs.readFileSync(path.join(dir, 'current_name.txt'), 'utf8'), 'Mega Man X2');
    assert.equal(fs.readFileSync(path.join(dir, 'current_category.txt'), 'utf8'), 'untouched marker');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('files go to the locations from Settings, including full paths and subfolders', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magfast-text-'));
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'magfast-elsewhere-'));
  try {
    const files = {
      ...defaultOutputSettings().files,
      'core.name': 'run/title.txt',
      'core.performerName': path.join(elsewhere, 'runner{n}.txt'),
    };
    createTextFileWriter().write(sample, { outputDir: dir, files });
    assert.equal(fs.readFileSync(path.join(dir, 'run', 'title.txt'), 'utf8'), 'Mega Man X');
    assert.equal(fs.readFileSync(path.join(elsewhere, 'runner1.txt'), 'utf8'), 'BlazeBops');
    assert.equal(fs.readFileSync(path.join(elsewhere, 'runner4.txt'), 'utf8'), '');
    assert.equal(fs.existsSync(path.join(dir, 'current_name.txt')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});
