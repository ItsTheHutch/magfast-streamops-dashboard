import {
  FUTURE_RUNS,
  MAX_PERFORMERS,
  SEGMENT_TYPES,
  SOCIAL_PLATFORMS,
  emptyLive,
  emptyPerformer,
  findPerformer,
  formatEstimate,
  formatSocial,
  isEmptyFutureRun,
  playableAfter,
  isEmptySegment,
  missingSegmentTypes,
  normalizeLive,
  promoteNext,
} from '/shared/model.js';
import {
  OUTPUT_GROUPS,
  defaultOutputSettings,
  normalizeOutputSettings,
  validateOutputSettings,
} from '/shared/outputFiles.js';
import { finishPlaces, formatTimer, timerElapsed } from '/shared/timer.js';
import { setClockText, useTimerFont } from '/shared/clock.js';
import { TITLE_MAX, TITLE_PLACEHOLDERS, fillTitle, unknownPlaceholders } from '/shared/twitchTitle.js';
import { MACROS } from '/shared/macros.js';

/* global io */
const socket = io();

let live = null;        // last saved state from the server
let directory = [];     // performer directory

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function getPath(obj, path) {
  return path.split('.').reduce((value, key) => value?.[key], obj) ?? '';
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((value, key) => value[key], obj);
  target[last] = value;
}

// Sends a request to the server and resolves with its reply, or rejects with its error.
// Fetching from Horaro can take a while, so those requests wait longer.
function request(event, payload, timeout = 5000) {
  return new Promise((resolve, reject) => {
    socket.timeout(timeout).emit(event, payload, (err, reply) => {
      if (err) return reject(new Error('The server did not respond.'));
      if (!reply?.ok) return reject(new Error(reply?.error ?? 'Request failed.'));
      resolve(reply);
    });
  });
}

function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  const toasts = $('#toasts');
  toasts.append(el);
  while (toasts.children.length > 3) toasts.firstElementChild.remove();
  setTimeout(() => el.remove(), kind === 'error' ? 8000 : 3500);
}

// Social starts as "Not set" so empty performer slots stay empty.
// Shows the confirmation dialog and resolves true if the operator confirms. With danger, the
// confirm button is red and Cancel has focus, so pressing Enter can't delete anything.
function confirmAction({ title, body, confirm, danger = false }) {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-body').textContent = body;
  $('#confirm-ok').textContent = confirm;
  $('#confirm-ok').classList.toggle('danger-solid', danger);
  $('#confirm-ok').classList.toggle('primary', !danger);
  $('#confirm-ok').autofocus = !danger;
  $('#confirm-dialog button[value=cancel]').autofocus = danger;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
  });
}

function fillPlatformOptions(select) {
  select.add(new Option('Not set', ''));
  for (const { id, label } of SOCIAL_PLATFORMS) select.add(new Option(label, id));
}

/* ---------- Tabs ---------- */

function showTab(name) {
  const tabs = $$('.tab');
  if (!tabs.some((t) => t.dataset.tab === name)) name = 'dashboard';
  for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  for (const panel of $$('.panel')) panel.hidden = panel.id !== `tab-${name}`;
  history.replaceState(null, '', `#${name}`);
  document.dispatchEvent(new CustomEvent('tabchange'));
}

for (const tab of $$('.tab')) tab.addEventListener('click', () => showTab(tab.dataset.tab));
// In-page links to another tab, e.g. <a href="#edit" data-goto="edit">.
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-goto]');
  if (!link) return;
  e.preventDefault();
  showTab(link.dataset.goto);
});
showTab(location.hash.slice(1));

/* ---------- Run tab ---------- */

const runForm = $('#run-form');

// "a", "a and b", "a, b and c"
function listOf(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

// Live Segment and Next Segment each get four performer slots.
function buildPerformerSlots(segment) {
  const template = $('#performer-slot');
  const container = $(`[data-slots="${segment}"]`, runForm);
  for (let i = 0; i < MAX_PERFORMERS; i++) {
    const slot = template.content.firstElementChild.cloneNode(true);
    slot.dataset.segment = segment;
    slot.dataset.slot = i;
    $('.slot-num', slot).textContent = i + 1;
    for (const field of $$('[data-field]', slot)) {
      field.dataset.path = `${segment}.performers.${i}.${field.dataset.field}`;
    }
    container.append(slot);
  }
}

// The segment type radio pair. Future runs rows use a compact version with short labels.
const SHORT_TYPE_LABELS = { core: 'Core', host: 'Host' };

function buildTypePicker(holder, path, { compact = false } = {}) {
  const picker = $('#type-picker').content.firstElementChild.cloneNode(true);
  picker.dataset.picker = path;
  picker.classList.toggle('compact', compact);
  if (compact) $('legend', picker).classList.add('lbl');
  for (const input of $$('input', picker)) {
    const type = SEGMENT_TYPES.find((t) => t.id === input.value);
    input.name = path;
    input.dataset.path = path;
    input.nextElementSibling.textContent = compact ? SHORT_TYPE_LABELS[type.id] : type.label;
    if (compact) input.closest('label').title = type.label;
  }
  holder.replaceWith(picker);
}

function buildFutureRows() {
  const template = $('#future-row');
  const container = $('#future-rows');
  for (let i = 0; i < FUTURE_RUNS; i++) {
    const row = template.content.firstElementChild.cloneNode(true);
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `Future run ${i + 1}`);
    $('.row-num', row).textContent = i + 1;
    for (const field of $$('[data-run-field]', row)) {
      field.dataset.path = `future.${i}.${field.dataset.runField}`;
    }
    buildTypePicker($('[data-type-picker]', row), `future.${i}.type`, { compact: true });
    container.append(row);
  }
}

const runFields = () => $$('[data-path]', runForm);
const isRadio = (field) => field.type === 'radio';

function setField(field, value) {
  if (isRadio(field)) field.checked = field.value === value;
  else field.value = value;
}

// The form as a normalized live object (the same shape the server saves).
// The schedule link isn't a form field, so it's carried over from the saved state.
function readRunForm() {
  const draft = emptyLive();
  for (const field of runFields()) {
    if (isRadio(field) && !field.checked) continue;
    setPath(draft, field.dataset.path, field.value);
  }
  if (live) draft.schedule = live.schedule;
  return normalizeLive(draft);
}

function writeRunForm(state) {
  for (const field of runFields()) setField(field, getPath(state, field.dataset.path));
}

function isDirty() {
  return live !== null && runFields().some((f) => f.classList.contains('dirty'));
}

// Colours each segment by its selected type and fills in its corner label.
function refreshSegmentTypes(draft) {
  for (const section of $$('.segment', runForm)) {
    const type = SEGMENT_TYPES.find((t) => t.id === draft[section.dataset.segment].type);
    section.dataset.type = type?.id ?? '';
    const badge = $('[data-type-badge]', section);
    badge.textContent = type?.label ?? '';
    badge.hidden = !type;
  }
  // A segment or future run with content needs a type.
  for (const picker of $$('.type-picker', runForm)) {
    const owner = getPath(draft, picker.dataset.picker.replace(/\.type$/, ''));
    const empty = Array.isArray(owner.performers) ? isEmptySegment(owner) : isEmptyFutureRun(owner);
    picker.classList.toggle('missing', !owner.type && !empty);
  }
}

function refreshRunStatus() {
  const draft = readRunForm();
  refreshSegmentTypes(draft);
  if (!live) return;

  const changedPaths = new Set();
  for (const field of runFields()) {
    const path = field.dataset.path;
    const changed = getPath(draft, path) !== getPath(live, path);
    field.classList.toggle('dirty', changed);
    if (changed) changedPaths.add(path);
  }
  const changes = changedPaths.size;
  const missing = missingSegmentTypes(draft);

  $('.savebar').dataset.state = missing.length ? 'invalid' : changes ? 'dirty' : 'clean';
  $('#run-status').textContent = missing.length
    ? `Choose a segment type for ${listOf(missing)}`
    : changes
      ? `${changes} unsaved ${changes === 1 ? 'change' : 'changes'}, not in OBS yet`
      : 'OBS text files are up to date';
  $('#save').disabled = !changes || missing.length > 0 || !socket.connected;
  $('#revert').disabled = !changes;
  $('#advance').disabled = !canPromote(draft) || !socket.connected;
  refreshUndo();
  refreshDirectoryBadges();
  refreshDashPromote();
}

function refreshDirectoryBadges() {
  for (const slot of $$('.slot', runForm)) {
    const name = $('[data-field="name"]', slot).value;
    $('[data-badge]', slot).hidden = !name.trim() || Boolean(findPerformer(directory, name));
  }
}

