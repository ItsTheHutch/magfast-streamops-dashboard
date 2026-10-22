// Updates the Twitch stream title and category. The channel's account is connected once with
// Twitch's sign-in (OAuth authorization code flow); its tokens are kept in data/twitch.json and
// refreshed when they expire. The client secret and tokens never leave the server.

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { cleanText } from '../public/shared/model.js';
import { readJson, writeJsonAtomic } from './store.js';
import { DEFAULT_TITLE_TEMPLATE, TITLE_MAX, TITLE_PLACEHOLDERS, unknownPlaceholders } from '../public/shared/twitchTitle.js';

export { DEFAULT_TITLE_TEMPLATE, TITLE_MAX, fillTitle } from '../public/shared/twitchTitle.js';

export const TWITCH_AUTH = 'https://id.twitch.tv/oauth2';
export const TWITCH_API = 'https://api.twitch.tv/helix';
const SCOPE = 'channel:manage:broadcast';
class TwitchError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createTwitch({ dataDir, config = {}, port = 3000 }) {
  const file = path.join(dataDir, 'twitch.json');
  const authBase = config.authBase ?? TWITCH_AUTH;
  const apiBase = config.apiBase ?? TWITCH_API;
  const redirectUri = config.redirectUri || `http://localhost:${port}/auth/twitch/callback`;

  let saved = readJson(file, {}) ?? {};
  let channel = null;  // { title, gameId, gameName } as last read from Twitch
  let error = null;    // the last problem, shown on the Dashboard and in Settings
  let reminder = null; // { segment, at }: the Live Segment changed since the title was last updated
  const states = new Map(); // sign-in attempts in progress: state → expiry time

  const clientId = () => saved.clientId || config.clientId || '';
  const clientSecret = () => saved.clientSecret || config.clientSecret || '';
  const persist = () => writeJsonAtomic(file, saved);

