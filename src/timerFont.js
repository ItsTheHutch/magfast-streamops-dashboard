import fs from 'node:fs';
import path from 'node:path';

// The uploaded timer font. One font at a time, stored as data/fonts/timer-font.<ext>.

export const FONT_TYPES = {
  woff2: { contentType: 'font/woff2', magic: [Buffer.from('wOF2')] },
  woff: { contentType: 'font/woff', magic: [Buffer.from('wOFF')] },
  ttf: { contentType: 'font/ttf', magic: [Buffer.from([0, 1, 0, 0]), Buffer.from('true')] },
  otf: { contentType: 'font/otf', magic: [Buffer.from('OTTO'), Buffer.from([0, 1, 0, 0])] },
};

export const MAX_FONT_BYTES = 10 * 1024 * 1024;

// { name, ext, version } as kept in settings, or null for the default font.
export function normalizeTimerFont(raw) {
  if (raw === null || typeof raw !== 'object' || !FONT_TYPES[raw.ext]) return null;
  return {
    name: typeof raw.name === 'string' ? raw.name.slice(0, 200) : `timer-font.${raw.ext}`,
    ext: raw.ext,
    version: Number.isFinite(raw.version) ? raw.version : 0,
  };
}

// Checks an upload is really a font of the type its name says. Returns its extension.
export function checkFontUpload(fileName, bytes) {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  const type = FONT_TYPES[ext];
  if (!type) throw new Error('Upload a .woff2, .woff, .ttf or .otf font file.');
  if (!bytes.length) throw new Error('That file is empty.');
  if (bytes.length > MAX_FONT_BYTES) throw new Error('Font files can be up to 10 MB.');
  if (!type.magic.some((magic) => bytes.subarray(0, 4).equals(magic))) {
    throw new Error(`That file isn't a valid .${ext} font.`);
  }
  return ext;
}

export const fontPath = (fontsDir, ext) => path.join(fontsDir, `timer-font.${ext}`);

// Replaces any previous timer font file with this one.
export function writeFontFile(fontsDir, ext, bytes) {
  fs.mkdirSync(fontsDir, { recursive: true });
  removeFontFiles(fontsDir);
  const tmp = `${fontPath(fontsDir, ext)}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, fontPath(fontsDir, ext));
}

export function removeFontFiles(fontsDir) {
  for (const ext of Object.keys(FONT_TYPES)) fs.rmSync(fontPath(fontsDir, ext), { force: true });
}
