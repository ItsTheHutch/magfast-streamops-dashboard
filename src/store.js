import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeDirectoryEntry, normalizeLive, sameName } from '../public/shared/model.js';

// Reads JSON, falling back when the file is missing. A corrupt file is set aside, not overwritten.
export function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    const backup = `${filePath}.corrupt-${Date.now()}`;
    fs.copyFileSync(filePath, backup);
    console.warn(`Could not parse ${filePath} (${err.message}); moved a copy to ${backup} and started fresh.`);
    return fallback;
  }
}

// Write to a temp file and rename, so a crash mid-write never leaves a half-written file.
export function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

export function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const statePath = path.join(dataDir, 'state.json');
  const performersPath = path.join(dataDir, 'performers.json');

  const state = readJson(statePath, {});
  state.live = normalizeLive(state.live);

  const storedPerformers = readJson(performersPath, []);
  let performers = (Array.isArray(storedPerformers) ? storedPerformers : [])
    .map(normalizeDirectoryEntry)
    .filter((p) => p.id && p.name);

  function persistPerformers() {
    performers.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    writeJsonAtomic(performersPath, performers);
  }

  return {
    getLive() {
      return state.live;
    },

    saveLive(raw) {
      state.live = normalizeLive(raw);
      writeJsonAtomic(statePath, state);
      return state.live;
    },

    getPerformers() {
      return performers;
    },

    upsertPerformer(raw) {
      const entry = normalizeDirectoryEntry(raw);
      if (!entry.name) throw new Error('Performer name is required.');

      const duplicate = performers.find((p) => p.id !== entry.id && sameName(p.name, entry.name));
      if (duplicate) throw new Error(`"${duplicate.name}" is already in the directory.`);

      const index = entry.id ? performers.findIndex((p) => p.id === entry.id) : -1;
      if (index >= 0) {
        performers[index] = entry;
      } else {
        entry.id = randomUUID();
        performers.push(entry);
      }
      persistPerformers();
      return entry;
    },

    deletePerformer(id) {
      const before = performers.length;
      performers = performers.filter((p) => p.id !== id);
      if (performers.length === before) throw new Error('Performer not found.');
      persistPerformers();
    },
  };
}
