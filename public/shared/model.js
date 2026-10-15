// Data model shared by the server and the browser: shapes, cleanup and display formatting.

export const MAX_PERFORMERS = 4;

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

// Accepts a bare handle, "@handle" or a full profile URL and returns the handle.
// YouTube legacy paths (channel/…, c/…, user/…) are kept whole; website URLs are kept as-is.
export function cleanHandle(platform, value) {
  let handle = cleanText(value, 300);
  if (!handle || platform === 'web') return handle;

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

export function emptyPerformer() {
  return { name: '', pronouns: '', social: { platform: 'twitch', handle: '' }, twitch: '' };
}

export function normalizePerformer(raw) {
  const p = asObject(raw);
  const social = asObject(p.social);
  const platform = PLATFORM_IDS.has(social.platform) ? social.platform : 'twitch';
  return {
    name: cleanText(p.name, 100),
    pronouns: cleanText(p.pronouns, 40),
    social: { platform, handle: cleanHandle(platform, social.handle) },
    twitch: cleanHandle('twitch', p.twitch),
  };
}

// The Twitch handle used for stream titles: the explicit one, or the social handle when it's Twitch.
export function twitchHandleOf(performer) {
  if (performer.twitch) return performer.twitch;
  return performer.social.platform === 'twitch' ? performer.social.handle : '';
}

export function emptyLive() {
  return {
    current: {
      name: '',
      category: '',
      estimate: '',
      performers: Array.from({ length: MAX_PERFORMERS }, emptyPerformer),
    },
    next: { name: '', category: '', estimate: '', performers: '' },
  };
}

export function normalizeLive(raw) {
  const r = asObject(raw);
  const current = asObject(r.current);
  const next = asObject(r.next);
  const performers = Array.isArray(current.performers) ? current.performers : [];
  return {
    current: {
      name: cleanText(current.name),
      category: cleanText(current.category),
      estimate: cleanText(current.estimate, 20),
      performers: Array.from({ length: MAX_PERFORMERS }, (_, i) => normalizePerformer(performers[i])),
    },
    next: {
      name: cleanText(next.name),
      category: cleanText(next.category),
      estimate: cleanText(next.estimate, 20),
      performers: cleanText(next.performers, 300),
    },
  };
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