// Applies a new saved state without clobbering fields the operator is still editing.
function applyLive(next) {
  if (live === null) {
    writeRunForm(next);
  } else {
    const draft = readRunForm();
    for (const field of runFields()) {
      const path = field.dataset.path;
      if (getPath(draft, path) === getPath(live, path)) setField(field, getPath(next, path));
    }
  }
  live = next;
  refreshRunStatus();
  renderDashboard();
  renderSchedule();
  if (twitch) refreshTemplatePreview();
}

function slotFields(slot) {
  const field = (name) => $(`[data-field="${name}"]`, slot);
  return {
    name: field('name'),
    pronouns: field('pronouns'),
    platform: field('social.platform'),
    handle: field('social.handle'),
  };
}

function fillSlot(slot, performer) {
  const f = slotFields(slot);
  f.name.value = performer.name;
  f.pronouns.value = performer.pronouns;
  f.platform.value = performer.social.platform;
  f.handle.value = performer.social.handle;
}

async function save() {
  if (!isDirty()) return;
  const draft = readRunForm();
  const missing = missingSegmentTypes(draft);
  if (missing.length) return toast(`Choose a segment type for ${listOf(missing)} before saving.`, 'error');
  $('#save').disabled = true;
  try {
    const { warnings } = await request('live:save', draft);
    if (warnings?.length) toast(`Saved, but some text files failed: ${warnings.join('; ')}`, 'warn');
    else toast('Saved: OBS text files updated.');
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
  } finally {
    refreshRunStatus();
  }
}

/* Moving Next Segment to Live: confirmed in a dialog, saved straight away, and undoable. */

// Set after a move: the saved state and form from before it, and the saved state it produced.
// Undo is offered until anything else is saved.
let lastMove = null;

function canPromote(draft) {
  if (!draft.next.type || isEmptySegment(draft.next)) return false;
  return missingSegmentTypes(promoteNext(draft, directory, scheduleItems())).length === 0;
}

function refreshUndo() {
  if (lastMove && JSON.stringify(live) !== lastMove.after) lastMove = null;
  $('#undo-advance').hidden = !lastMove;
  $('#promote-undo').hidden = !lastMove;
}

$('#advance').addEventListener('click', async () => {
  const draft = readRunForm();
  if (!canPromote(draft)) return;
  const incoming = draft.future[0];
  const confirmed = await confirmAction({
    title: 'Move Next Segment to Live?',
    body: [
      `${draft.next.name || 'Next Segment'} goes live and the OBS text files update right away.`,
      isEmptyFutureRun(incoming) ? 'Next Segment will be left empty.' : `${incoming.name || 'Future run 1'} moves into Next Segment.`,
      isDirty() ? 'Your other unsaved changes are saved too.' : '',
    ].filter(Boolean).join(' '),
    confirm: 'Move to Live',
  });
  if (!confirmed) return;
  promote();
});

async function promote() {
  const draft = readRunForm();
  const before = live;
  const promoted = promoteNext(draft, directory, scheduleItems());
  try {
    await request('live:save', promoted);
    writeRunForm(promoted);
    lastMove = { before, draft, after: JSON.stringify(live) };
    refreshRunStatus();
    toast(`${promoted.current.name || 'Next Segment'} is now live.`);
  } catch (err) {
    toast(`Move failed: ${err.message}`, 'error');
  }
}

async function undoMove() {
  if (!lastMove) return;
  const { before, draft } = lastMove;
  lastMove = null;
  try {
    await request('live:save', before);
    writeRunForm(draft);
    refreshRunStatus();
    toast('Move undone.');
  } catch (err) {
    toast(`Undo failed: ${err.message}`, 'error');
  }
}

$('#undo-advance').addEventListener('click', undoMove);
$('#promote-undo').addEventListener('click', undoMove);

/*
  Estimate fields fill left to right over H:MM:SS, like a date field: the cursor skips the colons,
  ":" jumps to the next part, and a minutes or seconds digit over 5 becomes "0X" and moves on.
  Backspace zeroes the digit before the cursor.
*/
const ESTIMATE_TEMPLATE = '0:00:00';
const isDigit = (c) => c >= '0' && c <= '9';

function zeroDigits(value, start, end) {
  return [...value].map((c, i) => (i >= start && i < end && isDigit(c) ? '0' : c)).join('');
}

// Types one character into value at pos; returns the new value and cursor position.
function typeEstimateChar(value, pos, char) {
  if (char === ':') {
    // Right after a colon (the cursor already skipped it), a typed ":" has nothing to do.
    if (value[pos - 1] === ':') return [value, pos];
    const colon = value.indexOf(':', pos);
    return [value, colon === -1 ? pos : colon + 1];
  }
  if (!isDigit(char)) return [value, pos];

  let at = pos;
  while (at < value.length && !isDigit(value[at])) at++;
  if (at >= value.length) return [value, pos];

  const chars = [...value];
  if (value[at - 1] === ':' && char > '5') {
    chars[at] = '0';
    chars[at + 1] = char;
    at += 2;
  } else {
    chars[at] = char;
    at += 1;
  }
  if (chars[at] === ':') at += 1;
  return [chars.join(''), at];
}

function setEstimate(field, value, caret) {
  field.value = value;
  field.setSelectionRange(caret, caret);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

runForm.addEventListener('beforeinput', (e) => {
  const field = e.target;
  if (!field.matches('[data-estimate]')) return;
  if (!['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(e.inputType)) return;
  e.preventDefault();
  if (e.inputType === 'insertText' && !/[\d:]/.test(e.data ?? '')) return;

  let value = field.value;
  let { selectionStart: start, selectionEnd: end } = field;
  if (start !== end) value = zeroDigits(value, start, end);

  if (e.inputType === 'insertText') {
    if (!value) [value, start] = [ESTIMATE_TEMPLATE, 0];
    for (const char of e.data ?? '') [value, start] = typeEstimateChar(value, start, char);
    return setEstimate(field, value, start);
  }

  if (start === end) {
    const step = e.inputType === 'deleteContentBackward' ? -1 : 1;
    let at = step < 0 ? start - 1 : start;
    while (at >= 0 && at < value.length && !isDigit(value[at])) at += step;
    if (at >= 0 && at < value.length) {
      value = zeroDigits(value, at, at + 1);
      if (step < 0) start = at;
    }
  }
  // Clearing every digit empties the field, so it shows the placeholder again.
  if (!/[1-9]/.test(value)) [value, start] = ['', 0];
  setEstimate(field, value, start);
});

runForm.addEventListener('paste', (e) => {
  const field = e.target;
  if (!field.matches('[data-estimate]')) return;
  e.preventDefault();
  const value = formatEstimate(e.clipboardData.getData('text'));
  setEstimate(field, value, value.length);
});

runForm.addEventListener('input', refreshRunStatus);
runForm.addEventListener('submit', (e) => e.preventDefault());

runForm.addEventListener('change', (e) => {
  if (e.target.matches('[data-estimate]')) {
    e.target.value = formatEstimate(e.target.value);
    refreshRunStatus();
    return;
  }
  // Picking a known name fills in the rest of that performer's details.
  if (e.target.dataset.field !== 'name') return;
  const match = findPerformer(directory, e.target.value);
  if (match) {
    fillSlot(e.target.closest('.slot'), match);
    refreshRunStatus();
  }
});

runForm.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-action]');
  if (!button) return;
  const slot = button.closest('.slot');
  const { segment, slot: index } = slot.dataset;

  if (button.dataset.action === 'clear') {
    fillSlot(slot, emptyPerformer());
    refreshRunStatus();
    return;
  }

  if (button.dataset.action === 'to-directory') {
    const performer = readRunForm()[segment].performers[index];
    if (!performer.name) return toast('Enter a name first.', 'warn');
    const existing = findPerformer(directory, performer.name);
    try {
      await request('performers:upsert', { ...performer, id: existing?.id });
      toast(existing ? `Updated ${performer.name} in the directory.` : `Added ${performer.name} to the directory.`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }
});

$('#save').addEventListener('click', save);
$('#revert').addEventListener('click', () => {
  writeRunForm(live);
  refreshRunStatus();
});

// Ctrl+S saves whichever tab is open.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (!$('#tab-settings').hidden) settingsForm.requestSubmit();
    else if (!$('#tab-edit').hidden) save();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (isDirty() || settingsDirty()) e.preventDefault();
});

/* ---------- Performers tab ---------- */

const dirForm = $('#dir-form');
let selectedId = null;

