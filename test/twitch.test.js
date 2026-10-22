import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { DEFAULT_TITLE_TEMPLATE, fillTitle } from '../src/twitch.js';
import { unknownPlaceholders } from '../public/shared/twitchTitle.js';

const segment = (fields) => ({ name: '', category: '', estimate: '', performers: [], ...fields });

test('fillTitle fills the template and drops empty parts', () => {
  assert.equal(fillTitle(DEFAULT_TITLE_TEMPLATE, segment({ name: 'Mega Man X', category: 'Any%', performers: [{ name: 'BlazeBops' }] })), 'magFAST: Mega Man X (Any%) by BlazeBops');
  assert.equal(fillTitle(DEFAULT_TITLE_TEMPLATE, segment({ name: 'Race', category: 'Any%', performers: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] })), 'magFAST: Race (Any%) by A, B & C');
  assert.equal(fillTitle(DEFAULT_TITLE_TEMPLATE, segment({ name: 'Host chat' })), 'magFAST: Host chat');
  assert.equal(fillTitle('Lobby {name} by {performers}', segment({ name: 'Z' })), 'Lobby Z');
  assert.equal(fillTitle('{name}', segment({ name: 'x'.repeat(200) })).length, 140);
});

test('performers are tagged with @ and their social handle, or named when they have none', () => {
  const performers = [
    { name: 'BlazeBops', social: { platform: 'twitch', handle: 'BlazeBops' } },
    { name: 'Kirara', social: { platform: 'youtube', handle: 'kirara_runs' } },
    { name: 'Site Owner', social: { platform: 'web', handle: 'example.com' } },
    { name: 'NoSocial', social: { platform: '', handle: '' } },
  ];
  assert.equal(fillTitle('{name} by {performers}', segment({ name: 'Race', performers })), 'Race by @BlazeBops, @kirara_runs, Site Owner & NoSocial');
  // {@performers} reads naturally too, and placeholders ignore case.
  assert.equal(fillTitle('{name} by {@performers}', segment({ name: 'Race', performers })), 'Race by @BlazeBops, @kirara_runs, Site Owner & NoSocial');
  assert.equal(fillTitle('{Name} | {@Performers}', segment({ name: 'Race', performers: performers.slice(0, 1) })), 'Race | @BlazeBops');
  assert.equal(fillTitle('magFAST: {name} by {@performers}', segment({ name: 'Host chat' })), 'magFAST: Host chat');
});

test('unknownPlaceholders finds placeholders the template can\'t fill', () => {
  assert.deepEqual(unknownPlaceholders('{name} by {@performers} ({category}) {estimate}'), []);
  assert.deepEqual(unknownPlaceholders('{name} by {runners} {game}'), ['{runners}', '{game}']);
});

