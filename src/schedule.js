// Imports the run order from a Horaro schedule (horaro.net), keeps it up to date, and fills
// Edit Segment's Next Segment and Future runs from it.

import {
  FUTURE_RUNS,
  cleanText,
  emptyFutureRun,
  emptyScheduleLink,
  formatEstimate,
  normalizeLive,
  playableAfter,
  rowFromItem,
  scheduleKey,
  segmentFromRow,
} from '../public/shared/model.js';

export const HORARO_BASE = 'https://horaro.net';

/* ---------- Settings ---------- */

// Defaults come from config.horaro; the Settings tab overrides them.
export function scheduleDefaults(horaro = {}) {
  const columns = horaro.columns ?? {};
  return {
    url: horaro.event && horaro.schedule ? `${HORARO_BASE}/${horaro.event}/${horaro.schedule}` : '',
    hiddenKey: horaro.hiddenKey ?? '',
    columns: {
      name: columns.name ?? 'What',
      category: columns.category ?? 'Category',
      performers: columns.performers ?? 'Who',
      type: columns.type ?? columns.category ?? 'Category',
    },
    hostKeyword: 'Interstitial',
    stripPrefixes: true,
    intervalMinutes: 5,
  };
}

export function normalizeScheduleSettings(raw, defaults) {
  const r = raw !== null && typeof raw === 'object' ? raw : {};
  const columns = r.columns !== null && typeof r.columns === 'object' ? r.columns : {};
  const text = (value, fallback, max = 200) => (typeof value === 'string' ? cleanText(value, max) : fallback);
  const minutes = Number(r.intervalMinutes);
  return {
    url: text(r.url, defaults.url, 500),
    hiddenKey: text(r.hiddenKey, defaults.hiddenKey),
    columns: {
      name: text(columns.name, defaults.columns.name) || defaults.columns.name,
      category: text(columns.category, defaults.columns.category),
      performers: text(columns.performers, defaults.columns.performers),
      type: text(columns.type, defaults.columns.type),
    },
    hostKeyword: text(r.hostKeyword, defaults.hostKeyword, 60),
    stripPrefixes: typeof r.stripPrefixes === 'boolean' ? r.stripPrefixes : defaults.stripPrefixes,
    intervalMinutes: Number.isFinite(minutes) ? Math.min(60, Math.max(1, Math.round(minutes))) : defaults.intervalMinutes,
  };
}

