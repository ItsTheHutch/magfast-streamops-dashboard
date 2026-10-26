// Reads a spreadsheet into rows of cell text: Excel workbooks (.xlsx, first visible sheet), CSV and
// tab-separated text. Shared by the browser (to preview an import) and the tests. No libraries: an
// .xlsx file is a zip of XML files, and both browsers and Node can unzip with DecompressionStream.

export class SpreadsheetError extends Error {}

export const SPREADSHEET_TYPES = '.xlsx,.csv,.tsv,.txt';
export const MAX_SPREADSHEET_BYTES = 5 * 1024 * 1024;

// Returns string[][]: one array per row, one string per cell, trimmed. Blank rows are kept, so
// row numbers match the spreadsheet's.
export async function readSpreadsheet(fileName, bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length > MAX_SPREADSHEET_BYTES) throw new SpreadsheetError('That file is over 5 MB. A performer list should be much smaller.');
  const isZip = data[0] === 0x50 && data[1] === 0x4b;
  const extension = /\.([^.]+)$/.exec(fileName ?? '')?.[1]?.toLowerCase() ?? '';

  if (isZip) {
    if (extension === 'ods' || extension === 'numbers') throw new SpreadsheetError(`Can't read .${extension} files. Save it as an Excel workbook (.xlsx) or CSV and try again.`);
    return readXlsx(data);
  }
  if (extension === 'xls' || (data[0] === 0xd0 && data[1] === 0xcf)) {
    throw new SpreadsheetError('That\'s an old-style Excel file (.xls). Save it as an Excel Workbook (.xlsx) or CSV and try again.');
  }
  return parseDelimited(decodeText(data));
}

// UTF-8 if it's valid, otherwise Windows-1252: what Excel's plain "CSV (Comma delimited)" uses.
function decodeText(data) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(data);
  }
}

// CSV with quoted fields ("a, b" and "say ""hi"""). The separator is whichever of comma,
// semicolon (Excel in many European languages) or tab appears most in the first line.
export function parseDelimited(text) {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const unquoted = firstLine.replace(/"[^"]*"/g, '');
  const separator = [',', ';', '\t'].map((c) => [c, unquoted.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (c === separator) {
      row.push(cell.trim());
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

/* ---------- Excel workbooks ---------- */

async function readXlsx(data) {
  const files = unzipIndex(data);
  const read = async (name) => {
    const entry = files.get(name);
    return entry ? new TextDecoder().decode(await inflateEntry(data, entry)) : null;
  };

  const workbook = await read('xl/workbook.xml');
  if (workbook === null) throw new SpreadsheetError('That zip file isn\'t an Excel workbook.');
  const sheetPath = firstSheetPath(workbook, await read('xl/_rels/workbook.xml.rels'));
  const sheet = await read(sheetPath);
  if (sheet === null) throw new SpreadsheetError('Couldn\'t find the first sheet in that workbook.');
  const shared = sharedStrings(await read('xl/sharedStrings.xml'));
  return sheetRows(sheet, shared);
}

// The zip's table of contents: file name → where its data is and how it's packed.
function unzipIndex(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new SpreadsheetError('That file looks damaged: it isn\'t a complete Excel workbook.');

  const files = new Map();
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  for (let n = 0; n < count && at + 46 <= data.length; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const nameLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(data.subarray(at + 46, at + 46 + nameLength));
    files.set(name.replace(/^\//, ''), {
      method: view.getUint16(at + 10, true),
      size: view.getUint32(at + 20, true),
      header: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return files;
}

async function inflateEntry(data, { method, size, header }) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const start = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
  const packed = data.subarray(start, start + size);
  if (method === 0) return packed;
  if (method !== 8) throw new SpreadsheetError('That workbook uses a kind of compression this can\'t read. Save it again from Excel or as CSV.');
  const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeXml(text) {
  return text
    .replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&');
}

const attribute = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

// The first sheet that isn't hidden, in the order the workbook's tabs are shown.
function firstSheetPath(workbook, rels) {
  const sheets = [...workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)].map((m) => m[0]);
  const sheet = sheets.find((tag) => !/\sstate="(?:hidden|veryHidden)"/.test(tag)) ?? sheets[0];
  const id = sheet && /\s(?:\w+:)?id="([^"]*)"/.exec(sheet.replace(/\ssheetId="[^"]*"/, ''))?.[1];
  const relation = [...(rels ?? '').matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)].map((m) => m[0]).find((tag) => attribute(tag, 'Id') === id);
  const target = relation ? decodeXml(attribute(relation, 'Target') ?? '') : 'worksheets/sheet1.xml';
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

// Text kept once in the workbook and referred to by number from the cells.
function sharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(([, item]) => runText(item));
}

// The text of a cell or shared string, leaving out phonetic guides (furigana).
function runText(xml) {
  const text = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
  return [...text.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(([, t]) => decodeXml(t)).join('');
}

// "C12" → column 2 (zero-based).
function columnIndex(ref) {
  let n = 0;
  for (const ch of /^[A-Z]+/i.exec(ref ?? '')?.[0].toUpperCase() ?? '') n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function sheetRows(xml, shared) {
  const rows = [];
  for (const [, rowTag, body = ''] of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const rowNumber = Number(attribute(rowTag, 'r')) || rows.length + 1;
    const cells = [];
    for (const [, cellTag, inner = ''] of body.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const type = attribute(cellTag, 't');
      const column = columnIndex(attribute(cellTag, 'r'));
      const value = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1];
      let text;
      if (type === 's') text = shared[Number(value)] ?? '';
      else if (type === 'inlineStr') text = runText(inner);
      else if (type === 'b') text = value === '1' ? 'TRUE' : 'FALSE';
      else text = value === undefined ? '' : decodeXml(value);
      cells[column >= 0 ? column : cells.length] = text.replace(/\s+/g, ' ').trim();
    }
    while (rows.length < rowNumber - 1) rows.push([]);
    rows[rowNumber - 1] = Array.from(cells, (c) => c ?? '');
  }
  return rows;
}
