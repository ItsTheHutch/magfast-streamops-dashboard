// Data model shared by the server and the browser: shapes, cleanup and display formatting.

export const MAX_PERFORMERS = 4;
export const FUTURE_RUNS = 4;

// Every segment is one of these. Core Content is a run; Host/Interstitial is everything between runs.
export const SEGMENT_TYPES = [
  { id: 'core', label: 'Core Content' },
  { id: 'host', label: 'Host/Interstitial' },
];
const SEGMENT_TYPE_IDS = new Set(SEGMENT_TYPES.map((t) => t.id));

export const SOCIAL_PLATFORMS = [
  { id: 'twitch', label: 'Twitch' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'kick', label: 'Kick' },
  { id: 'web', label: 'Website' },
];

const PLATFORM_IDS = new Set(SOCIAL_PLATFORMS.map((p) => p.id));

const PLATFORM_DOMAINS = {
  twitch: /^(?:m\.)?twitch\.tv\//i,
  youtube: /^(?:m\.)?youtube\.com\//i,
  kick: /^kick\.com\//i,
};

function asObject(value) {
  return value !== null && typeof value === 'object' ? value : {};
}

// Single-line, trimmed, length-limited text. Anything that isn't a string becomes ''.
export function cleanText(value, maxLength = 200) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

// The platform a pasted profile URL belongs to, or '' when it isn't one we know.
export function detectPlatform(value) {
  const text = cleanText(value, 300).replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return Object.keys(PLATFORM_DOMAINS).find((id) => PLATFORM_DOMAINS[id].test(text)) ?? '';
}

