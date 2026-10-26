import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { parseDelimited, readSpreadsheet } from '../public/shared/spreadsheet.js';
import { TEMPLATE_CSV, performersFromRows, planImport } from '../public/shared/performerImport.js';

const bytes = (text, encoding = 'utf8') => new Uint8Array(Buffer.from(text, encoding));

test('CSV: quotes, separators and line endings', () => {
  assert.deepEqual(parseDelimited('Name,Pronouns\r\n"Fan, Co","say ""hi"""\r\nA,\n'), [['Name', 'Pronouns'], ['Fan, Co', 'say "hi"'], ['A', '']]);
  // Excel in many European languages separates with semicolons.
  assert.deepEqual(parseDelimited('Name;Social\nA;twitch.tv/a'), [['Name', 'Social'], ['A', 'twitch.tv/a']]);
  assert.deepEqual(parseDelimited('Name\tSocial\nA\tb'), [['Name', 'Social'], ['A', 'b']]);
  assert.deepEqual(parseDelimited('Name\n"two\nlines"'), [['Name'], ['two\nlines']]);
});

test('CSV files saved by Excel in Windows-1252 still read correctly', async () => {
  assert.deepEqual(await readSpreadsheet('a.csv', bytes('Name\r\nJosé\r\n', 'latin1')), [['Name'], ['José']]);
  assert.deepEqual(await readSpreadsheet('a.csv', bytes('﻿Name\r\nJosé\r\n')), [['Name'], ['José']]);
});

test('Excel workbooks: the first visible sheet, shared and inline text, numbers and gaps', async () => {
  const rows = await readSpreadsheet('performers.xlsx', fs.readFileSync(new URL('./fixtures/performers.xlsx', import.meta.url)));
  assert.deepEqual(rows, [
    ['Runner', 'Pronouns', 'Twitch', 'YouTube'],
    ['BlazeBops', 'she/her', 'https://www.twitch.tv/BlazeBops'],
    ['Kirara', 'they/them', '', '@kirara_runs'],
    [],
    ['MegaFan & Co', '', '12345'],
    ['', 'he/him'],
  ]);

  const { performers, skipped } = performersFromRows(rows);
  assert.deepEqual(performers.map((p) => p.performer), [
    { name: 'BlazeBops', pronouns: 'she/her', social: { platform: 'twitch', handle: 'BlazeBops' } },
    { name: 'Kirara', pronouns: 'they/them', social: { platform: 'youtube', handle: 'kirara_runs' } },
    { name: 'MegaFan & Co', pronouns: '', social: { platform: 'twitch', handle: '12345' } },
  ]);
  assert.deepEqual(skipped, [{ row: 6, name: '', reason: 'No name' }]);
});

test('files that aren\'t spreadsheets get a clear message', async () => {
  await assert.rejects(readSpreadsheet('old.xls', bytes('\xd0\xcf\x11\xe0', 'latin1')), /old-style Excel file/);
  await assert.rejects(readSpreadsheet('broken.xlsx', bytes('PK\x03\x04 not really', 'latin1')), /damaged/);
  assert.throws(() => performersFromRows([['Game', 'Category'], ['Mega Man X', 'Any%']]), /Couldn't find a Name column/);
});

test('rows become performers: social links, a Platform column, duplicates and blank rows', () => {
  const rows = parseDelimited([
    'Performer Name,Pronouns,Social,Platform',
    'BlazeBops,she/her,https://twitch.tv/BlazeBops,',
    'Kirara,,kirara_runs,YouTube',
    ',,,',
    'Host Person,he/him,example.com,Website',
    'blazebops,,,',
    'Plain,,@plain,',
  ].join('\n'));
  const { performers, skipped } = performersFromRows(rows);
  assert.deepEqual(performers.map((p) => [p.row, p.performer.name, p.performer.social.platform, p.performer.social.handle]), [
    [2, 'BlazeBops', 'twitch', 'BlazeBops'],
    [3, 'Kirara', 'youtube', 'kirara_runs'],
    [5, 'Host Person', 'web', 'example.com'],
    [7, 'Plain', '', 'plain'],
  ]);
  assert.deepEqual(skipped, [{ row: 6, name: 'blazebops', reason: 'Same name as row 2' }]);
});

test('the template imports as it is', () => {
  const { performers } = performersFromRows(parseDelimited(TEMPLATE_CSV));
  assert.equal(performers.length, 3);
  assert.equal(performers[1].performer.social.platform, 'youtube');
});

test('planImport: new, updated, unchanged, and blank cells never erase', () => {
  const directory = [
    { id: '1', name: 'BlazeBops', pronouns: 'she/her', social: { platform: 'twitch', handle: 'BlazeBops' } },
    { id: '2', name: 'Kirara', pronouns: '', social: { platform: '', handle: '' } },
  ];
  const incoming = [
    { name: 'blazebops', pronouns: '', social: { platform: '', handle: '' } },
    { name: 'Kirara', pronouns: 'they/them', social: { platform: '', handle: '' } },
    { name: 'New Person', pronouns: '', social: { platform: '', handle: '' } },
  ];
  const plan = planImport(incoming, directory);
  assert.deepEqual(plan.map((p) => p.status), ['same', 'update', 'new']);
  assert.deepEqual(plan[1].changes, ['pronouns']);
  assert.equal(plan[1].performer.id, '2');
  assert.deepEqual(planImport(incoming, directory, { updateExisting: false }).map((p) => p.status), ['same', 'keep', 'new']);
});

test('importing through the server adds and updates performers, with a backup first', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magfast-import-'));
  const dataDir = path.join(root, 'data');
  const app = createApp({ dataDir, outputDir: path.join(root, 'output') });
  const { port } = await app.listen(0, '127.0.0.1');
  const client = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  t.after(async () => {
    client.close();
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const request = (event, payload) => client.timeout(5000).emitWithAck(event, payload);

  await request('performers:upsert', { name: 'Kirara' });
  const counts = await request('performers:import', {
    performers: [
      { name: 'BlazeBops', pronouns: 'she/her', social: { platform: 'twitch', handle: 'BlazeBops' } },
      { name: 'kirara', pronouns: 'they/them', social: { platform: '', handle: '' } },
      { name: '   ' },
    ],
  });
  assert.deepEqual(counts, { ok: true, added: 1, updated: 1, unchanged: 0 });
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'performers.json'), 'utf8'));
  assert.deepEqual(saved.map((p) => [p.name, p.pronouns]), [['BlazeBops', 'she/her'], ['Kirara', 'they/them']]);
  assert.ok(saved.every((p) => p.id));
  assert.equal(fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.endsWith('performer-import')).length, 1);

  const kept = await request('performers:import', { performers: [{ name: 'Kirara', pronouns: 'she/they' }], updateExisting: false });
  assert.deepEqual(kept, { ok: true, added: 0, updated: 0, unchanged: 1 });
});
