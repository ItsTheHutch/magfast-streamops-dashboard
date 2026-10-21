import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FUTURE_RUNS,
  MAX_PERFORMERS,
  cleanHandle,
  findPerformer,
  formatEstimate,
  formatHandle,
  formatSocial,
  missingSegmentTypes,
  normalizeLive,
  normalizePerformer,
  promoteNext,
  splitNames,
  titleHandleOf,
} from '../public/shared/model.js';

test('cleanHandle extracts handles from URLs and @-prefixes', () => {
  assert.equal(cleanHandle('twitch', 'https://www.twitch.tv/BlazeBops'), 'BlazeBops');
  assert.equal(cleanHandle('twitch', 'twitch.tv/ItsTheHutch/videos'), 'ItsTheHutch');
  assert.equal(cleanHandle('twitch', '@TheSkipper1995'), 'TheSkipper1995');
  assert.equal(cleanHandle('kick', 'https://kick.com/someone?ref=x'), 'someone');
  assert.equal(cleanHandle('youtube', 'https://youtube.com/@Runner'), 'Runner');
  assert.equal(cleanHandle('youtube', 'https://www.youtube.com/channel/UCabc123/'), 'channel/UCabc123');
  assert.equal(cleanHandle('web', 'https://example.com/me'), 'https://example.com/me');
  assert.equal(cleanHandle('twitch', '   '), '');
});

test('formatSocial and formatHandle produce on-screen text', () => {
  assert.equal(formatSocial({ platform: 'twitch', handle: 'BlazeBops' }), 'twitch.tv/BlazeBops');
  assert.equal(formatSocial({ platform: 'youtube', handle: 'Runner' }), 'youtube.com/@Runner');
  assert.equal(formatSocial({ platform: 'youtube', handle: 'channel/UCabc' }), 'youtube.com/channel/UCabc');
  assert.equal(formatSocial({ platform: 'web', handle: 'https://example.com/' }), 'example.com');
  assert.equal(formatSocial({ platform: 'kick', handle: '' }), '');

  assert.equal(formatHandle({ platform: 'twitch', handle: 'BlazeBops' }), 'BlazeBops');
  assert.equal(formatHandle({ platform: 'youtube', handle: 'Runner' }), '@Runner');
  assert.equal(formatHandle({ platform: 'web', handle: 'https://example.com' }), 'example.com');
});

test('normalizePerformer cleans fields and rejects unknown platforms', () => {
  const p = normalizePerformer({ name: '  Blaze\nBops ', social: { platform: 'myspace', handle: 'twitch.tv/x' } });
  assert.equal(p.name, 'Blaze Bops');
  assert.deepEqual(p.social, { platform: 'twitch', handle: 'x' });
  assert.equal(p.pronouns, '');
  assert.deepEqual(normalizePerformer(null), normalizePerformer({}));
});

test('performer slots stay empty until filled in, Social platform included', () => {
  assert.deepEqual(normalizePerformer({}).social, { platform: '', handle: '' });
  assert.equal(normalizePerformer({ social: { platform: 'twitch', handle: '' } }).social.platform, '');
  assert.equal(normalizePerformer({ name: 'A', social: { platform: 'twitch' } }).social.platform, 'twitch');
  assert.deepEqual(normalizePerformer({ name: 'A', social: { handle: 'https://www.youtube.com/@Runner' } }).social, { platform: 'youtube', handle: 'Runner' });
  assert.deepEqual(normalizePerformer({ name: 'A', social: { handle: '@Blaze' } }).social, { platform: '', handle: 'Blaze' });
});

test('normalizeLive always returns exactly MAX_PERFORMERS performers', () => {
  const live = normalizeLive({ current: { name: 'Mega Man X', performers: [{ name: 'A' }] } });
  assert.equal(live.current.performers.length, MAX_PERFORMERS);
  assert.equal(live.current.performers[0].name, 'A');
  assert.equal(live.current.performers[3].name, '');
  assert.equal(live.next.performers.length, MAX_PERFORMERS);
  assert.equal(live.future.length, FUTURE_RUNS);
  assert.equal(live.future[0].performers, '');

  const tooMany = normalizeLive({ current: { performers: Array.from({ length: 6 }, (_, i) => ({ name: `P${i}` })) } });
  assert.equal(tooMany.current.performers.length, MAX_PERFORMERS);

  assert.deepEqual(normalizeLive('garbage'), normalizeLive({}));
});

test('titleHandleOf uses the social handle unless it looks like a link', () => {
  assert.equal(titleHandleOf(normalizePerformer({ social: { platform: 'twitch', handle: 'BlazeBops' } })), 'BlazeBops');
  assert.equal(titleHandleOf(normalizePerformer({ social: { platform: 'youtube', handle: '@Runner' } })), 'Runner');
  assert.equal(titleHandleOf(normalizePerformer({ social: { platform: 'youtube', handle: 'youtube.com/channel/UCabc' } })), '');
  assert.equal(titleHandleOf(normalizePerformer({ social: { platform: 'web', handle: 'example.com' } })), '');
  assert.equal(titleHandleOf(normalizePerformer({})), '');
});

