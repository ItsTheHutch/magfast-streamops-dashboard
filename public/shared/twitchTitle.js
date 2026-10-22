// Twitch stream titles, shared by the server and the Dashboard's Use Live Segment button.

import { titleHandleOf } from './model.js';

export const TITLE_MAX = 140;
export const DEFAULT_TITLE_TEMPLATE = 'magFAST: {name} ({category}) by {performers}';
export const TITLE_PLACEHOLDERS = ['name', 'category', 'estimate', 'performers'];

// A placeholder: {name}, and also {@performers} or {Performers}, since both read naturally.
const PLACEHOLDER = /\{@?(\w+)\}/g;

// Placeholders in a template that fillTitle wouldn't fill, e.g. ["{runners}"].
export function unknownPlaceholders(template) {
  return [...String(template).matchAll(PLACEHOLDER)]
    .filter(([, key]) => !TITLE_PLACEHOLDERS.includes(key.toLowerCase()))
    .map(([token]) => token);
}

// How a performer is tagged in the title: @ and their social handle, or just their name when they
// have no handle (or it's a website link), since "@Name" wouldn't tag anyone.
export function titleTag(performer) {
  const handle = titleHandleOf(performer);
  return handle ? `@${handle}` : performer.name;
}

// Fills a title template from a segment. Empty parts and the punctuation around them are dropped,
// so "{name} ({category}) by {performers}" with no category gives "Name by @Runner".
export function fillTitle(template, segment) {
  const performers = segment.performers.filter((p) => p.name).map(titleTag);
  const values = {
    name: segment.name,
    category: segment.category,
    estimate: segment.estimate,
    performers: performers.length > 2 ? `${performers.slice(0, -1).join(', ')} & ${performers.at(-1)}` : performers.join(' & '),
  };
  const value = (key) => values[key.toLowerCase()];
  return template
    .replace(/\s*\(\{@?(\w+)\}\)/g, (all, key) => (value(key) ? ` (${value(key)})` : ''))
    .replace(/\s*\b(?:by|with|ft\.?|feat\.?)\s+\{@?(\w+)\}/gi, (all, key) => (value(key) ? all.replace(/\{@?\w+\}/, value(key)) : ''))
    .replace(PLACEHOLDER, (all, key) => value(key) ?? all)
    .replace(/\s+/g, ' ')
    .replace(/[\s:|\-–]+$/, '')
    .trim()
    .slice(0, TITLE_MAX);
}