function renderDirectory() {
  const query = $('#dir-search').value.trim().toLowerCase();
  const list = $('#dir-list');
  const shown = directory.filter((p) => !query || p.name.toLowerCase().includes(query));
  const focusedId = list.contains(document.activeElement) ? document.activeElement.closest('li').dataset.id : null;

  list.replaceChildren(...shown.map((p) => {
    const li = document.createElement('li');
    li.dataset.id = p.id;
    if (p.id === selectedId) li.setAttribute('aria-current', 'true');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dir-item';
    const name = document.createElement('span');
    name.className = 'dir-name';
    name.textContent = p.name;
    const meta = document.createElement('span');
    meta.className = 'dir-meta';
    for (const text of [p.pronouns, formatSocial(p.social)].filter(Boolean)) {
      const part = document.createElement('span');
      part.textContent = text;
      meta.append(part);
    }
    button.append(name, meta);
    li.append(button);
    return li;
  }));
  // Rebuilding the list drops focus, so put it back on the same performer.
  if (focusedId) [...list.children].find((li) => li.dataset.id === focusedId)?.firstElementChild.focus();

  $('#dir-count').textContent = directory.length === 1 ? '1 performer' : `${directory.length} performers`;
  $('#directory-names').replaceChildren(...directory.map((p) => new Option(p.name)));
}

function editPerformer(performer) {
  selectedId = performer?.id ?? null;
  const p = performer ?? { id: '', ...emptyPerformer() };
  dirForm.elements.id.value = p.id;
  dirForm.elements.name.value = p.name;
  dirForm.elements.pronouns.value = p.pronouns;
  dirForm.elements.platform.value = p.social.platform;
  dirForm.elements.handle.value = p.social.handle;
  $('#dir-form-title').textContent = performer ? `Edit ${performer.name}` : 'New performer';
  $('#dir-delete').hidden = !performer;
  renderDirectory();
}

$('#dir-search').addEventListener('input', renderDirectory);
$('#dir-new').addEventListener('click', () => {
  editPerformer(null);
  dirForm.elements.name.focus();
});

$('#dir-list').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (li) editPerformer(directory.find((p) => p.id === li.dataset.id));
});

dirForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const el = dirForm.elements;
  try {
    const { performer } = await request('performers:upsert', {
      id: el.id.value,
      name: el.name.value,
      pronouns: el.pronouns.value,
      social: { platform: el.platform.value, handle: el.handle.value },
    });
    toast(`Saved ${performer.name}.`);
    editPerformer(performer);
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#dir-delete').addEventListener('click', async () => {
  const performer = directory.find((p) => p.id === selectedId);
  if (!performer || !confirm(`Delete ${performer.name} from the directory?`)) return;
  try {
    await request('performers:delete', { id: performer.id });
    toast(`Deleted ${performer.name}.`);
    editPerformer(null);
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ---------- Dashboard tab ---------- */

let timer = null;     // timer state from the server
let clockOffset = 0;  // the server's clock minus this browser's, so every dashboard shows the same time
const serverNow = () => Date.now() + clockOffset;

const ordinal = (n) => `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n] ?? 'th'}`;

// Performers with a name in the saved Live Segment, with their slot number.
function activeRunners() {
  return live ? live.current.performers.flatMap((p, i) => (p.name ? [{ ...p, slot: i }] : [])) : [];
}

// Per-runner finishes only apply in Race Mode with two or more runners; otherwise it's one run.
const raceOn = () => Boolean(timer?.raceMode) && activeRunners().length >= 2;

// Shows the saved Live Segment and Next Segment: what's on stream, not unsaved edits.
function renderDashboard() {
  if (!live) return;
  renderDashSegment('current');
  renderDashSegment('next');
  renderRunners();
  renderTimer();
  refreshDashPromote();
}

function renderDashSegment(key) {
  const section = $(`[data-dash="${key}"]`);
  const role = (name) => $(`[data-role="${name}"]`, section);
  const segment = live[key];
  const type = SEGMENT_TYPES.find((t) => t.id === segment.type);
  const empty = isEmptySegment(segment);
  section.dataset.type = type?.id ?? '';
  role('type').textContent = type?.label ?? '';
  role('type').hidden = !type;
  role('name').textContent = segment.name || 'Untitled segment';
  role('name').hidden = empty;
  role('meta').hidden = empty;
  role('empty').hidden = !empty;
  role('category').textContent = segment.category || 'Not set';
  role('estimate').textContent = segment.estimate || 'Not set';

  // One compact row per performer with a name; empty slots are left out.
  const performers = segment.performers.flatMap((p, i) => (p.name ? [{ ...p, slot: i }] : []));
  role('performers-title').hidden = performers.length === 0;
  role('performers').replaceChildren(...performers.map((performer) => {
    const li = document.createElement('li');
    const cell = (className, text) => {
      const span = document.createElement('span');
      span.className = className;
      span.textContent = text;
      return span;
    };
    li.append(cell('perf-num', performer.slot + 1), cell('perf-name', performer.name));
    if (performer.pronouns) li.append(cell('perf-pronouns', performer.pronouns));
    const social = formatSocial(performer.social);
    if (social) li.append(cell('perf-social', social));
    return li;
  }));
}

/*
  Promoting from the Dashboard: the operator ticks "ready", then Move to Live does the same as
  Edit Segment's button (and Undo move works from either tab). It's only offered when Edit Segment
  has no unsaved changes, so what moves is exactly what the Dashboard shows. If Next Segment
  changes after the box is ticked, the tick is cleared.
*/
let readyFor = null; // the saved Next Segment the operator ticked "ready" for

// Why promotion isn't possible right now, or '' if it is.
function promoteBlocker() {
  if (!socket.connected) return 'Reconnecting to the server…';
  if (isDirty()) return 'Edit Segment has unsaved changes. Save or revert them first.';
  if (isEmptySegment(live.next)) return 'Next Segment is empty.';
  if (!live.next.type) return 'Next Segment needs a segment type. Choose one on Edit Segment.';
  const missing = missingSegmentTypes(promoteNext(live, directory, scheduleItems()));
  if (missing.length) return `${listOf(missing)} needs a segment type before it can move up.`;
  return '';
}

function refreshDashPromote() {
  if (!live) return;
  const blocker = promoteBlocker();
  const box = $('#promote-ready');
  if (blocker || JSON.stringify(live.next) !== readyFor) {
    box.checked = false;
    readyFor = null;
  }
  box.disabled = Boolean(blocker);
  $('#promote-go').disabled = !box.checked;
  $('#promote-note').textContent = blocker;
  $('#promote-note').hidden = !blocker;
}

$('#promote-ready').addEventListener('change', () => {
  readyFor = $('#promote-ready').checked ? JSON.stringify(live.next) : null;
  refreshDashPromote();
});

$('#promote-go').addEventListener('click', async () => {
  if (!$('#promote-ready').checked || promoteBlocker()) return;
  $('#promote-go').disabled = true;
  await promote();
  readyFor = null;
  refreshDashPromote();
});

function renderRunners() {
  const runners = raceOn() ? activeRunners() : [];
  const finishes = runners.map((r) => timer?.finishes[r.slot] ?? null);
  const places = finishPlaces(finishes);
  const canFinish = socket.connected && (timer?.status === 'running' || timer?.status === 'paused');
  const container = $('#runners');
  container.dataset.count = runners.length;

  container.replaceChildren(...runners.map((runner, i) => {
    const card = $('#runner-card').content.firstElementChild.cloneNode(true);
    const finish = finishes[i];
    card.dataset.slot = runner.slot;
    card.classList.toggle('finished', finish !== null);
    $('.runner-num', card).textContent = runner.slot + 1;
    $('.runner-name', card).textContent = runner.name;
    $('.runner-time', card).textContent = finish === null ? '' : formatTimer(finish);
    $('.runner-time', card).hidden = finish === null;
    const place = finish !== null && runners.length > 1 ? places[i] : null;
    if (place) card.dataset.place = place;
    $('.runner-place', card).textContent = place ? ordinal(place) : '';
    $('.runner-place', card).hidden = !$('.runner-place', card).textContent;
    const finishButton = $('[data-finish]', card);
    finishButton.hidden = finish !== null;
    finishButton.disabled = !canFinish;
    finishButton.setAttribute('aria-label', `Finish ${runner.name}`);
    const undoButton = $('[data-unfinish]', card);
    undoButton.hidden = finish === null;
    undoButton.disabled = !socket.connected;
    undoButton.setAttribute('aria-label', `Undo finish for ${runner.name}`);
    return card;
  }));
}

const TIMER_STATUS_TEXT = { stopped: 'Ready', running: 'Running', paused: 'Paused', finished: 'Finished' };

function renderTimer() {
  if (!timer) return;
  const { status } = timer;
  $('.timer').dataset.status = status;
  $('.timer').dataset.race = String(raceOn());
  refreshFlag();
  $('#timer-status').textContent = TIMER_STATUS_TEXT[status];
  const race = raceOn();
  $('#timer-start').hidden = status !== 'stopped';
  $('#timer-pause').hidden = status !== 'running';
  $('#timer-resume').hidden = status !== 'paused';
  // Outside Race Mode the whole run finishes at once, from the timer itself.
  $('#timer-finish').hidden = race || (status !== 'running' && status !== 'paused');
  $('#timer-unfinish').hidden = race || status !== 'finished';
  $('#timer-reset').disabled = status === 'stopped';
  for (const button of $$('.timer-btn')) if (!socket.connected) button.disabled = true;
  if (socket.connected) {
    for (const id of ['#timer-start', '#timer-pause', '#timer-resume', '#timer-finish', '#timer-unfinish']) $(id).disabled = false;
  }

  // Race Mode is offered with two or more performers, and locked once anyone has a finish time.
  const raceButton = $('#timer-race');
  raceButton.hidden = activeRunners().length < 2;
  raceButton.setAttribute('aria-pressed', String(race));
  raceButton.disabled = !socket.connected || timer.finishes.some((t) => t !== null);
  renderClock();
  if (status === 'running') startClock();
}

let shownClock = '';
let clockFrame = null;

function renderClock() {
  const text = formatTimer(timer ? timerElapsed(timer, serverNow()) : 0);
  if (text === shownClock) return;
  shownClock = text;
  setClockText($('#timer-clock'), text);
}

function tick() {
  renderClock();
  clockFrame = timer?.status === 'running' ? requestAnimationFrame(tick) : null;
}

function startClock() {
  if (clockFrame === null) clockFrame = requestAnimationFrame(tick);
}

/*
  Race Mode flag: a checkered flag drawn on a canvas behind the timer, waving in the wind. The flag
  is cut into thin vertical strips; each strip is shifted up or down by a travelling sine wave and
  lit or shaded by the wave's slope. The ripples grow towards the right, like a flag on a pole at
  the left. The middle is faded so the clock stays readable. With reduced motion it is drawn still.
*/
const FLAG = { square: 38, strip: 3, amplitude: 9, wavelength: 150, speed: 2.4, fps: 30 };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let flagFrame = null;
let flagDrawnAt = 0;

function drawFlag(time) {
  const canvas = $('.race-flag');
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const { square, strip, amplitude, wavelength, speed } = FLAG;
  const t = time / 1000;
  for (let x = 0; x < w; x += strip) {
    const phase = (x / wavelength) * 2 * Math.PI - t * speed;
    const grow = 0.3 + 0.7 * (x / w);
    const dy = Math.sin(phase) * amplitude * grow;
    const light = Math.cos(phase) * grow; // -1 (in shadow) to 1 (catching the light)
    const lightSquare = `hsl(220 5% ${44 + light * 12}%)`;
    const darkSquare = `hsl(220 6% ${9 + light * 4}%)`;
    const column = Math.floor(x / square);
    for (let row = -1; row * square < h + square; row++) {
      ctx.fillStyle = (column + row + 2) % 2 === 0 ? darkSquare : lightSquare;
      ctx.fillRect(x, row * square + dy, strip + 0.6, square + 0.6);
    }
  }

  const fade = ctx.createRadialGradient(w / 2, h * 0.42, h * 0.1, w / 2, h * 0.42, Math.max(w, h) * 0.62);
  fade.addColorStop(0, 'rgba(17, 18, 20, .86)');
  fade.addColorStop(0.55, 'rgba(17, 18, 20, .62)');
  fade.addColorStop(1, 'rgba(17, 18, 20, .3)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
}

function flagTick(time) {
  if (time - flagDrawnAt >= 1000 / FLAG.fps) {
    drawFlag(time);
    flagDrawnAt = time;
  }
  flagFrame = requestAnimationFrame(flagTick);
}

// Runs the flag only while it can be seen: Race Mode on and the Dashboard tab open.
function refreshFlag() {
  const visible = $('.timer').dataset.race === 'true' && !$('#tab-dashboard').hidden;
  if (!visible || reduceMotion.matches) {
    cancelAnimationFrame(flagFrame);
    flagFrame = null;
    if (visible) drawFlag(0);
    return;
  }
  if (flagFrame === null) flagFrame = requestAnimationFrame(flagTick);
}

document.addEventListener('tabchange', refreshFlag);
reduceMotion.addEventListener('change', refreshFlag);
// A still flag needs redrawing when the panel changes size; a moving one redraws itself.
new ResizeObserver(() => { if (flagFrame === null) refreshFlag(); }).observe($('.race-flag'));

async function timerAction(action, slot, extra = {}) {
  try {
    await request('timer', { action, slot, ...extra });
  } catch (err) {
    toast(err.message, 'error');
  }
}

$('#timer-start').addEventListener('click', () => timerAction('start'));
$('#timer-pause').addEventListener('click', () => timerAction('pause'));
$('#timer-resume').addEventListener('click', () => timerAction('resume'));
$('#timer-race').addEventListener('click', () => {
  timerAction('race', undefined, { on: $('#timer-race').getAttribute('aria-pressed') !== 'true' });
});
// The clicked button hides itself, so move focus to the one that replaces it.
$('#timer-finish').addEventListener('click', async () => {
  await timerAction('finish');
  $('#timer-unfinish').focus();
});
$('#timer-unfinish').addEventListener('click', async () => {
  await timerAction('unfinish');
  $('#timer-pause').focus();
});
$('#timer-reset').addEventListener('click', async () => {
  const confirmed = await confirmAction({
    title: 'Reset the timer?',
    body: `${timer.status === 'running' ? 'The timer is still running. ' : ''}The time and every finish time go back to zero.`,
    confirm: 'Reset timer',
  });
  if (confirmed) timerAction('reset');
});

$('#runners').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-finish], [data-unfinish]');
  if (!button) return;
  const slot = Number(button.closest('.runner').dataset.slot);
  const action = 'finish' in button.dataset ? 'finish' : 'unfinish';
  await timerAction(action, slot);
  // The cards are redrawn, so put focus on the matching button in the new one.
  $(`#runners [data-slot="${slot}"] ${action === 'finish' ? '[data-unfinish]' : '[data-finish]'}`)?.focus();
});

/* ---------- Schedule tab ---------- */

let schedule = null; // the imported Horaro schedule and its settings, from the server
const scheduleItems = () => schedule?.items ?? [];

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Which schedule rows are in Edit Segment right now: { index: 'Live' | 'Next' | 'Future run N' }.
function scheduleMarks() {
  const marks = {};
  const items = scheduleItems();
  const nextIndex = live?.schedule.nextIndex;
  if (nextIndex === null || nextIndex === undefined || !items[nextIndex]) return marks;
  marks[nextIndex] = 'Next';
  playableAfter(items, nextIndex, FUTURE_RUNS).forEach((index, i) => { marks[index] = `Future run ${i + 1}`; });
  // The run before Next Segment is Live if that's what the Live Segment shows.
  let before = nextIndex - 1;
  while (before >= 0 && items[before].cancelled) before--;
  if (before >= 0 && items[before].name === live.current.name) marks[before] = 'Live';
  return marks;
}