test('formatEstimate reads H:MM:SS left to right', () => {
  assert.equal(formatEstimate('1:30:00'), '1:30:00');
  assert.equal(formatEstimate('01:30:00'), '1:30:00');
  assert.equal(formatEstimate('12:00:00'), '12:00:00');
  assert.equal(formatEstimate('1:30'), '1:30:00');
  assert.equal(formatEstimate('1:4'), '1:04:00');
  assert.equal(formatEstimate('13000'), '1:30:00');
  assert.equal(formatEstimate('130'), '1:30:00');
  assert.equal(formatEstimate('123456'), '12:34:56');
  assert.equal(formatEstimate('0:90:00'), '1:30:00');
  assert.equal(formatEstimate('0:00:75'), '0:01:15');
  assert.equal(formatEstimate('0:00:00'), '');
  assert.equal(formatEstimate(''), '');
  assert.equal(formatEstimate(null), '');
});

test('normalizeLive formats estimates', () => {
  const live = normalizeLive({ current: { estimate: '0:42' }, next: { estimate: '0:15' }, future: [{ estimate: '1:20:00' }] });
  assert.equal(live.current.estimate, '0:42:00');
  assert.equal(live.next.estimate, '0:15:00');
  assert.equal(live.future[0].estimate, '1:20:00');
});

test('normalizeLive keeps known segment types only', () => {
  const live = normalizeLive({ current: { type: 'core' }, next: { type: 'host' }, future: [{ type: 'party' }] });
  assert.equal(live.current.type, 'core');
  assert.equal(live.next.type, 'host');
  assert.equal(live.future[0].type, '');
});

test('normalizeLive reads future runs saved under the old "upcoming" key', () => {
  const live = normalizeLive({ upcoming: [{ name: 'Super Metroid', performers: 'MegaMarty' }] });
  assert.equal(live.future[0].name, 'Super Metroid');
  assert.equal(live.future[1].name, '');
});

test('missingSegmentTypes lists segments and future runs with content but no type', () => {
  assert.deepEqual(missingSegmentTypes(normalizeLive({})), []);
  const live = normalizeLive({
    current: { name: 'Mega Man X' },
    next: { type: 'host', name: 'Break' },
    future: [{ type: 'core', name: 'A' }, { name: 'B' }],
  });
  assert.deepEqual(missingSegmentTypes(live), ['Live Segment', 'Future run 2']);
});

test('promoteNext moves Next Segment live and pulls up the first future run', () => {
  const directory = [{ id: '1', name: 'BlazeBops', pronouns: 'she/her', social: { platform: 'twitch', handle: 'BlazeBops' } }];
  const live = normalizeLive({
    current: { type: 'core', name: 'Mega Man X' },
    next: { type: 'host', name: 'Host chat', performers: [{ name: 'Valair' }] },
    future: [
      { type: 'core', name: 'Super Metroid', estimate: '1:20:00', performers: 'blazebops vs NewGuy' },
      { type: 'core', name: 'Celeste' },
    ],
  });
  const promoted = promoteNext(live, directory);
  assert.equal(promoted.current.name, 'Host chat');
  assert.equal(promoted.current.type, 'host');
  assert.equal(promoted.current.performers[0].name, 'Valair');
  assert.equal(promoted.next.name, 'Super Metroid');
  assert.equal(promoted.next.type, 'core');
  assert.equal(promoted.next.estimate, '1:20:00');
  assert.deepEqual(promoted.next.performers[0], { name: 'BlazeBops', pronouns: 'she/her', social: { platform: 'twitch', handle: 'BlazeBops' } });
  assert.equal(promoted.next.performers[1].name, 'NewGuy');
  assert.equal(promoted.future[0].name, 'Celeste');
  assert.equal(promoted.future[FUTURE_RUNS - 1].name, '');
});

test('splitNames splits common separators', () => {
  assert.deepEqual(splitNames('RunnerA vs RunnerB'), ['RunnerA', 'RunnerB']);
  assert.deepEqual(splitNames('A vs. B'), ['A', 'B']);
  assert.deepEqual(splitNames('A, B & C'), ['A', 'B', 'C']);
  assert.deepEqual(splitNames('Vsauce vs Andromeda'), ['Vsauce', 'Andromeda']);
  assert.deepEqual(splitNames('A + B, C, D, E'), ['A', 'B', 'C', 'D']);
  assert.deepEqual(splitNames(''), []);
});

test('findPerformer matches names case-insensitively', () => {
  const directory = [{ id: '1', name: 'BlazeBops' }];
  assert.equal(findPerformer(directory, ' blazebops ')?.id, '1');
  assert.equal(findPerformer(directory, 'Blaze'), undefined);
  assert.equal(findPerformer(directory, ''), undefined);
});
