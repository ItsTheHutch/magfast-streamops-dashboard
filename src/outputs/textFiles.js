import fs from 'node:fs';
import path from 'node:path';
import { formatHandle, formatSocial } from '../../public/shared/model.js';
import { OUTPUT_FIELDS, defaultOutputSettings, expandLocation } from '../../public/shared/outputFiles.js';

const FIELDS = new Map(OUTPUT_FIELDS.map((field) => [field.key, field]));

// Maps live state to { location: contents } for OBS "Read from file" text sources, using the
// file locations from Settings. The Live Segment writes only its own type's files (Core Content
// or Host/Interstitial); the other type's files are left as they were.
export function buildTextFiles(live, locations = defaultOutputSettings().files) {
  const { current, next, future } = live;
  const files = {};
  const put = (key, values) => {
    const list = Array.isArray(values) ? values : [values];
    expandLocation(FIELDS.get(key), locations[key]).forEach((file, i) => { files[file] = list[i] ?? ''; });
  };

  if (current.type) {
    const t = current.type;
    put(`${t}.name`, current.name);
    put(`${t}.category`, current.category);
    put(`${t}.estimate`, current.estimate);
    put(`${t}.performerName`, current.performers.map((p) => p.name));
    put(`${t}.performerPronouns`, current.performers.map((p) => p.pronouns));
    put(`${t}.performerSocial`, current.performers.map((p) => formatSocial(p.social)));
    put(`${t}.performerHandle`, current.performers.map((p) => formatHandle(p.social)));
  }

  put('next.name', next.name);
  put('next.category', next.category);
  put('next.estimate', next.estimate);
  put('next.performers', next.performers.map((p) => p.name).filter(Boolean).join(', '));

  // Future runs are shown on the break scene.
  put('future.name', future.map((run) => run.name));
  put('future.category', future.map((run) => run.category));
  put('future.estimate', future.map((run) => run.estimate));
  put('future.performers', future.map((run) => run.performers));

  return files;
}

// Writes only files whose contents changed, so OBS doesn't re-read untouched sources.
// settings: { outputDir (absolute), files (locations) }.
export function createTextFileWriter() {
  const written = new Map(); // absolute path → contents

  return {
    write(live, settings) {
      const errors = [];
      for (const [location, contents] of Object.entries(buildTextFiles(live, settings.files))) {
        const file = path.resolve(settings.outputDir, location);
        if (written.get(file) === contents) continue;
        try {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, contents, 'utf8');
          written.set(file, contents);
        } catch (err) {
          errors.push(`${location}: ${err.message}`);
        }
      }
      return { errors };
    },

    // Writes every OBS text file, of every field and segment type, as empty.
    clearAll(settings) {
      const errors = [];
      for (const field of OUTPUT_FIELDS) {
        for (const location of expandLocation(field, settings.files[field.key])) {
          const file = path.resolve(settings.outputDir, location);
          try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, '', 'utf8');
            written.set(file, '');
          } catch (err) {
            errors.push(`${location}: ${err.message}`);
          }
        }
      }
      return { errors };
    },

    // Forget what was written, so the next write rewrites every file (after locations change).
    reset() {
      written.clear();
    },
  };
}