function renderSchedule() {
  if (!schedule) return;
  const items = scheduleItems();
  const { settings } = schedule;

  $('#sched-source').textContent = schedule.name ? `${schedule.name}, ${schedule.link || settings.url}` : settings.url || 'No schedule set';
  renderScheduleTimes();
  $('#sched-error').textContent = schedule.error ? `The last check failed: ${schedule.error}${items.length ? ' Showing the schedule from the last successful check.' : ''}` : '';
  $('#sched-error').hidden = !schedule.error;
  const warnings = schedule.error ? [] : schedule.warnings ?? [];
  $('#sched-warnings').replaceChildren(...warnings.map((w) => Object.assign(document.createElement('li'), { textContent: w })));
  $('#sched-warnings').hidden = warnings.length === 0;

  const following = live && live.schedule.nextIndex !== null && items[live.schedule.nextIndex];
  $('#sched-follow-text').textContent = following
    ? `Edit Segment is following this schedule. ${items[live.schedule.nextIndex].name || 'The marked run'} is in Next Segment.`
    : 'Edit Segment isn\'t following the schedule. Choose Load as Next on a run to fill Next Segment and Future runs from it.';
  $('#sched-follow').dataset.following = String(Boolean(following));
  $('#sched-unlink').hidden = !following;

  $('#sched-empty').hidden = items.length > 0;
  $('#sched-empty').textContent = !settings.url
    ? 'No Horaro schedule is set. Add its address on the Settings tab.'
    : schedule.fetchedAt ? 'This schedule has no runs yet.' : 'The schedule hasn\'t been imported yet.';
  $('#sched-table').hidden = items.length === 0;

  const marks = scheduleMarks();
  // Each day is its own group. Its heading sticks under the header row, and since a sticky element
  // can't leave its own group, the next day's group pushes the old heading up and out of view.
  const days = [];
  let group = null;
  let day = null;
  for (const item of items) {
    const itemDay = item.scheduled ? dayFormat.format(item.scheduled) : '';
    if (!group || itemDay !== day) {
      day = itemDay;
      group = document.createElement('div');
      group.className = 'sched-group';
      group.setAttribute('role', 'rowgroup');
      if (day) {
        group.setAttribute('aria-label', day);
        const heading = document.createElement('div');
        heading.className = 'sched-day';
        heading.setAttribute('role', 'row');
        const text = document.createElement('span');
        text.setAttribute('role', 'columnheader');
        text.setAttribute('aria-colspan', '6');
        text.textContent = day;
        heading.append(text);
        group.append(heading);
      }
      days.push(group);
    }
    group.append(scheduleRow(item, marks[item.index]));
  }
  $$('#sched-table > .sched-group').forEach((old) => old.remove());
  $('#sched-table').append(...days);
}

// The sticky rows sit below the page's top bar (taller on phones, where the tabs wrap), and the day
// heading below the table's header row, so both heights are kept in CSS variables.
new ResizeObserver(() => {
  const style = document.documentElement.style;
  style.setProperty('--topbar-height', `${$('.topbar').offsetHeight}px`);
  style.setProperty('--sched-head-height', `${$('.sched-colhead').offsetHeight}px`);
}).observe($('.topbar'));
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--sched-head-height', `${$('.sched-colhead').offsetHeight}px`);
}).observe($('.sched-colhead'));

function scheduleRow(item, mark) {
  const tr = document.createElement('div');
  tr.className = 'sched-row';
  tr.setAttribute('role', 'row');
  tr.dataset.index = item.index;
  if (item.cancelled) tr.classList.add('cancelled');
  if (mark) tr.dataset.mark = mark.startsWith('Future') ? 'future' : mark.toLowerCase();
  const cell = (text, className) => {
    const td = document.createElement('div');
    td.setAttribute('role', 'cell');
    if (className) td.className = className;
    td.textContent = text;
    return td;
  };

  const segment = document.createElement('div');
  segment.setAttribute('role', 'cell');
  segment.className = 'sched-segment';
  const name = document.createElement('span');
  name.className = 'sched-name';
  name.textContent = item.name || 'Untitled';
  segment.append(name);
  if (mark) {
    const chip = document.createElement('span');
    chip.className = 'sched-mark';
    chip.textContent = mark;
    segment.append(chip);
  }
  if (item.category) {
    const category = document.createElement('span');
    category.className = 'sched-category';
    category.textContent = item.category;
    segment.append(category);
  }

  const type = SEGMENT_TYPES.find((t) => t.id === item.type);
  const typeCell = document.createElement('div');
  typeCell.setAttribute('role', 'cell');
  const pill = document.createElement('span');
  pill.className = 'sched-type';
  pill.dataset.type = item.type;
  pill.textContent = type?.label ?? '';
  typeCell.append(pill);

  const actions = document.createElement('div');
  actions.setAttribute('role', 'cell');
  actions.className = 'sched-actions';
  if (!item.cancelled) {
    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'btn small';
    load.dataset.load = item.index;
    load.textContent = 'Load as Next';
    load.setAttribute('aria-label', `Load ${item.name || 'this run'} as Next Segment`);
    actions.append(load);
  }

  tr.append(
    cell(item.scheduled ? timeFormat.format(item.scheduled) : '', 'sched-time'),
    segment,
    cell(item.performers, 'sched-performers'),
    cell(item.estimate, 'sched-estimate'),
    typeCell,
    actions,
  );
  return tr;
}

// "Last checked at 2:41 PM. Horaro schedule last changed Jan 11, 5:31 AM. Next check at 2:46 PM."
function renderScheduleTimes() {
  if (!schedule) return;
  const parts = [];
  if (schedule.checkedAt) parts.push(`Last checked at ${timeFormat.format(schedule.checkedAt)}.`);
  if (schedule.horaroUpdated) parts.push(`Horaro schedule last changed ${dateTimeFormat.format(schedule.horaroUpdated)}.`);
  if (schedule.nextCheckAt) parts.push(`Next check at ${timeFormat.format(schedule.nextCheckAt)}.`);
  $('#sched-updated').textContent = parts.join(' ') || 'Not checked yet.';
}