// Accepts a bare handle, "@handle" or a full profile URL and returns the handle.
// YouTube legacy paths (channel/…, c/…, user/…) are kept whole; website URLs are kept as-is.
// With no platform chosen, the handle is kept as typed, minus a leading "@".
export function cleanHandle(platform, value) {
  let handle = cleanText(value, 300);
  if (!handle || platform === 'web') return handle;
  if (!platform) return handle.replace(/^@+/, '');

  handle = handle.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  if (PLATFORM_DOMAINS[platform]) handle = handle.replace(PLATFORM_DOMAINS[platform], '');

  if (platform === 'youtube' && /^(?:channel|c|user)\//i.test(handle)) {
    return handle.split(/[?#]/)[0].replace(/\/+$/, '');
  }
  return handle.split(/[/?#]/)[0].replace(/^@+/, '');
}

export function sameName(a, b) {
  return cleanText(a).toLowerCase() === cleanText(b).toLowerCase();
}

// Performer slots start empty, Social platform included: a segment can have one to four performers.
export function emptyPerformer() {
  return { name: '', pronouns: '', social: { platform: '', handle: '' } };
}

export function normalizePerformer(raw) {
  const p = asObject(raw);
  const social = asObject(p.social);
  const name = cleanText(p.name, 100);
  let platform = PLATFORM_IDS.has(social.platform) ? social.platform : detectPlatform(social.handle);
  // A slot with no name and no handle is empty, even if a platform was left selected.
  if (!name && !cleanText(social.handle)) platform = '';
  return {
    name,
    pronouns: cleanText(p.pronouns, 40),
    social: { platform, handle: cleanHandle(platform, social.handle) },
  };
}

// The handle used to tag a performer in the stream title: their social handle, whatever the
// platform, unless it looks like a link (a website, or a YouTube channel path).
export function titleHandleOf(performer) {
  const handle = performer?.social?.handle ?? '';
  return /[./]/.test(handle) ? '' : handle;
}

// Estimates are always H:MM:SS, read left to right. With colons the parts are hours, minutes and
// seconds ("1:30" is 1:30:00); bare digits fill H, MM, SS in order ("130" is 1:30:00).
// Minutes or seconds over 59 carry over: "0:90:00" becomes 1:30:00.
export function formatEstimate(value) {
  if (typeof value !== 'string') return '';
  let parts;
  if (value.includes(':')) {
    parts = value.split(':').slice(0, 3).map((part) => part.replace(/\D/g, ''));
  } else {
    const digits = value.replace(/\D/g, '');
    const padded = digits.length > 5 ? digits : digits.padEnd(5, '0');
    parts = [padded.slice(0, -4), padded.slice(-4, -2), padded.slice(-2)];
  }
  const [h = 0, m = 0, s = 0] = parts.map(Number);
  const seconds = h * 3600 + m * 60 + s;
  if (!seconds) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

// A segment on the Run tab: Live Segment (state key "current") or Next Segment ("next").
export function emptySegment() {
  return {
    type: '',
    name: '',
    category: '',
    estimate: '',
    performers: Array.from({ length: MAX_PERFORMERS }, emptyPerformer),
  };
}

// A row in Future runs: performers are one line of text, e.g. "RunnerA vs RunnerB".
export function emptyFutureRun() {
  return { type: '', name: '', category: '', estimate: '', performers: '' };
}

export function emptyLive() {
  return {
    current: emptySegment(),
    next: emptySegment(),
    future: Array.from({ length: FUTURE_RUNS }, emptyFutureRun),
  };
}

const cleanType = (value) => (SEGMENT_TYPE_IDS.has(value) ? value : '');

function normalizeSegment(raw) {
  const seg = asObject(raw);
  const performers = Array.isArray(seg.performers) ? seg.performers : [];
  return {
    type: cleanType(seg.type),
    name: cleanText(seg.name),
    category: cleanText(seg.category),
    estimate: formatEstimate(seg.estimate),
    performers: Array.from({ length: MAX_PERFORMERS }, (_, i) => normalizePerformer(performers[i])),
  };
}

function normalizeFutureRun(raw) {
  const run = asObject(raw);
  return {
    type: cleanType(run.type),
    name: cleanText(run.name),
    category: cleanText(run.category),
    estimate: formatEstimate(run.estimate),
    performers: cleanText(run.performers, 300),
  };
}

/*
  The link between Edit Segment and the imported Horaro schedule. nextIndex is the schedule item in
  Next Segment (null when Edit Segment isn't following the schedule) and nextKey identifies it, so it
  can be found again if runs are added or removed before it. imported holds what the schedule last
  put in Next Segment and each Future runs row: a row that still matches was not edited by hand, so
  a schedule refresh may update it.
*/
export function emptyScheduleLink() {
  return { nextIndex: null, nextKey: '', imported: { next: null, future: Array.from({ length: FUTURE_RUNS }, () => null) } };
}

function normalizeScheduleLink(raw) {
  const link = asObject(raw);
  const imported = asObject(link.imported);
  const future = Array.isArray(imported.future) ? imported.future : [];
  const nextIndex = Number.isInteger(link.nextIndex) && link.nextIndex >= 0 ? link.nextIndex : null;
  if (nextIndex === null) return emptyScheduleLink();
  return {
    nextIndex,
    nextKey: cleanText(link.nextKey, 700),
    imported: {
      next: imported.next ? normalizeSegment(imported.next) : null,
      future: Array.from({ length: FUTURE_RUNS }, (_, i) => (future[i] ? normalizeFutureRun(future[i]) : null)),
    },
  };
}

export function normalizeLive(raw) {
  const r = asObject(raw);
  // Saved state from before Next Segment existed kept its future runs in "upcoming".
  const future = Array.isArray(r.future) ? r.future : Array.isArray(r.upcoming) ? r.upcoming : [];
  return {
    current: normalizeSegment(r.current),
    next: normalizeSegment(r.next),
    future: Array.from({ length: FUTURE_RUNS }, (_, i) => normalizeFutureRun(future[i])),
    schedule: normalizeScheduleLink(r.schedule),
  };
}

/* Schedule items (from the Horaro import) have the same fields as a Future runs row, plus
   index, scheduled (ms) and cancelled. */

// Identifies a schedule item across refreshes.
export const scheduleKey = (item) => [item.name, item.category, item.performers].join('|').toLowerCase();

// The indexes of the next `count` items after `index` that aren't cancelled.
export function playableAfter(items, index, count) {
  const found = [];
  for (let i = index + 1; i < items.length && found.length < count; i++) if (!items[i].cancelled) found.push(i);
  return found;
}

export const rowFromItem = (item) => normalizeFutureRun(item ?? {});

// A Future runs row as a segment: performer names are split out and looked up in the directory.
export function segmentFromRow(row, directory) {
  return normalizeSegment({
    type: row.type,
    name: row.name,
    category: row.category,
    estimate: row.estimate,
    performers: splitNames(row.performers).map((name) => {
      const match = findPerformer(directory, name);
      return match ? { name: match.name, pronouns: match.pronouns, social: match.social } : { name };
    }),
  });
}

export function isEmptySegment(seg) {
  return !seg.name && !seg.category && !seg.estimate && seg.performers.every((p) => !p.name);
}

export function isEmptyFutureRun(run) {
  return !run.name && !run.category && !run.estimate && !run.performers;
}

// Names of the segments and future runs that have content but no segment type, which is required.
export function missingSegmentTypes(live) {
  const missing = [];
  if (!live.current.type && !isEmptySegment(live.current)) missing.push('Live Segment');
  if (!live.next.type && !isEmptySegment(live.next)) missing.push('Next Segment');
  live.future.forEach((run, i) => {
    if (!run.type && !isEmptyFutureRun(run)) missing.push(`Future run ${i + 1}`);
  });
  return missing;
}

// Splits "A vs B", "A, B & C" and similar into names, at most MAX_PERFORMERS.
export function splitNames(text) {
  return cleanText(text, 300)
    .split(/\s*(?:,|&|\+|\bvs\.?(?=\s|$)|\band\b)\s*/i)
    .filter(Boolean)
    .slice(0, MAX_PERFORMERS);
}

// Next Segment goes live, the first future run becomes Next Segment (its performer names
// looked up in the directory), and the other future runs move up a row. When Edit Segment follows
// the schedule, the empty last row is filled with the next run from the schedule.
export function promoteNext(live, directory, items = []) {
  const [first, ...later] = live.future;
  const link = live.schedule ?? emptyScheduleLink();
  let last = emptyFutureRun();
  let schedule = emptyScheduleLink();

  if (link.nextIndex !== null) {
    const [newNext] = playableAfter(items, link.nextIndex, 1);
    if (newNext !== undefined) {
      const lastIndex = playableAfter(items, newNext, FUTURE_RUNS)[FUTURE_RUNS - 1];
      if (lastIndex !== undefined) last = rowFromItem(items[lastIndex]);
      const [importedFirst, ...importedLater] = link.imported.future;
      schedule = {
        nextIndex: newNext,
        nextKey: scheduleKey(items[newNext]),
        imported: {
          next: importedFirst ? segmentFromRow(importedFirst, directory) : null,
          future: [...importedLater, lastIndex !== undefined ? last : null],
        },
      };
    }
  }

  return normalizeLive({
    current: live.next,
    next: segmentFromRow(first, directory),
    future: [...later, last],
    schedule,
  });
}

// A performer directory entry: a performer plus a stable id.
export function normalizeDirectoryEntry(raw) {
  return { id: cleanText(asObject(raw).id, 64), ...normalizePerformer(raw) };
}

export function findPerformer(directory, name) {
  if (!cleanText(name)) return undefined;
  return directory.find((entry) => sameName(entry.name, name));
}

// "twitch.tv/handle", "youtube.com/@handle", or a website without its protocol.
export function formatSocial(social) {
  const handle = social?.handle ?? '';
  if (!handle) return '';
  switch (social.platform) {
    case 'twitch': return `twitch.tv/${handle}`;
    case 'kick': return `kick.com/${handle}`;
    case 'youtube': return handle.includes('/') ? `youtube.com/${handle}` : `youtube.com/@${handle}`;
    default: return handle.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
}

// Just the handle, for layouts that show a platform icon next to it.
export function formatHandle(social) {
  const handle = social?.handle ?? '';
  if (!handle) return '';
  if (social.platform === 'youtube' && !handle.includes('/')) return `@${handle}`;
  if (social.platform === 'web') return formatSocial(social);
  return handle;
}
