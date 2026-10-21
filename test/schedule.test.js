import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeLive, promoteNext } from '../public/shared/model.js';
import {
  cellText,
  itemsFromHoraro,
  loadIntoLive,
  normalizeScheduleSettings,
  parseScheduleUrl,
  scheduleDefaults,
  syncLive,
} from '../src/schedule.js';

// A few runs from the real magFAST 2026 schedule, including a cancelled one and a race.
const horaro = JSON.parse(fs.readFileSync(new URL('./fixtures/horaro-magfast-2026.json', import.meta.url), 'utf8')).data;
const settings = normalizeScheduleSettings({}, scheduleDefaults({ event: 'magfast', schedule: '2026' }));
const { items } = itemsFromHoraro(horaro, settings);
const directory = [{ id: '1', name: 'BlazeBops', pronouns: 'she/her', social: { platform: 'twitch', handle: 'BlazeBops' } }];

test('parseScheduleUrl accepts full and short addresses', () => {
  assert.deepEqual(parseScheduleUrl('https://horaro.net/magfast/2027'), { event: 'magfast', schedule: '2027' });
  assert.deepEqual(parseScheduleUrl('horaro.net/magfast/2027?x=1'), { event: 'magfast', schedule: '2027' });
  assert.deepEqual(parseScheduleUrl('magfast/2027'), { event: 'magfast', schedule: '2027' });
  assert.throws(() => parseScheduleUrl('https://horaro.net/magfast'), /like https:\/\/horaro\.net/);
});

test('cellText keeps the text of Markdown links and emphasis', () => {
  assert.equal(cellText('[BlazeBops](https://twitch.tv/BlazeBops) vs **AllGood**'), 'BlazeBops vs AllGood');
  assert.equal(cellText(null), '');
});

test('Horaro items become runs with types, clean categories and estimates', () => {
  assert.deepEqual(
    { ...items[1], scheduled: undefined },
    { index: 1, type: 'core', name: 'Mega Man X', category: 'Lemons%', estimate: '1:30:00', performers: 'BlazeBops', scheduled: undefined, cancelled: false },
  );
  assert.equal(items[2].type, 'host');
  assert.equal(items[2].category, '');
  assert.equal(items[4].category, 'Interview');
  assert.equal(items[0].type, 'core');
  assert.equal(items[0].category, 'Behold! The Lemons.');
  assert.equal(items[6].cancelled, true);
  assert.equal(typeof items[1].scheduled, 'number');
});

test('missing columns are reported', () => {
  const custom = normalizeScheduleSettings({ columns: { performers: 'Runners' } }, scheduleDefaults({}));
  const { warnings } = itemsFromHoraro(horaro, custom);
  assert.match(warnings[0], /No "Runners" column for performers/);
});

test('Load as Next fills Next Segment and four Future runs, skipping cancelled runs', () => {
  const live = loadIntoLive(normalizeLive({ current: { type: 'core', name: 'Pre-show' } }), items, 5, directory);
  assert.equal(live.current.name, 'Pre-show');
  assert.equal(live.next.name, 'Mega Man X Weakness Quiz');
  assert.equal(live.next.type, 'host');
  assert.deepEqual(live.next.performers.slice(0, 2).map((p) => p.name), ['Xerobladedge', 'TheSkipper1995']);
  assert.deepEqual(live.future.map((r) => r.name), ['Super Mario 64 (DX Mod)', 'World Mario Super', 'Untitled Goose Game', 'Mega Man X (2 Players 1 Controller)']);
  assert.equal(live.schedule.nextIndex, 5);
});

test('moving to Live pulls the next run from the schedule into the last row', () => {
  const loaded = loadIntoLive(normalizeLive({}), items, 0, directory);
  const promoted = promoteNext(loaded, directory, items);
  assert.equal(promoted.current.name, 'MEGA Pre Show X');
  assert.equal(promoted.next.name, 'Mega Man X');
  assert.equal(promoted.next.performers[0].pronouns, 'she/her');
  assert.deepEqual(promoted.future.map((r) => r.name), ['Potpourri Versus!', 'Mega Man X2', 'Xbox Prototype Interview', 'Mega Man X Weakness Quiz']);
  assert.equal(promoted.schedule.nextIndex, 1);
  // Still in step: a refresh with the same schedule changes nothing.
  assert.equal(syncLive(promoted, items, directory), null);
});

test('a refresh updates untouched rows, keeps hand-edited ones, and follows runs that moved', () => {
  let live = loadIntoLive(normalizeLive({}), items, 1, directory);
  live = normalizeLive({ ...live, future: live.future.map((r, i) => (i === 1 ? { ...r, category: 'Edited by hand' } : r)) });

  // On Horaro: a run is added at the top, and the estimate of the first future run changes.
  const changed = structuredClone(horaro);
  changed.items.unshift({ ...changed.items[0], data: ['Opening ceremony', 'Interstitial', 'Staff'] });
  changed.items[3].length_t = 1200;
  const updated = itemsFromHoraro(changed, settings).items;

  const synced = syncLive(live, updated, directory);
  assert.equal(synced.schedule.nextIndex, 2);
  assert.equal(synced.next.name, 'Mega Man X');
  assert.equal(synced.future[0].estimate, '0:20:00');
  assert.equal(synced.future[1].category, 'Edited by hand');
});