$('#sched-refresh').addEventListener('click', async () => {
  const button = $('#sched-refresh');
  button.disabled = true;
  button.textContent = 'Refreshing…';
  try {
    const { updatedEditSegment } = await request('schedule:refresh', undefined, 30000);
    toast(updatedEditSegment ? 'Schedule refreshed. Edit Segment was updated with the changes.' : 'Schedule refreshed.');
  } catch (err) {
    toast(`Schedule not refreshed: ${err.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Refresh schedule';
  }
});

$('#sched-table').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-load]');
  if (!button) return;
  const item = scheduleItems()[Number(button.dataset.load)];
  if (isDirty()) return toast('Edit Segment has unsaved changes. Save or revert them before loading from the schedule.', 'error');
  const confirmed = await confirmAction({
    title: `Load ${item.name || 'this run'} as Next Segment?`,
    body: 'Next Segment and Future runs are replaced with this run and the four after it, and saved straight away. After that, they follow the schedule. Live Segment doesn\'t change.',
    confirm: 'Load as Next',
  });
  if (!confirmed) return;
  try {
    await request('schedule:load', { index: item.index });
    toast(`${item.name || 'The run'} is in Next Segment.`);
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#sched-unlink').addEventListener('click', async () => {
  try {
    await request('schedule:unlink');
    toast('Edit Segment stopped following the schedule. Its rows are kept as they are.');
  } catch (err) {
    toast(err.message, 'error');
  }
});

// Keep "Next check at" honest as time passes.
setInterval(renderScheduleTimes, 30_000);

/* ---------- Settings tab: Horaro schedule ---------- */

const scheduleForm = $('#schedule-form');
let scheduleFormTouched = false;

function writeScheduleForm(settings) {
  const el = scheduleForm.elements;
  el.url.value = settings.url;
  el.hiddenKey.value = settings.hiddenKey;
  for (const key of ['name', 'category', 'performers', 'type']) el[`col-${key}`].value = settings.columns[key];
  el.hostKeyword.value = settings.hostKeyword;
  el.stripPrefixes.checked = settings.stripPrefixes;
  el.intervalMinutes.value = settings.intervalMinutes;
  refreshStripLabel();
}

function readScheduleForm() {
  const el = scheduleForm.elements;
  return {
    url: el.url.value,
    hiddenKey: el.hiddenKey.value,
    columns: { name: el['col-name'].value, category: el['col-category'].value, performers: el['col-performers'].value, type: el['col-type'].value },
    hostKeyword: el.hostKeyword.value,
    stripPrefixes: el.stripPrefixes.checked,
    intervalMinutes: Number(el.intervalMinutes.value),
  };
}

function refreshStripLabel() {
  const keyword = scheduleForm.elements.hostKeyword.value.trim();
  $('#strip-label').textContent = `Remove "Speedrun - "${keyword ? ` and "${keyword} - "` : ''} from the start of categories`;
}

// The form follows the server's settings until the operator starts editing it.
function applyScheduleMessage(message) {
  schedule = message;
  if (!scheduleFormTouched) writeScheduleForm(message.settings);
  $('#horaro-columns').replaceChildren(...(message.columns ?? []).map((c) => new Option(c)));
  renderSchedule();
  refreshRunStatus();
}

scheduleForm.addEventListener('input', () => {
  scheduleFormTouched = true;
  refreshStripLabel();
});

scheduleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('#schedule-save');
  button.disabled = true;
  button.textContent = 'Importing…';
  try {
    const { error } = await request('schedule:settings', readScheduleForm(), 30000);
    scheduleFormTouched = false;
    writeScheduleForm(schedule.settings);
    if (error) toast(`Settings saved, but the import failed: ${error}`, 'warn');
    else toast(`Schedule imported: ${scheduleItems().length} ${scheduleItems().length === 1 ? 'segment' : 'segments'}.`);
  } catch (err) {
    toast(`Settings not saved: ${err.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Save and import';
  }
});

$('#schedule-reset').addEventListener('click', async () => {
  const confirmed = await confirmAction({
    title: 'Reset the schedule data?',
    body: 'The imported schedule is deleted and the Horaro settings go back to their defaults. Edit Segment stops following the schedule, but its rows are kept. A backup copy is saved in data/backups first.',
    confirm: 'Reset schedule data',
    danger: true,
  });
  if (!confirmed) return;
  try {
    const { backup } = await request('schedule:reset', undefined, 30000);
    scheduleFormTouched = false;
    writeScheduleForm(schedule.settings);
    toast(`Schedule data reset. Backup saved in ${backup}.`);
  } catch (err) {
    toast(`Schedule data not reset: ${err.message}`, 'error');
  }
});

/* ---------- Settings tab: reset all data ---------- */

$('#reset-all').addEventListener('click', async () => {
  const confirmed = await confirmAction({
    title: 'Nuclear reset: erase all data and settings?',
    body: 'Every performer, all segments and Future runs, the timer, the imported schedule, and every setting (Horaro, Twitch connection, output folder, file locations, timer font) are erased, and every OBS text file is written blank. A backup copy is saved in data/backups first.',
    confirm: 'Reset All Data',
    danger: true,
  });
  if (!confirmed) return;
  try {
    const { backup, warnings } = await request('data:reset', undefined, 30000);
    scheduleFormTouched = false;
    writeScheduleForm(schedule.settings);
    writeSettingsForm(savedSettings);
    refreshSettingsStatus();
    writeRunForm(live);
    refreshRunStatus();
    editPerformer(null);
    if (warnings?.length) toast(`Data reset, but some text files couldn't be cleared: ${warnings.join('; ')}`, 'warn');
    else toast(`All data reset. Backup saved in ${backup}.`);
  } catch (err) {
    toast(`Data not reset: ${err.message}`, 'error');
  }
});

/* ---------- Timer font ---------- */

let timerFontKey = null;

// Loads the uploaded font under a name unique to its version, so a new upload replaces the old one.
async function applyTimerFont(font) {
  $('#font-current').textContent = font ? `Using ${font.name}.` : 'Using the default font.';
  $('#font-clear').hidden = !font;
  const key = font ? `${font.ext}-${font.version}` : null;
  if (key === timerFontKey) return;
  timerFontKey = key;
  try {
    await useTimerFont(font);
  } catch {
    toast(`The timer font ${font.name} couldn't be loaded.`, 'error');
  }
}

async function fontRequest(method, init = {}) {
  const res = await fetch('/api/timer-font', { method, ...init });
  const reply = await res.json().catch(() => ({ ok: false, error: `The server replied with ${res.status}.` }));
  if (!reply.ok) throw new Error(reply.error);
  return reply;
}

$('#font-upload').addEventListener('click', () => $('#font-file').click());

$('#font-file').addEventListener('change', async () => {
  const file = $('#font-file').files[0];
  $('#font-file').value = '';
  if (!file) return;
  try {
    const { font } = await fontRequest('PUT', { headers: { 'X-Filename': encodeURIComponent(file.name) }, body: file });
    toast(`Timer font set to ${font.name}.`);
  } catch (err) {
    toast(`Font not uploaded: ${err.message}`, 'error');
  }
});

$('#font-clear').addEventListener('click', async () => {
  try {
    await fontRequest('DELETE');
    toast('Timer font set back to the default.');
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ---------- Dashboard: Twitch title and category ---------- */

let twitch = null;           // status from the server (never includes the secret or tokens)
let shownChannel = null;     // the channel values the form was last filled from
let chosenCategory = null;   // { id, name, boxArt } picked in the category search
let searchTimer = null;
let searchResults = [];
let activeResult = -1;

const twitchForm = $('#twitch-form');
const categoryInput = $('#twitch-category');
$('#twitch-art').addEventListener('error', (e) => { e.target.hidden = true; });

function applyTwitch(status) {
  const firstStatus = twitch === null;
  const previousReminder = twitch?.reminder?.at ?? null;
  twitch = status;
  const connected = status.connected;
  $('#twitch-panel').dataset.state = connected ? 'on' : 'off';

  // The Live Segment changed since Twitch was last updated: highlight the box and say so.
  const reminder = connected ? status.reminder : null;
  $('#twitch-panel').dataset.reminder = String(Boolean(reminder));
  $('#twitch-reminder').hidden = !reminder;
  if (reminder) {
    $('#twitch-reminder-text').textContent = `The Live Segment changed${reminder.segment ? ` to ${reminder.segment}` : ''}. Update the Twitch title and category to match.`;
    // From another tab, point the operator to the Dashboard.
    if (!firstStatus && reminder.at !== previousReminder && $('#tab-dashboard').hidden) {
      toast('Live Segment changed: update the Twitch title on the Dashboard.', 'warn');
    }
  }
  $('#twitch-off').hidden = connected;
  twitchForm.hidden = !connected;
  const channelLink = $('#twitch-channel');
  channelLink.hidden = !connected;
  if (connected) {
    channelLink.textContent = `twitch.tv/${status.user.login}`;
    channelLink.href = `https://twitch.tv/${status.user.login}`;
  }
  $('#twitch-error').textContent = status.error ?? '';
  $('#twitch-error').hidden = !status.error;

  // Fill the form from Twitch, leaving fields the operator is editing alone.
  const channel = status.channel;
  if (channel) {
    const before = shownChannel;
    if (!before || twitchForm.elements.title.value === before.title) twitchForm.elements.title.value = channel.title;
    if (!before || (chosenCategory?.id ?? '') === before.gameId) {
      chosenCategory = { id: channel.gameId, name: channel.gameName, boxArt: before?.gameId === channel.gameId ? chosenCategory?.boxArt : '' };
      categoryInput.value = channel.gameName;
    }
    shownChannel = channel;
  }
  refreshTwitchForm();
  applyTwitchSettings(status);
}

function refreshTwitchForm() {
  if (!twitch?.connected || !shownChannel) return;
  const title = twitchForm.elements.title;
  const typed = categoryInput.value.trim();
  // A typed category only counts once it's picked from the list; an empty box clears the category.
  const category = typed === '' ? { id: '', name: '' } : chosenCategory && chosenCategory.name === typed ? chosenCategory : null;
  const titleChanged = title.value.trim() !== shownChannel.title;
  const categoryChanged = category ? category.id !== shownChannel.gameId : true;
  title.classList.toggle('dirty', titleChanged);
  categoryInput.classList.toggle('dirty', categoryChanged);
  $('#twitch-count').textContent = `${title.value.length}/${TITLE_MAX}`;
  $('#twitch-count').classList.toggle('over', title.value.length > TITLE_MAX);
  $('#twitch-category-hint').textContent = category ? '' : 'Pick a category from the list.';
  $('#twitch-art').hidden = !category?.boxArt;
  if (category?.boxArt) $('#twitch-art').src = category.boxArt;
  const valid = category && title.value.trim() && title.value.length <= TITLE_MAX;
  $('#twitch-update').disabled = !(titleChanged || categoryChanged) || !valid || !socket.connected;
  $('#twitch-revert').disabled = !(titleChanged || categoryChanged);
}

/* Category search: a combobox listing Twitch's matches as you type. */
function showResults(results) {
  searchResults = results;
  activeResult = -1;
  const list = $('#twitch-results');
  list.replaceChildren(...results.map((result, i) => {
    const li = document.createElement('li');
    li.id = `twitch-result-${i}`;
    li.setAttribute('role', 'option');
    li.dataset.index = i;
    // Box art comes from Twitch's image server; if it can't be loaded, leave it out.
    if (result.boxArt) li.append(Object.assign(document.createElement('img'), { src: result.boxArt, alt: '', onerror: (e) => e.target.remove() }));
    li.append(document.createTextNode(result.name));
    return li;
  }));
  if (!results.length) {
    const li = document.createElement('li');
    li.className = 'combo-empty';
    li.textContent = 'No matching categories.';
    list.append(li);
  }
  list.hidden = false;
  categoryInput.setAttribute('aria-expanded', 'true');
}

function closeResults() {
  $('#twitch-results').hidden = true;
  categoryInput.setAttribute('aria-expanded', 'false');
  categoryInput.removeAttribute('aria-activedescendant');
  activeResult = -1;
}

function pickCategory(result) {
  chosenCategory = result;
  categoryInput.value = result.name;
  closeResults();
  refreshTwitchForm();
}

async function searchCategories(query, { pickExact = false } = {}) {
  if (!query.trim()) return closeResults();
  try {
    const { categories } = await request('twitch:search', { query }, 15000);
    if (categoryInput.value.trim() !== query.trim()) return; // typed on since
    const exact = categories.find((c) => c.name.toLowerCase() === query.trim().toLowerCase());
    if (pickExact && exact) pickCategory(exact);
    else showResults(categories);
  } catch (err) {
    toast(`Category search failed: ${err.message}`, 'error');
  }
}

categoryInput.addEventListener('input', () => {
  refreshTwitchForm();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => searchCategories(categoryInput.value), 250);
});

categoryInput.addEventListener('keydown', (e) => {
  const open = !$('#twitch-results').hidden && searchResults.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!open) return;
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    activeResult = (activeResult + step + searchResults.length) % searchResults.length;
    $$('#twitch-results [role=option]').forEach((li, i) => li.setAttribute('aria-selected', String(i === activeResult)));
    categoryInput.setAttribute('aria-activedescendant', `twitch-result-${activeResult}`);
  } else if (e.key === 'Enter' && open && activeResult >= 0) {
    e.preventDefault();
    pickCategory(searchResults[activeResult]);
  } else if (e.key === 'Escape') {
    closeResults();
  }
});

// mousedown, so the pick happens before the input loses focus and the list closes.
$('#twitch-results').addEventListener('mousedown', (e) => {
  const li = e.target.closest('[role=option]');
  if (!li) return;
  e.preventDefault();
  pickCategory(searchResults[Number(li.dataset.index)]);
});
categoryInput.addEventListener('blur', () => setTimeout(closeResults, 100));

twitchForm.elements.title.addEventListener('input', refreshTwitchForm);

// Fills the title from the Live Segment, and for a run looks up its game as the category.
$('#twitch-fill').addEventListener('click', () => {
  if (!live || isEmptySegment(live.current)) return toast('Nothing is live yet.', 'warn');
  twitchForm.elements.title.value = fillTitle(twitch.titleTemplate, live.current);
  if (live.current.type === 'core' && live.current.name) {
    categoryInput.value = live.current.name;
    chosenCategory = null;
    searchCategories(live.current.name, { pickExact: true });
  }
  refreshTwitchForm();
  twitchForm.elements.title.focus();
});

$('#twitch-dismiss').addEventListener('click', () => {
  request('twitch:dismiss').catch((err) => toast(err.message, 'error'));
});

$('#twitch-revert').addEventListener('click', () => {
  twitchForm.elements.title.value = shownChannel.title;
  categoryInput.value = shownChannel.gameName;
  chosenCategory = { id: shownChannel.gameId, name: shownChannel.gameName, boxArt: '' };
  closeResults();
  refreshTwitchForm();
});

twitchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('#twitch-update').disabled) return;
  const typed = categoryInput.value.trim();
  const gameId = typed === '' ? '' : chosenCategory.id;
  $('#twitch-update').disabled = true;
  try {
    const { channel } = await request('twitch:update', { title: twitchForm.elements.title.value, gameId }, 20000);
    shownChannel = channel;
    twitchForm.elements.title.value = channel.title;
    categoryInput.value = channel.gameName;
    chosenCategory = { ...chosenCategory, id: channel.gameId, name: channel.gameName };
    toast('Twitch title and category updated.');
  } catch (err) {
    toast(`Twitch not updated: ${err.message}`, 'error');
  } finally {
    refreshTwitchForm();
  }
});

