// Where each OBS text file is written. Shared by the server (to write the files) and the
// Settings tab (to edit the locations).
//
// A location is a file name or path ending in .txt. Relative paths are inside the output folder.
// In fields that repeat, {n} is replaced by the performer number (1–4) or future run number (1–4).

import { FUTURE_RUNS, MAX_PERFORMERS, cleanText } from './model.js';

export const OUTPUT_GROUPS = [
  {
    id: 'core',
    label: 'Live Segment: Core Content',
    fields: [
      { key: 'core.name', label: 'Segment name', file: 'current_name.txt' },
      { key: 'core.category', label: 'Category', file: 'current_category.txt' },
      { key: 'core.estimate', label: 'Estimate', file: 'current_estimate.txt' },
      { key: 'core.performerName', label: 'Performer name', file: 'performer{n}_name.txt', repeat: MAX_PERFORMERS },
      { key: 'core.performerPronouns', label: 'Performer pronouns', file: 'performer{n}_pronouns.txt', repeat: MAX_PERFORMERS },
      { key: 'core.performerSocial', label: 'Performer social', file: 'performer{n}_social.txt', repeat: MAX_PERFORMERS },
      { key: 'core.performerHandle', label: 'Performer handle', file: 'performer{n}_handle.txt', repeat: MAX_PERFORMERS },
    ],
  },
  {
    id: 'host',
    label: 'Live Segment: Host/Interstitial',
    fields: [
      { key: 'host.name', label: 'Segment name', file: 'host_name.txt' },
      { key: 'host.category', label: 'Category', file: 'host_category.txt' },
      { key: 'host.estimate', label: 'Estimate', file: 'host_estimate.txt' },
      { key: 'host.performerName', label: 'Performer name', file: 'host{n}_name.txt', repeat: MAX_PERFORMERS },
      { key: 'host.performerPronouns', label: 'Performer pronouns', file: 'host{n}_pronouns.txt', repeat: MAX_PERFORMERS },
      { key: 'host.performerSocial', label: 'Performer social', file: 'host{n}_social.txt', repeat: MAX_PERFORMERS },
      { key: 'host.performerHandle', label: 'Performer handle', file: 'host{n}_handle.txt', repeat: MAX_PERFORMERS },
    ],
  },
  {
    id: 'next',
    label: 'Next Segment',
    fields: [
      { key: 'next.name', label: 'Segment name', file: 'next_name.txt' },
      { key: 'next.category', label: 'Category', file: 'next_category.txt' },
      { key: 'next.estimate', label: 'Estimate', file: 'next_estimate.txt' },
      { key: 'next.performers', label: 'Performers', file: 'next_performers.txt' },
    ],
  },
  {
    id: 'future',
    label: 'Future runs',
    fields: [
      { key: 'future.name', label: 'Segment name', file: 'future{n}_name.txt', repeat: FUTURE_RUNS },
      { key: 'future.category', label: 'Category', file: 'future{n}_category.txt', repeat: FUTURE_RUNS },
      { key: 'future.estimate', label: 'Estimate', file: 'future{n}_estimate.txt', repeat: FUTURE_RUNS },
      { key: 'future.performers', label: 'Performers', file: 'future{n}_performers.txt', repeat: FUTURE_RUNS },
    ],
  },
];

export const OUTPUT_FIELDS = OUTPUT_GROUPS.flatMap((group) => group.fields.map((field) => ({ ...field, group })));

export function defaultOutputSettings() {
  return {
    outputDir: '',
    files: Object.fromEntries(OUTPUT_FIELDS.map((field) => [field.key, field.file])),
  };
}

// outputDir '' means the default from config. A blank file location falls back to its default.
export function normalizeOutputSettings(raw) {
  const r = raw !== null && typeof raw === 'object' ? raw : {};
  const files = r.files !== null && typeof r.files === 'object' ? r.files : {};
  return {
    outputDir: cleanText(r.outputDir, 500),
    files: Object.fromEntries(OUTPUT_FIELDS.map((field) => [field.key, cleanText(files[field.key], 300) || field.file])),
  };
}

// The file locations a field writes to: one, or one per performer / future run.
export function expandLocation(field, location) {
  if (!field.repeat) return [location];
  return Array.from({ length: field.repeat }, (_, i) => location.replaceAll('{n}', String(i + 1)));
}

// Problems that would stop the files being written correctly, as { key, message }.
export function validateOutputSettings(settings) {
  const errors = [];
  const seen = new Map(); // lower-cased path → field that claimed it (Windows paths ignore case)

  for (const field of OUTPUT_FIELDS) {
    const location = settings.files[field.key];
    if (!/\.txt$/i.test(location)) {
      errors.push({ key: field.key, message: 'Must end in .txt.' });
      continue;
    }
    if (field.repeat && !location.includes('{n}')) {
      errors.push({ key: field.key, message: 'Must include {n}, so each one gets its own file.' });
      continue;
    }
    for (const file of expandLocation(field, location)) {
      const id = file.replace(/\\/g, '/').toLowerCase();
      const other = seen.get(id);
      if (other && other !== field) {
        errors.push({ key: field.key, message: `Same file as ${other.group.label} › ${other.label}.` });
        break;
      }
      seen.set(id, field);
    }
  }
  return errors;
}