// "https://horaro.net/magfast/2027", "horaro.net/magfast/2027" or "magfast/2027".
export function parseScheduleUrl(url) {
  const path = cleanText(url, 500).replace(/^https?:\/\//i, '').replace(/^(www\.)?horaro\.net\/?/i, '');
  const [event, schedule] = path.split(/[/?#]/).filter(Boolean);
  if (!event || !schedule || event === '-') {
    throw new Error('Enter the schedule\'s address, like https://horaro.net/magfast/2027.');
  }
  return { event, schedule };
}

/* ---------- Fetching ---------- */

// Fetches a schedule from Horaro's API. The event/schedule address redirects to the schedule's
// own address, which drops the hidden-column key, so the key is added again after the redirect.
export async function fetchHoraro(settings, base = HORARO_BASE) {
  const { event, schedule } = parseScheduleUrl(settings.url);
  const headers = { Accept: 'application/json', 'User-Agent': 'magFAST-StreamOps (schedule sync)' };
  const get = (url) => fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const withKey = (url) => {
    const u = new URL(url, base);
    if (settings.hiddenKey) u.searchParams.set('hiddenkey', settings.hiddenKey);
    return u.href;
  };

  let res;
  try {
    res = await get(withKey(`${base}/-/api/v1/events/${encodeURIComponent(event)}/schedules/${encodeURIComponent(schedule)}`));
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      res = await get(withKey(res.headers.get('location')));
    }
  } catch (err) {
    throw new Error(err.name === 'TimeoutError' ? 'Horaro didn\'t respond within 15 seconds.' : `Couldn't reach Horaro (${err.cause?.code ?? err.message}).`);
  }
  if (res.status === 404) throw new Error(`Horaro has no schedule at ${event}/${schedule}. Check the address in Settings.`);
  if (!res.ok) throw new Error(`Horaro replied with an error (${res.status}).`);
  const body = await res.json().catch(() => null);
  if (!body?.data || !Array.isArray(body.data.items)) throw new Error('Horaro sent something that isn\'t a schedule.');
  return body.data;
}

/* ---------- Converting Horaro items ---------- */

// Horaro cells are Markdown; keep just the text.
export function cellText(value) {
  if (typeof value !== 'string') return '';
  return cleanText(value
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]{1,3}([^*_`]+)[*_`]{1,3}/g, '$1'), 300);
}

const CANCELLED = /\[\s*cancel+ed\s*\]/i;

// Turns Horaro's items into schedule items, plus warnings about columns that weren't found.
export function itemsFromHoraro(data, settings) {
  const columns = (data.columns ?? []).map((c) => String(c));
  const warnings = [];
  const column = (label, wanted) => {
    if (!wanted) return -1;
    const index = columns.findIndex((c) => c.trim().toLowerCase() === wanted.trim().toLowerCase());
    if (index === -1) warnings.push(`No "${wanted}" column for ${label}. The schedule has: ${columns.join(', ') || 'no columns'}.`);
    return index;
  };
  const at = {
    name: column('segment names', settings.columns.name),
    category: column('categories', settings.columns.category),
    performers: column('performers', settings.columns.performers),
    type: column('segment types', settings.columns.type),
  };
  const keyword = settings.hostKeyword.toLowerCase();
  const prefix = new RegExp(`^(speedrun${keyword ? `|${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` : ''})\\s*(-\\s*|$)`, 'i');

  const items = data.items.map((item, index) => {
    const cell = (i) => (i >= 0 ? cellText(item.data?.[i]) : '');
    const name = cell(at.name);
    const typeText = cell(at.type).toLowerCase();
    const category = cell(at.category);
    return {
      index,
      type: keyword && typeText.includes(keyword) ? 'host' : 'core',
      name,
      category: settings.stripPrefixes ? category.replace(prefix, '') : category,
      estimate: item.length_t > 0 ? formatEstimate(secondsToEstimate(item.length_t)) : '',
      performers: cell(at.performers),
      scheduled: Number.isFinite(item.scheduled_t) ? item.scheduled_t * 1000 : null,
      cancelled: CANCELLED.test(name),
    };
  });
  return { items, columns, warnings };
}

function secondsToEstimate(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------- Filling Edit Segment ---------- */

// Puts item `index` in Next Segment and the runs after it in Future runs, and starts following.
export function loadIntoLive(live, items, index, directory) {
  if (!items[index]) throw new Error('That run isn\'t in the schedule.');
  const nextRow = rowFromItem(items[index]);
  const next = segmentFromRow(nextRow, directory);
  const futureIndexes = playableAfter(items, index, FUTURE_RUNS);
  const future = Array.from({ length: FUTURE_RUNS }, (_, i) => (futureIndexes[i] !== undefined ? rowFromItem(items[futureIndexes[i]]) : emptyFutureRun()));
  return normalizeLive({
    ...live,
    next,
    future,
    schedule: {
      nextIndex: index,
      nextKey: scheduleKey(items[index]),
      imported: { next, future: future.map((row, i) => (futureIndexes[i] !== undefined ? row : null)) },
    },
  });
}

// After a refresh: finds Next Segment's run again (runs may have been added or removed before it),
// then updates Next Segment and each Future runs row that wasn't edited by hand. Returns the new
// live state, or null if nothing changed.
export function syncLive(live, items, directory) {
  const link = live.schedule;
  if (link.nextIndex === null) return null;

  const matches = items.flatMap((item, i) => (scheduleKey(item) === link.nextKey ? [i] : []));
  const index = matches.length
    ? matches.reduce((best, i) => (Math.abs(i - link.nextIndex) < Math.abs(best - link.nextIndex) ? i : best))
    : Math.min(link.nextIndex, items.length - 1);
  if (index < 0) return null;

  const fresh = loadIntoLive(live, items, index, directory);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const untouchedNext = link.imported.next && same(live.next, link.imported.next);
  const next = untouchedNext ? fresh.next : live.next;
  const future = live.future.map((row, i) => {
    const imported = link.imported.future[i];
    const untouched = imported ? same(row, imported) : row.name === '' && row.performers === '';
    return untouched ? fresh.future[i] : row;
  });
  const updated = normalizeLive({ ...live, next, future, schedule: fresh.schedule });
  return same(updated, live) ? null : updated;
}

export function unlink(live) {
  return normalizeLive({ ...live, schedule: emptyScheduleLink() });
}

/* ---------- Keeping it up to date ---------- */

// Fetches on start and every intervalMinutes. onResult gets each successful import.
export function createScheduleSync({ getSettings, onResult, onError, base = HORARO_BASE }) {
  let timer = null;
  let running = null;
  let nextCheckAt = null;

  async function refresh() {
    if (running) return running;
    running = (async () => {
      const settings = getSettings();
      if (!settings.url) throw new Error('No Horaro schedule is set. Add one in Settings.');
      const data = await fetchHoraro(settings, base);
      const { items, columns, warnings } = itemsFromHoraro(data, settings);
      return onResult({
        name: cleanText(data.name, 200),
        link: typeof data.link === 'string' ? data.link : '',
        horaroUpdated: Date.parse(data.updated) || null,
        columns,
        items,
        warnings,
      });
    })();
    try {
      return await running;
    } catch (err) {
      onError(err);
      throw err;
    } finally {
      running = null;
    }
  }

  function schedule() {
    clearInterval(timer);
    const { url, intervalMinutes } = getSettings();
    if (!url) {
      nextCheckAt = null;
      return;
    }
    const every = intervalMinutes * 60_000;
    nextCheckAt = Date.now() + every;
    timer = setInterval(() => {
      nextCheckAt = Date.now() + every;
      refresh().catch(() => {});
    }, every);
    timer.unref?.();
  }

  return {
    refresh,
    // Starts (or restarts) the regular checks and checks straight away.
    start() {
      schedule();
      return refresh().catch(() => {});
    },
    stop() {
      clearInterval(timer);
    },
    nextCheckAt: () => nextCheckAt,
  };
}
