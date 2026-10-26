import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { normalizeDirectoryEntry, normalizeLive, normalizePerformer, sameName } from '../public/shared/model.js';
import { MAX_IMPORT, planImport } from '../public/shared/performerImport.js';
import { normalizeOutputSettings } from '../public/shared/outputFiles.js';
import { emptyTimer, normalizeTimer } from '../public/shared/timer.js';
import { normalizeTimerFont } from './timerFont.js';

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
  const settingsPath = path.join(dataDir, 'settings.json');
  const schedulePath = path.join(dataDir, 'schedule.json');

  const state = readJson(statePath, {});
  state.live = normalizeLive(state.live);
  state.timer = normalizeTimer(state.timer);

  const storedSettings = readJson(settingsPath, {});
  let settings = {
    ...normalizeOutputSettings(storedSettings),
    timerFont: normalizeTimerFont(storedSettings?.timerFont),
    schedule: storedSettings?.schedule ?? null, // normalized by the app, which knows the config defaults
  };

  // The last imported Horaro schedule, kept so it's there after a restart or without internet.
  let schedule = readJson(schedulePath, null);

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

    getTimer() {
      return state.timer;
    },

    saveTimer(timer) {
      state.timer = normalizeTimer(timer);
      writeJsonAtomic(statePath, state);
      return state.timer;
    },

    fontsDir: path.join(dataDir, 'fonts'),

    getSettings() {
      return settings;
    },

    // Output folder and file locations. The timer font and schedule settings are kept as they are.
    saveSettings(next) {
      settings = { ...settings, ...normalizeOutputSettings(next) };
      writeJsonAtomic(settingsPath, settings);
      return settings;
    },

    setScheduleSettings(next) {
      settings = { ...settings, schedule: next };
      writeJsonAtomic(settingsPath, settings);
      return settings.schedule;
    },

    getSchedule() {
      return schedule;
    },

    saveSchedule(next) {
      schedule = next;
      writeJsonAtomic(schedulePath, schedule);
      return schedule;
    },

    clearSchedule() {
      schedule = null;
      fs.rmSync(schedulePath, { force: true });
    },

    // Empty segments, Future runs and timer.
    clearLive() {
      state.live = normalizeLive({});
      state.timer = emptyTimer();
      writeJsonAtomic(statePath, state);
    },

    clearPerformers() {
      performers = [];
      persistPerformers();
    },

    // Copies the data files into data/backups/<time>-<reason>/ before a reset. Returns the folder.
    backup(reason) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      const folder = path.join(dataDir, 'backups', `${stamp}-${reason}`);
      fs.mkdirSync(folder, { recursive: true });
      for (const file of [statePath, performersPath, settingsPath, schedulePath, path.join(dataDir, 'twitch.json')]) {
        if (fs.existsSync(file)) fs.copyFileSync(file, path.join(folder, path.basename(file)));
      }
      const fontsDir = path.join(dataDir, 'fonts');
      if (fs.existsSync(fontsDir)) fs.cpSync(fontsDir, path.join(folder, 'fonts'), { recursive: true });
      return folder;
    },

    // The key in Stream Deck macro addresses. Made the first time it's needed.
    getMacroKey() {
      if (!settings.macroKey) this.newMacroKey();
      return settings.macroKey;
    },

    newMacroKey() {
      settings = { ...settings, macroKey: randomBytes(16).toString('hex') };
      writeJsonAtomic(settingsPath, settings);
      return settings.macroKey;
    },

    setTimerFont(font) {
      settings = { ...settings, timerFont: normalizeTimerFont(font) };
      writeJsonAtomic(settingsPath, settings);
      return settings.timerFont;
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

    // Adds new performers and, with updateExisting, fills in details for ones already here.
    importPerformers(incoming, { updateExisting = true } = {}) {
      const entries = (Array.isArray(incoming) ? incoming : []).map(normalizePerformer).filter((p) => p.name);
      const unique = entries.filter((p, i) => entries.findIndex((q) => sameName(q.name, p.name)) === i);
      if (unique.length > MAX_IMPORT) throw new Error(`An import can add up to ${MAX_IMPORT} performers.`);
      const counts = { added: 0, updated: 0, unchanged: 0 };
      for (const item of planImport(unique, performers, { updateExisting })) {
        if (item.status === 'new') {
          performers.push({ id: randomUUID(), ...item.performer });
          counts.added++;
        } else if (item.status === 'update') {
          performers[performers.indexOf(item.existing)] = item.performer;
          counts.updated++;
        } else {
          counts.unchanged++;
        }
      }
      if (counts.added || counts.updated) persistPerformers();
      return counts;
    },

    deletePerformer(id) {
      const before = performers.length;
      performers = performers.filter((p) => p.id !== id);
      if (performers.length === before) throw new Error('Performer not found.');
      persistPerformers();
    },
  };
}