// A stand-in for Twitch's sign-in (id.twitch.tv) and Helix API.
async function fakeTwitch(t) {
  const state = { title: 'Old title', gameId: '1', gameName: 'Old Game', patches: [], revoked: [], expireFirstToken: false };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    for await (const chunk of req) body += chunk;
    const send = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(data ? JSON.stringify(data) : undefined);
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (url.pathname === '/oauth2/token') {
      const form = new URLSearchParams(body);
      if (form.get('client_secret') !== 'shh') return send(400, { message: 'invalid client secret' });
      if (form.get('grant_type') === 'authorization_code' && form.get('code') === 'good') return send(200, { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600, scope: ['channel:manage:broadcast'] });
      if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'rt1') return send(200, { access_token: 'at2', refresh_token: 'rt2', expires_in: 3600 });
      return send(400, { message: 'invalid grant' });
    }
    if (url.pathname === '/oauth2/revoke') {
      state.revoked.push(new URLSearchParams(body).get('token'));
      return send(200);
    }
    if (!token?.startsWith('at') || (token === 'at1' && state.expireFirstToken)) return send(401, { message: 'Invalid OAuth token' });
    if (req.headers['client-id'] !== 'cid') return send(401, { message: 'bad client id' });
    if (url.pathname === '/helix/users') return send(200, { data: [{ id: '123', login: 'magfast', display_name: 'magFAST' }] });
    if (url.pathname === '/helix/channels' && req.method === 'GET') return send(200, { data: [{ broadcaster_id: '123', title: state.title, game_id: state.gameId, game_name: state.gameName }] });
    if (url.pathname === '/helix/channels' && req.method === 'PATCH') {
      const patch = JSON.parse(body);
      state.patches.push({ broadcaster: url.searchParams.get('broadcaster_id'), token, ...patch });
      state.title = patch.title;
      state.gameId = patch.game_id;
      state.gameName = patch.game_id === '509658' ? 'Just Chatting' : 'Some Game';
      return send(204);
    }
    if (url.pathname === '/helix/search/categories') {
      return send(200, { data: [{ id: '509658', name: 'Just Chatting', box_art_url: 'https://img/jc-{width}x{height}.jpg' }] });
    }
    return send(404, { message: 'not found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { state, base: `http://127.0.0.1:${server.address().port}` };
}

test('connecting a Twitch account and updating the title and category', async (t) => {
  const twitch = await fakeTwitch(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magfast-twitch-'));
  const config = {
    dataDir: path.join(root, 'data'),
    outputDir: path.join(root, 'output'),
    twitch: { authBase: `${twitch.base}/oauth2`, apiBase: `${twitch.base}/helix` },
  };
  const app = createApp(config);
  const { port } = await app.listen(0, '127.0.0.1');
  const client = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  t.after(async () => {
    client.close();
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const statuses = [];
  client.on('twitch', (s) => statuses.push(s));
  const request = (event, payload) => client.timeout(5000).emitWithAck(event, payload);
  const until = async (check) => {
    for (let i = 0; i < 50 && !check(statuses.at(-1)); i++) await new Promise((r) => setTimeout(r, 20));
    return statuses.at(-1);
  };
  const local = `http://127.0.0.1:${port}`;

  assert.equal((await until(Boolean)).configured, false);
  assert.equal((await request('twitch:settings', { clientId: 'cid', clientSecret: 'shh' })).ok, true);
  let status = await until((s) => s?.configured);
  assert.equal(status.hasSecret, true);
  assert.equal(status.redirectUri, 'http://localhost:3000/auth/twitch/callback');

  // Sign in: Settings' link goes to Twitch, which sends the browser back with a code.
  const start = await fetch(`${local}/auth/twitch/start`, { redirect: 'manual' });
  const authorize = new URL(start.headers.get('location'));
  assert.equal(authorize.origin + authorize.pathname, `${twitch.base}/oauth2/authorize`);
  assert.equal(authorize.searchParams.get('client_id'), 'cid');
  assert.equal(authorize.searchParams.get('scope'), 'channel:manage:broadcast');

  const forged = await fetch(`${local}/auth/twitch/callback?code=good&state=not-ours`, { redirect: 'manual' });
  assert.match(decodeURIComponent(forged.headers.get('location')), /error:That sign-in link expired/);

  const back = await fetch(`${local}/auth/twitch/callback?code=good&state=${authorize.searchParams.get('state')}`, { redirect: 'manual' });
  assert.equal(back.headers.get('location'), '/?twitch=connected#settings');
  status = await until((s) => s?.connected && s.channel);
  assert.deepEqual(status.user, { id: '123', login: 'magfast', displayName: 'magFAST' });
  assert.deepEqual(status.channel, { title: 'Old title', gameId: '1', gameName: 'Old Game' });

  // The secret and tokens stay on the server.
  assert.doesNotMatch(JSON.stringify(statuses), /shh|at1|rt1/);
  assert.match(fs.readFileSync(path.join(config.dataDir, 'twitch.json'), 'utf8'), /"refreshToken": "rt1"/);

  const reply = await request('twitch:update', { title: 'magFAST: Mega Man X', gameId: '509658' });
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.channel, { title: 'magFAST: Mega Man X', gameId: '509658', gameName: 'Just Chatting' });
  assert.deepEqual(twitch.state.patches[0], { broadcaster: '123', token: 'at1', title: 'magFAST: Mega Man X', game_id: '509658' });

  // An expired token is refreshed and the update retried.
  twitch.state.expireFirstToken = true;
  assert.equal((await request('twitch:update', { title: 'Second', gameId: '509658' })).ok, true);
  assert.equal(twitch.state.patches[1].token, 'at2');

  assert.equal((await request('twitch:update', { title: '   ', gameId: '1' })).ok, false);
  assert.equal((await request('twitch:update', { title: 'x'.repeat(141), gameId: '1' })).ok, false);

  const search = await request('twitch:search', { query: 'just' });
  assert.deepEqual(search.categories, [{ id: '509658', name: 'Just Chatting', boxArt: 'https://img/jc-52x72.jpg' }]);

  assert.equal((await request('twitch:disconnect')).ok, true);
  status = await until((s) => s && !s.connected);
  assert.equal(status.configured, true, 'the app credentials are kept');
  assert.deepEqual(twitch.state.revoked, ['at2']);
});

test('changing the Live Segment raises a reminder to update Twitch, until dismissed', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magfast-remind-'));
  const app = createApp({ dataDir: path.join(root, 'data'), outputDir: path.join(root, 'output') });
  const { port } = await app.listen(0, '127.0.0.1');
  const client = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  t.after(async () => {
    client.close();
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  let status = null;
  client.on('twitch', (s) => { status = s; });
  const request = (event, payload) => client.timeout(5000).emitWithAck(event, payload);
  const live = (performer) => ({ current: { type: 'core', name: 'Mega Man X', performers: [performer] } });
  while (!status) await new Promise((r) => setTimeout(r, 10));
  assert.equal(status.reminder, null);

  await request('live:save', live({ name: 'BlazeBops', pronouns: 'she/her' }));
  assert.equal(status.reminder?.segment, 'Mega Man X');
  const first = status.reminder.at;

  await request('twitch:dismiss');
  assert.equal(status.reminder, null);

  // Pronouns aren't part of a title, so changing them doesn't ask again.
  await request('live:save', live({ name: 'BlazeBops', pronouns: 'they/them' }));
  assert.equal(status.reminder, null);

  // A new social handle is.
  await request('live:save', live({ name: 'BlazeBops', pronouns: 'they/them', social: { platform: 'twitch', handle: 'BlazeBops' } }));
  assert.ok(status.reminder.at >= first);
});
