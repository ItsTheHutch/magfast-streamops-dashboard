import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXAMPLE_PATH = path.join(ROOT_DIR, 'config', 'config.example.json');
const LOCAL_PATH = path.join(ROOT_DIR, 'config', 'config.json');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Values from `override` win; nested objects are merged key by key.
export function deepMerge(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    result[key] = isPlainObject(value) && isPlainObject(base[key])
      ? deepMerge(base[key], value)
      : value;
  }
  return result;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read config file ${filePath}: ${err.message}`);
  }
}

// Defaults come from config.example.json; config/config.json (gitignored) overrides them.
export function loadConfig() {
  const defaults = readJson(EXAMPLE_PATH);
  const local = fs.existsSync(LOCAL_PATH) ? readJson(LOCAL_PATH) : {};
  const config = deepMerge(defaults, local);

  if (process.env.PORT) config.port = Number(process.env.PORT);

  // Relative directories are resolved against the project root, not the cwd.
  config.outputDir = path.resolve(ROOT_DIR, config.outputDir);
  config.dataDir = path.resolve(ROOT_DIR, config.dataDir);
  config.hasLocalConfig = fs.existsSync(LOCAL_PATH);

  return config;
}