  async function call(url, init = {}) {
    let res;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
    } catch (err) {
      throw new TwitchError(err.name === 'TimeoutError' ? 'Twitch didn\'t respond within 15 seconds.' : `Couldn't reach Twitch (${err.cause?.code ?? err.message}).`);
    }
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new TwitchError(body?.message || `Twitch replied with an error (${res.status}).`, res.status);
    return body;
  }

  // Exchanges a code or refresh token for tokens and saves them.
  async function token(params) {
    const body = new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...params });
    const reply = await call(`${authBase}/token`, { method: 'POST', body });
    saved = {
      ...saved,
      accessToken: reply.access_token,
      refreshToken: reply.refresh_token ?? saved.refreshToken,
      expiresAt: Date.now() + (reply.expires_in ?? 3600) * 1000,
      scopes: reply.scope ?? [],
    };
    persist();
  }

  async function refreshTokens() {
    if (!saved.refreshToken) throw new TwitchError('The Twitch account isn\'t connected.', 401);
    try {
      await token({ grant_type: 'refresh_token', refresh_token: saved.refreshToken });
    } catch (err) {
      forgetTokens();
      throw new TwitchError(`The Twitch connection expired (${err.message}). Connect the account again in Settings.`, 401);
    }
  }

  function forgetTokens() {
    saved = { clientId: saved.clientId, clientSecret: saved.clientSecret, titleTemplate: saved.titleTemplate };
    channel = null;
    persist();
  }

  // A Helix API call as the connected account, refreshing the token once if it has expired.
  async function helix(pathAndQuery, init = {}) {
    if (!saved.accessToken) throw new TwitchError('Connect a Twitch account in Settings first.', 401);
    if (Date.now() > (saved.expiresAt ?? 0) - 60_000) await refreshTokens();
    const send = () => call(`${apiBase}${pathAndQuery}`, {
      ...init,
      headers: { 'Client-Id': clientId(), Authorization: `Bearer ${saved.accessToken}`, ...(init.headers ?? {}) },
    });
    try {
      return await send();
    } catch (err) {
      if (err.status !== 401) throw err;
      await refreshTokens();
      return send();
    }
  }

  return {
    redirectUri,

    // What the browser may see: never the client secret or the tokens.
    status() {
      return {
        configured: Boolean(clientId() && clientSecret()),
        clientId: clientId(),
        hasSecret: Boolean(clientSecret()),
        connected: Boolean(saved.accessToken && saved.user),
        user: saved.user ?? null,
        channel,
        error,
        redirectUri,
        titleTemplate: saved.titleTemplate ?? DEFAULT_TITLE_TEMPLATE,
        titleMax: TITLE_MAX,
        reminder,
      };
    },

    // Asks the operator to update Twitch for the new Live Segment, until they do or dismiss it.
    remind(segmentName) {
      reminder = { segment: segmentName, at: Date.now() };
    },

    dismissReminder() {
      reminder = null;
    },

    saveSettings({ clientId: id, clientSecret: secret, titleTemplate }) {
      const unknown = unknownPlaceholders(titleTemplate ?? '');
      if (unknown.length) {
        const known = TITLE_PLACEHOLDERS.map((p) => `{${p}}`).join(', ');
        throw new TwitchError(`The title template has ${unknown.join(', ')}, which ${unknown.length > 1 ? 'aren\'t placeholders' : 'isn\'t a placeholder'}. Use ${known}.`);
      }
      const newId = cleanText(id, 100);
      if (newId !== clientId() && saved.accessToken) forgetTokens();
      saved = {
        ...saved,
        clientId: newId,
        // A blank secret field keeps the saved secret.
        clientSecret: cleanText(secret, 200) || saved.clientSecret || '',
        titleTemplate: cleanText(titleTemplate, 200) || DEFAULT_TITLE_TEMPLATE,
      };
      persist();
    },

    // The Twitch sign-in page to send the operator to.
    authorizeUrl() {
      if (!clientId() || !clientSecret()) throw new TwitchError('Save the Client ID and Client Secret first.');
      const state = randomBytes(16).toString('hex');
      states.set(state, Date.now() + 10 * 60_000);
      const url = new URL(`${authBase}/authorize`);
      url.search = new URLSearchParams({
        client_id: clientId(),
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        state,
        force_verify: 'true',
      });
      return url.href;
    },

    // Twitch sends the operator back here with a code (or an error) after signing in.
    async finishSignIn({ code, state, error: denied, error_description: description }) {
      const expires = states.get(state);
      states.delete(state);
      if (!expires || expires < Date.now()) throw new TwitchError('That sign-in link expired. Try Connect again.');
      if (denied) throw new TwitchError(description || 'Twitch sign-in was cancelled.');
      await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
      const { data: [user] = [] } = await helix('/users');
      if (!user) throw new TwitchError('Twitch didn\'t say which account signed in.');
      saved = { ...saved, user: { id: user.id, login: user.login, displayName: user.display_name } };
      persist();
      error = null;
      return saved.user;
    },

    async disconnect() {
      if (saved.accessToken) {
        const body = new URLSearchParams({ client_id: clientId(), token: saved.accessToken });
        await call(`${authBase}/revoke`, { method: 'POST', body }).catch(() => {});
      }
      forgetTokens();
      error = null;
    },

    // Reads the channel's current title and category from Twitch.
    async refreshChannel() {
      if (!saved.accessToken || !saved.user) return null;
      try {
        const { data: [info] = [] } = await helix(`/channels?broadcaster_id=${encodeURIComponent(saved.user.id)}`);
        channel = { title: info?.title ?? '', gameId: info?.game_id ?? '', gameName: info?.game_name ?? '' };
        error = null;
      } catch (err) {
        error = err.message;
      }
      return channel;
    },

    async updateChannel({ title, gameId }) {
      if (!saved.user) throw new TwitchError('Connect a Twitch account in Settings first.');
      const newTitle = cleanText(title, TITLE_MAX + 1);
      if (!newTitle) throw new TwitchError('The stream title can\'t be empty.');
      if (newTitle.length > TITLE_MAX) throw new TwitchError(`Twitch titles can be up to ${TITLE_MAX} characters.`);
      await helix(`/channels?broadcaster_id=${encodeURIComponent(saved.user.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle, game_id: cleanText(gameId, 40) }),
      });
      reminder = null;
      await this.refreshChannel();
      return channel;
    },

    async searchCategories(query) {
      const q = cleanText(query, 100);
      if (!q) return [];
      const { data = [] } = await helix(`/search/categories?first=8&query=${encodeURIComponent(q)}`);
      return data.map((c) => ({ id: c.id, name: c.name, boxArt: (c.box_art_url ?? '').replace('{width}', '52').replace('{height}', '72') }));
    },

    // For the nuclear reset.
    reset() {
      saved = {};
      channel = null;
      error = null;
      reminder = null;
      fs.rmSync(file, { force: true });
    },
    file,
  };
}