/* ---------- Settings tab: Twitch ---------- */

const twitchSettings = $('#twitch-settings');
let twitchSettingsTouched = false;
const onLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

function applyTwitchSettings(status) {
  const el = twitchSettings.elements;
  $('#twitch-redirect').value = status.redirectUri;
  $('#twitch-local-address').textContent = new URL(status.redirectUri).origin;
  if (!twitchSettingsTouched) {
    el.clientId.value = status.clientId;
    el.clientSecret.value = '';
    el.titleTemplate.value = status.titleTemplate;
  }
  el.clientSecret.placeholder = status.hasSecret ? 'Saved. Leave blank to keep it.' : '';
  refreshTemplatePreview();

  $('#twitch-connection').dataset.connected = String(status.connected);
  $('#twitch-connection-text').textContent = status.connected
    ? `Connected as ${status.user.displayName} (twitch.tv/${status.user.login}).`
    : status.configured ? 'Not connected yet.' : 'Save the Client ID and Client Secret, then connect.';
  const connect = $('#twitch-connect');
  connect.textContent = status.connected ? 'Connect a different account' : 'Connect Twitch account';
  connect.classList.toggle('is-disabled', !status.configured);
  connect.setAttribute('aria-disabled', String(!status.configured));
  $('#twitch-disconnect').hidden = !status.connected;
  // Twitch only sends the sign-in back to the registered address, which is on the OBS PC.
  const note = $('#twitch-localhost-note');
  note.hidden = onLocalhost;
  note.textContent = `You're using the dashboard from another computer. Twitch sends the sign-in back to ${new URL(status.redirectUri).origin}, so click Connect on the OBS PC itself.`;
}

twitchSettings.addEventListener('input', () => {
  twitchSettingsTouched = true;
  refreshTemplatePreview();
});

// Under the template: an error for placeholders it can't fill, and the title it would make now.
function refreshTemplatePreview() {
  const template = twitchSettings.elements.titleTemplate.value;
  const unknown = unknownPlaceholders(template);
  const error = $('#twitch-template-error');
  error.hidden = unknown.length === 0;
  error.textContent = `${unknown.join(', ')} ${unknown.length > 1 ? 'aren\'t placeholders' : 'isn\'t a placeholder'}. Use ${TITLE_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}.`;
  twitchSettings.elements.titleTemplate.classList.toggle('invalid', unknown.length > 0);
  $('#twitch-save').disabled = unknown.length > 0;
  const preview = $('#twitch-template-preview');
  preview.textContent = live && !isEmptySegment(live.current)
    ? `With the Live Segment now: ${fillTitle(template, live.current) || '(empty)'}`
    : 'A preview appears here once something is live.';
}

$('#twitch-connect').addEventListener('click', (e) => {
  if (!twitch?.configured) {
    e.preventDefault();
    toast('Save the Client ID and Client Secret first.', 'warn');
  } else if (twitchSettingsTouched) {
    e.preventDefault();
    toast('Save your Twitch changes before connecting.', 'warn');
  }
});

twitchSettings.addEventListener('submit', async (e) => {
  e.preventDefault();
  const el = twitchSettings.elements;
  try {
    await request('twitch:settings', { clientId: el.clientId.value, clientSecret: el.clientSecret.value, titleTemplate: el.titleTemplate.value });
    twitchSettingsTouched = false;
    applyTwitchSettings(twitch);
    toast('Twitch settings saved.');
  } catch (err) {
    toast(`Twitch settings not saved: ${err.message}`, 'error');
  }
});

$('#twitch-disconnect').addEventListener('click', async () => {
  const confirmed = await confirmAction({
    title: 'Disconnect the Twitch account?',
    body: 'The Dashboard will stop being able to change the stream title and category until the account is connected again. The Client ID and Secret are kept.',
    confirm: 'Disconnect',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await request('twitch:disconnect', undefined, 20000);
    toast('Twitch account disconnected.');
  } catch (err) {
    toast(err.message, 'error');
  }
});

// Coming back from Twitch's sign-in page: say how it went, then tidy the address.
{
  const result = new URLSearchParams(location.search).get('twitch');
  if (result) {
    if (result === 'connected') toast('Twitch account connected.');
    else toast(`Twitch not connected: ${result.replace(/^error:/, '')}`, 'error');
    history.replaceState(null, '', location.pathname + location.hash);
  }
}

/* ---------- Copy fields (OBS page addresses) ---------- */

// The address as this browser reached the server, so it works from wherever the Dashboard does.
$('#timer-url').value = new URL('/overlay/timer.html', location.origin).href;
$('#timer-url-open').href = $('#timer-url').value;
$('#timer-url').addEventListener('focus', (e) => e.target.select());

// The Clipboard API only works on https or localhost, so fall back to the older copy command.
async function copyText(input) {
  try {
    await navigator.clipboard.writeText(input.value);
    return true;
  } catch {
    input.select();
    return document.execCommand('copy');
  }
}

document.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-copy]');
  if (!button) return;
  const input = document.getElementById(button.dataset.copy);
  if (!(await copyText(input))) {
    input.select();
    return toast('Couldn\'t copy automatically. The address is selected, so press Ctrl+C.', 'warn');
  }
  const label = $('span', button);
  button.dataset.copied = '';
  label.textContent = 'Copied';
  toast(`${button.dataset.copyName ?? 'Address'} copied.`);
  clearTimeout(button.copyTimer);
  button.copyTimer = setTimeout(() => {
    delete button.dataset.copied;
    label.textContent = 'Copy';
  }, 2000);
});

