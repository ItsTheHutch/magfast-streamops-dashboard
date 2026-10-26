// Turns spreadsheet rows into performers, and works out what importing them would change.
// Shared by the browser (the preview) and the server (the import itself), so both agree.

import { SOCIAL_PLATFORMS, cleanText, detectPlatform, findPerformer, normalizePerformer, sameName } from './model.js';
import { SpreadsheetError } from './spreadsheet.js';

export const MAX_IMPORT = 2000;

// Column headings, compared without case, spaces or punctuation.
const HEADINGS = {
  name: ['name', 'performer', 'performername', 'runner', 'runnername', 'displayname', 'player', 'host', 'username'],
  pronouns: ['pronouns', 'pronoun'],
  social: ['social', 'socials', 'socialmedia', 'handle', 'handleorurl', 'url', 'link', 'profile', 'sociallink', 'socialurl', 'channel'],
  platform: ['platform', 'socialplatform', 'site'],
  twitch: ['twitch', 'twitchhandle', 'twitchurl', 'twitchname'],
  youtube: ['youtube', 'youtubehandle', 'youtubeurl', 'youtubechannel'],
  kick: ['kick', 'kickhandle', 'kickurl'],
  web: ['website', 'web', 'websiteurl', 'homepage'],
};
const PLATFORM_COLUMNS = ['twitch', 'youtube', 'kick', 'web'];

const headingKey = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// A Platform column's value as a platform id: "Twitch", "twitch.tv", "YouTube", "Website"…
function platformFrom(text) {
  const key = headingKey(text);
  if (!key) return '';
  const match = SOCIAL_PLATFORMS.find((p) => key === p.id || key === headingKey(p.label) || key.startsWith(p.id));
  return match?.id ?? (['site', 'url', 'homepage'].includes(key) ? 'web' : '');
}

// Finds the heading row (the first row with a Name column, within the first five) and maps
// each field to its column number.
export function findColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const columns = {};
    rows[r].forEach((heading, c) => {
      const key = headingKey(heading);
      const field = Object.keys(HEADINGS).find((f) => HEADINGS[f].includes(key));
      if (field && columns[field] === undefined) columns[field] = c;
    });
    if (columns.name !== undefined) return { headingRow: r, columns };
  }
  return null;
}

// The rows as performers. Row numbers count from 1, like the spreadsheet's.
// Returns { performers: [{ row, performer }], skipped: [{ row, name, reason }], columns }.
export function performersFromRows(rows) {
  const found = findColumns(rows);
  if (!found) {
    throw new SpreadsheetError('Couldn\'t find a Name column. The first row should be column headings, such as Name, Pronouns and Social.');
  }
  const { headingRow, columns } = found;
  const cell = (row, field) => (columns[field] === undefined ? '' : cleanText(row[columns[field]] ?? '', 300));

  const performers = [];
  const skipped = [];
  for (let r = headingRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row.some((c) => cleanText(c))) continue;
    const name = cell(row, 'name');
    if (!name) {
      skipped.push({ row: r + 1, name: '', reason: 'No name' });
      continue;
    }
    const earlier = performers.find((p) => sameName(p.performer.name, name));
    if (earlier) {
      skipped.push({ row: r + 1, name, reason: `Same name as row ${earlier.row}` });
      continue;
    }

    // A Social column (a link, or a handle with a Platform column), else the first platform column filled in.
    let social = { platform: platformFrom(cell(row, 'platform')) || detectPlatform(cell(row, 'social')), handle: cell(row, 'social') };
    if (!social.handle) {
      const platform = PLATFORM_COLUMNS.find((p) => cell(row, p));
      social = platform ? { platform, handle: cell(row, platform) } : { platform: '', handle: '' };
    }
    performers.push({ row: r + 1, performer: normalizePerformer({ name, pronouns: cell(row, 'pronouns'), social }) });
  }
  if (performers.length > MAX_IMPORT) throw new SpreadsheetError(`That's ${performers.length} performers; an import can add up to ${MAX_IMPORT}.`);
  return { performers, skipped, columns: Object.keys(columns) };
}

// An existing performer updated from the file. Blank cells never erase anything.
export function mergePerformer(existing, incoming) {
  return {
    ...existing,
    pronouns: incoming.pronouns || existing.pronouns,
    social: incoming.social.handle ? incoming.social : existing.social,
  };
}

const sameSocial = (a, b) => a.platform === b.platform && a.handle === b.handle;

// What importing would do to each performer: 'new', 'update' (with the fields that change),
// 'same' (already matches), or 'keep' (already here, and updating is turned off).
export function planImport(performers, directory, { updateExisting = true } = {}) {
  return performers.map((performer) => {
    const existing = findPerformer(directory, performer.name);
    if (!existing) return { status: 'new', performer };
    const merged = mergePerformer(existing, performer);
    const changes = [
      merged.pronouns !== existing.pronouns && 'pronouns',
      !sameSocial(merged.social, existing.social) && 'social',
    ].filter(Boolean);
    if (!changes.length) return { status: 'same', performer: existing, existing };
    if (!updateExisting) return { status: 'keep', performer: existing, existing, changes };
    return { status: 'update', performer: merged, existing, changes };
  });
}

// A starting point for the spreadsheet, offered as a download.
export const TEMPLATE_CSV = [
  'Name,Pronouns,Social',
  'Example Runner,they/them,https://twitch.tv/example_runner',
  'Example Host,she/her,https://youtube.com/@example_host',
  'Example Guest,,',
].join('\r\n') + '\r\n';
