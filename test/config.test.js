import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepMerge } from '../src/config.js';

test('deepMerge overrides nested keys without dropping siblings', () => {
  const base = { port: 3000, horaro: { event: 'magfast', schedule: '2027', columns: { name: 'What', performers: 'Who' } } };
  const merged = deepMerge(base, { horaro: { columns: { name: 'Game' } } });

  assert.equal(merged.port, 3000);
  assert.equal(merged.horaro.schedule, '2027');
  assert.deepEqual(merged.horaro.columns, { name: 'Game', performers: 'Who' });
});

test('deepMerge replaces arrays rather than merging them', () => {
  assert.deepEqual(deepMerge({ list: [1, 2] }, { list: [3] }), { list: [3] });
});