/* ---------- Settings tab: Stream Deck ---------- */

const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
let shownMacroKey = null;

// One row per macro: its name, a note, and its address with a Copy button.
function renderMacros(key) {
  if (key === shownMacroKey) return;
  shownMacroKey = key;
  $('#macro-list').replaceChildren(...MACROS.map((macro) => {
    const row = document.createElement('div');
    row.className = 'macro-row';
    const id = `macro-${macro.id}`;
    const about = document.createElement('div');
    about.className = 'macro-about';
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = macro.label;
    about.append(label);
    if (macro.note) about.append(Object.assign(document.createElement('small'), { textContent: macro.note }));
    const field = document.createElement('div');
    field.className = 'copy-field';
    const input = Object.assign(document.createElement('input'), { id, readOnly: true, spellcheck: false });
    input.value = new URL(`/api/macro/${macro.id}?key=${key}`, location.origin).href;
    input.addEventListener('focus', () => input.select());
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn copy-btn';
    copy.dataset.copy = id;
    copy.dataset.copyName = `${macro.label} address`;
    copy.setAttribute('aria-label', `Copy the ${macro.label} address`);
    copy.innerHTML = `${COPY_ICON}<span>Copy</span>`;
    field.append(input, copy);
    row.append(about, field);
    return row;
  }));
}

$('#macro-new-key').addEventListener('click', async () => {
  const confirmed = await confirmAction({
    title: 'Generate a new Stream Deck key?',
    body: 'Every address changes, so the buttons you\'ve already set up stop working until you paste in the new addresses.',
    confirm: 'Generate new key',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await request('macros:new-key');
    toast('New key generated. Update your Stream Deck buttons with the new addresses.');
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ---------- Settings tab ---------- */

const settingsForm = $('#settings-form');
let savedSettings = null; // last saved settings from the server

// One row per output field, grouped like the Edit Segment tab.
function buildSettingsForm() {
  const container = $('#settings-groups');
  for (const group of OUTPUT_GROUPS) {
    const section = document.createElement('section');
    section.className = 'settings-group';
    section.dataset.group = group.id;
    const heading = document.createElement('h3');
    heading.textContent = group.label;
    section.append(heading);

    for (const field of group.fields) {
      const id = `setting-${field.key.replace('.', '-')}`;
      const row = document.createElement('div');
      row.className = 'settings-field';
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = field.label;
      if (field.repeat) {
        const range = document.createElement('small');
        range.textContent = `1–${field.repeat}`;
        label.append(' ', range);
      }
      const input = document.createElement('input');
      input.id = id;
      input.dataset.key = field.key;
      input.placeholder = field.file;
      input.spellcheck = false;
      input.setAttribute('aria-describedby', `${id}-error`);
      const error = document.createElement('p');
      error.id = `${id}-error`;
      error.className = 'field-error';
      error.hidden = true;
      row.append(label, input, error);
      section.append(row);
    }
    container.append(section);
  }
}

const settingsInputs = () => $$('[data-key]', settingsForm);

// Blank locations fall back to their defaults.
function readSettingsForm() {
  return normalizeOutputSettings({
    outputDir: settingsForm.elements.outputDir.value,
    files: Object.fromEntries(settingsInputs().map((input) => [input.dataset.key, input.value])),
  });
}

function writeSettingsForm(settings) {
  settingsForm.elements.outputDir.value = settings.outputDir;
  for (const input of settingsInputs()) input.value = settings.files[input.dataset.key];
}

function settingsDirty() {
  return savedSettings !== null && $$('.dirty', settingsForm).length > 0;
}

function refreshSettingsStatus() {
  if (!savedSettings) return;
  const draft = readSettingsForm();
  const errors = new Map(validateOutputSettings(draft).map((e) => [e.key, e.message]));
  let changes = 0;

  for (const input of settingsInputs()) {
    const key = input.dataset.key;
    const changed = draft.files[key] !== savedSettings.files[key];
    input.classList.toggle('dirty', changed);
    changes += changed;
    const message = errors.get(key);
    input.classList.toggle('invalid', Boolean(message));
    input.setAttribute('aria-invalid', String(Boolean(message)));
    const error = $(`#${input.id}-error`);
    error.textContent = message ?? '';
    error.hidden = !message;
  }
  const folder = settingsForm.elements.outputDir;
  const folderChanged = draft.outputDir !== savedSettings.outputDir;
  folder.classList.toggle('dirty', folderChanged);
  changes += folderChanged;

  $('#settings-save').disabled = !changes || errors.size > 0 || !socket.connected;
  $('#settings-revert').disabled = !changes;
}

// Applies saved settings without clobbering fields the operator is still editing.
function applySettings({ defaultOutputDir, resolvedOutputDir, ...settings }) {
  if (savedSettings === null) {
    writeSettingsForm(settings);
  } else {
    const draft = readSettingsForm();
    const folder = settingsForm.elements.outputDir;
    if (draft.outputDir === savedSettings.outputDir) folder.value = settings.outputDir;
    for (const input of settingsInputs()) {
      const key = input.dataset.key;
      if (draft.files[key] === savedSettings.files[key]) input.value = settings.files[key];
    }
  }
  savedSettings = settings;
  applyTimerFont(settings.timerFont);
  renderMacros(settings.macroKey);
  settingsForm.elements.outputDir.placeholder = defaultOutputDir;
  $('#settings-folder-note').textContent =
    `Leave blank to use the default. A relative path is inside the project folder. Files are currently written to ${resolvedOutputDir}`;
  refreshSettingsStatus();
}

settingsForm.addEventListener('input', refreshSettingsStatus);

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const draft = readSettingsForm();
  if (!settingsDirty() || validateOutputSettings(draft).length) return;
  $('#settings-save').disabled = true;
  try {
    const { warnings } = await request('settings:save', draft);
    writeSettingsForm(draft);
    if (warnings?.length) toast(`Settings saved, but some text files failed: ${warnings.join('; ')}`, 'warn');
    else toast('Settings saved. OBS text files were written to the new locations.');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    refreshSettingsStatus();
  }
});

$('#settings-reset').addEventListener('click', () => {
  writeSettingsForm(defaultOutputSettings());
  refreshSettingsStatus();
});

$('#settings-revert').addEventListener('click', () => {
  writeSettingsForm(savedSettings);
  refreshSettingsStatus();
});

/* ---------- Server connection ---------- */

function setConnection(state, text) {
  const el = $('#conn');
  el.dataset.state = state;
  el.textContent = text;
}

socket.on('connect', () => {
  setConnection('online', 'Connected');
  refreshRunStatus();
  refreshSettingsStatus();
  renderDashboard();
});
socket.on('disconnect', () => {
  setConnection('offline', 'Disconnected, retrying…');
  $('#save').disabled = true;
  $('#advance').disabled = true;
  $('#settings-save').disabled = true;
  renderDashboard();
});
socket.on('live', applyLive);
socket.on('settings', applySettings);
socket.on('schedule', applyScheduleMessage);
socket.on('twitch', applyTwitch);
// Messages for every dashboard, like a Stream Deck Reset waiting for its second press.
socket.on('notice', ({ message, kind }) => toast(message, kind));
socket.on('timer', ({ serverNow: now, ...state }) => {
  clockOffset = now - Date.now();
  timer = state;
  renderRunners();
  renderTimer();
});
socket.on('performers', (list) => {
  directory = list;
  if (selectedId && !directory.some((p) => p.id === selectedId)) editPerformer(null);
  else renderDirectory();
  refreshDirectoryBadges();
});

buildPerformerSlots('current');
buildPerformerSlots('next');
buildFutureRows();
for (const holder of $$('[data-type-picker]', runForm)) buildTypePicker(holder, holder.dataset.typePicker);
$$('[data-platforms]').forEach(fillPlatformOptions);
buildSettingsForm();
editPerformer(null);
refreshRunStatus();
