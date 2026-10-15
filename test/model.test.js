import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PERFORMERS,
  cleanHandle,
  findPerformer,
  formatHandle,
  formatSocial,
  normalizeLive,
  normalizePerformer,
  twitchHandleOf,
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

test('normalizeLive always returns exactly MAX_PERFORMERS performers', () => {
  const live = normalizeLive({ current: { name: 'Mega Man X', performers: [{ name: 'A' }] } });
  assert.equal(live.current.performers.length, MAX_PERFORMERS);
  assert.equal(live.current.performers[0].name, 'A');
  assert.equal(live.current.performers[3].name, '');
  assert.equal(live.next.performers, '');

  const tooMany = normalizeLive({ current: { performers: Array.from({ length: 6 }, (_, i) => ({ name: `P${i}` })) } });
  assert.equal(tooMany.current.performers.length, MAX_PERFORMERS);

  assert.deepEqual(normalizeLive('garbage'), normalizeLive({}));
});

test('twitchHandleOf prefers the explicit Twitch handle, then a Twitch social', () => {
  assert.equal(twitchHandleOf(normalizePerformer({ twitch: 'tw', social: { platform: 'youtube', handle: 'yt' } })), 'tw');
  assert.equal(twitchHandleOf(normalizePerformer({ social: { platform: 'twitch', handle: 'soc' } })), 'soc');
  assert.equal(twitchHandleOf(normalizePerformer({ social: { platform: 'youtube', handle: 'yt' } })), '');
});

test('findPerformer matches names case-insensitively', () => {
  const directory = [{ id: '1', name: 'BlazeBops' }];
  assert.equal(findPerformer(directory, ' blazebops ')?.id, '1');
  assert.equal(findPerformer(directory, 'Blaze'), undefined);
  assert.equal(findPerformer(directory, ''), undefined);
});
