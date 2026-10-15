import fs from 'node:fs';
import path from 'node:path';
import { formatHandle, formatSocial } from '../../public/shared/model.js';

// Maps live state to { filename: contents } for OBS "Read from file" text sources.
export function buildTextFiles(live) {
  const { current, next } = live;
  const files = {
    'current_name.txt': current.name,
    'current_category.txt': current.category,
    'current_estimate.txt': current.estimate,
  };

  current.performers.forEach((p, i) => {
    const n = i + 1;
    files[`performer${n}_name.txt`] = p.name;
    files[`performer${n}_pronouns.txt`] = p.pronouns;
    files[`performer${n}_social.txt`] = formatSocial(p.social);
    files[`performer${n}_handle.txt`] = formatHandle(p.social);
  });

  files['next_name.txt'] = next.name;
  files['next_category.txt'] = next.category;
  files['next_estimate.txt'] = next.estimate;
  files['next_performers.txt'] = next.performers;

  return files;
}

// Writes only files whose contents changed, so OBS doesn't re-read untouched sources.
export function createTextFileWriter(outputDir) {
  const written = new Map();

  return {
    write(live) {
      const errors = [];
      try {
        fs.mkdirSync(outputDir, { recursive: true });
      } catch (err) {
        return { errors: [`Output folder ${outputDir}: ${err.message}`] };
      }

      for (const [name, contents] of Object.entries(buildTextFiles(live))) {
        if (written.get(name) === contents) continue;
        try {
          fs.writeFileSync(path.join(outputDir, name), contents, 'utf8');
          written.set(name, contents);
        } catch (err) {
          errors.push(`${name}: ${err.message}`);
        }
      }
      return { errors };
    },
  };
}
