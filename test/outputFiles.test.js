import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTPUT_FIELDS,
  defaultOutputSettings,
  expandLocation,
  normalizeOutputSettings,
  validateOutputSettings,
} from '../public/shared/outputFiles.js';

const field = (key) => OUTPUT_FIELDS.find((f) => f.key === key);
const withFiles = (files) => normalizeOutputSettings({ files: { ...defaultOutputSettings().files, ...files } });

test('the default locations are valid', () => {
  assert.deepEqual(validateOutputSettings(defaultOutputSettings()), []);
});

test('blank locations fall back to their defaults', () => {
  const settings = normalizeOutputSettings({ outputDir: ' ', files: { 'core.name': '  ' } });
  assert.equal(settings.outputDir, '');
  assert.equal(settings.files['core.name'], 'current_name.txt');
});

test('expandLocation fills in {n} for repeating fields', () => {
  assert.deepEqual(expandLocation(field('core.name'), 'title.txt'), ['title.txt']);
  assert.deepEqual(expandLocation(field('future.name'), 'f{n}.txt'), ['f1.txt', 'f2.txt', 'f3.txt', 'f4.txt']);
});

test('validateOutputSettings catches bad and clashing locations', () => {
  const messages = (files) => validateOutputSettings(withFiles(files)).map((e) => `${e.key}: ${e.message}`);
  assert.deepEqual(messages({ 'core.name': 'title.json' }), ['core.name: Must end in .txt.']);
  assert.deepEqual(messages({ 'core.performerName': 'runner.txt' }), ['core.performerName: Must include {n}, so each one gets its own file.']);
  assert.deepEqual(messages({ 'next.name': 'CURRENT_NAME.txt' }), ['next.name: Same file as Live Segment: Core Content › Segment name.']);
  assert.deepEqual(messages({ 'future.name': 'performer{n}_name.txt' }), ['future.name: Same file as Live Segment: Core Content › Performer name.']);
});
