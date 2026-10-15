import {
  MAX_PERFORMERS,
  SOCIAL_PLATFORMS,
  emptyLive,
  emptyPerformer,
  findPerformer,
  formatSocial,
  normalizeLive,
} from '/shared/model.js';

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
function request(event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, payload, (err, reply) => {
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
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 8000 : 3500);
}

function fillPlatformOptions(select) {
  for (const { id, label } of SOCIAL_PLATFORMS) select.add(new Option(label, id));
}

/* ---------- Tabs ---------- */

function showTab(name) {
  const tabs = $$('.tab');
  if (!tabs.some((t) => t.dataset.tab === name)) name = 'run';
  for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  for (const panel of $$('.panel')) panel.hidden = panel.id !== `tab-${name}`;
  history.replaceState(null, '', `#${name}`);
}

for (const tab of $$('.tab')) tab.addEventListener('click', () => showTab(tab.dataset.tab));
showTab(location.hash.slice(1));

/* ---------- Run tab ---------- */

const runForm = $('#run-form');

function buildPerformerSlots() {
  const template = $('#performer-slot');
  const container = $('#performer-slots');
  for (let i = 0; i < MAX_PERFORMERS; i++) {
    const slot = template.content.firstElementChild.cloneNode(true);
    slot.dataset.slot = i;
    $('h3', slot).textContent = `Performer ${i + 1}`;
    for (const field of $$('[data-field]', slot)) {
      field.dataset.path = `current.performers.${i}.${field.dataset.field}`;
    }
    container.append(slot);
  }
  $$('[data-platforms]').forEach(fillPlatformOptions);
}

const runFields = () => $$('[data-path]', runForm);

// The form as a normalized live object (the same shape the server saves).
function readRunForm() {
  const draft = emptyLive();
  for (const field of runFields()) setPath(draft, field.dataset.path, field.value);
  return normalizeLive(draft);
}

function writeRunForm(state) {
  for (const field of runFields()) field.value = getPath(state, field.dataset.path);
}

function isDirty() {
  return live !== null && runFields().some((f) => f.classList.contains('dirty'));
}

function refreshRunStatus() {
  if (!live) return;
  const draft = readRunForm();
  for (const field of runFields()) {
    field.classList.toggle('dirty', getPath(draft, field.dataset.path) !== getPath(live, field.dataset.path));
  }
  const dirty = isDirty();
  $('#dirty-note').hidden = !dirty;
  $('#save').disabled = !dirty || !socket.connected;
  $('#revert').disabled = !dirty;
  refreshDirectoryBadges();
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
      if (getPath(draft, path) === getPath(live, path)) field.value = getPath(next, path);
    }
  }
  live = next;
  refreshRunStatus();
}

function slotFields(slot) {
  const field = (name) => $(`[data-field="${name}"]`, slot);
  return {
    name: field('name'),
    pronouns: field('pronouns'),
    platform: field('social.platform'),
    handle: field('social.handle'),
    twitch: field('twitch'),
  };
}

function fillSlot(slot, performer) {
  const f = slotFields(slot);
  f.name.value = performer.name;
  f.pronouns.value = performer.pronouns;
  f.platform.value = performer.social.platform;
  f.handle.value = performer.social.handle;
  f.twitch.value = performer.twitch;
}

async function save() {
  if (!isDirty()) return;
  $('#save').disabled = true;
  try {
    const { warnings } = await request('live:save', readRunForm());
    if (warnings?.length) toast(`Saved, but some text files failed: ${warnings.join('; ')}`, 'warn');
    else toast('Saved: OBS text files updated.');
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
  } finally {
    refreshRunStatus();
  }
}

runForm.addEventListener('input', refreshRunStatus);
runForm.addEventListener('submit', (e) => e.preventDefault());

// Picking a known name fills in the rest of that performer's details.
runForm.addEventListener('change', (e) => {
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
  const index = Number(slot.dataset.slot);

  if (button.dataset.action === 'clear') {
    fillSlot(slot, emptyPerformer());
    refreshRunStatus();
    return;
  }

  if (button.dataset.action === 'to-directory') {
    const performer = readRunForm().current.performers[index];
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

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (isDirty()) e.preventDefault();
});

/* ---------- Performers tab ---------- */

const dirForm = $('#dir-form');
let selectedId = null;

function renderDirectory() {
  const query = $('#dir-search').value.trim().toLowerCase();
  const list = $('#dir-list');
  const shown = directory.filter((p) => !query || p.name.toLowerCase().includes(query));

  list.replaceChildren(...shown.map((p) => {
    const li = document.createElement('li');
    li.dataset.id = p.id;
    if (p.id === selectedId) li.setAttribute('aria-current', 'true');
    const name = document.createElement('span');
    name.textContent = p.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = [p.pronouns, formatSocial(p.social)].filter(Boolean).join(' · ');
    li.append(name, meta);
    return li;
  }));

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
  dirForm.elements.twitch.value = p.twitch;
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
      twitch: el.twitch.value,
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

/* ---------- Server connection ---------- */

function setConnection(state, text) {
  const el = $('#conn');
  el.dataset.state = state;
  el.textContent = text;
}

socket.on('connect', () => {
  setConnection('online', 'Connected');
  refreshRunStatus();
});
socket.on('disconnect', () => {
  setConnection('offline', 'Disconnected, retrying…');
  $('#save').disabled = true;
});
socket.on('live', applyLive);
socket.on('performers', (list) => {
  directory = list;
  if (selectedId && !directory.some((p) => p.id === selectedId)) editPerformer(null);
  else renderDirectory();
  refreshDirectoryBadges();
});

buildPerformerSlots();
editPerformer(null);
