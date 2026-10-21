// Twitch stream titles, shared by the server and the Dashboard's Use Live Segment button.

export const TITLE_MAX = 140;
export const DEFAULT_TITLE_TEMPLATE = 'magFAST: {name} ({category}) by {performers}';

// Fills a title template from a segment. Empty parts and the punctuation around them are dropped,
// so "{name} ({category}) by {performers}" with no category gives "Name by Runner".
export function fillTitle(template, segment) {
  const performers = segment.performers.map((p) => p.name).filter(Boolean);
  const values = {
    name: segment.name,
    category: segment.category,
    estimate: segment.estimate,
    performers: performers.length > 2 ? `${performers.slice(0, -1).join(', ')} & ${performers.at(-1)}` : performers.join(' & '),
  };
  return template
    .replace(/\s*\(\{(\w+)\}\)/g, (all, key) => (values[key] ? ` (${values[key]})` : ''))
    .replace(/\s*\b(?:by|with|ft\.?|feat\.?)\s+\{(\w+)\}/gi, (all, key) => (values[key] ? all.replace(`{${key}}`, values[key]) : ''))
    .replace(/\{(\w+)\}/g, (all, key) => values[key] ?? all)
    .replace(/\s+/g, ' ')
    .replace(/[\s:|\-–]+$/, '')
    .trim()
    .slice(0, TITLE_MAX);
}
