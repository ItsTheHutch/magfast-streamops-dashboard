import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { ROOT_DIR } from './config.js';
import { createStore } from './store.js';
import { createTextFileWriter } from './outputs/textFiles.js';
import { normalizeOutputSettings, validateOutputSettings } from '../public/shared/outputFiles.js';
import { applyTimerAction } from '../public/shared/timer.js';
import {
  HORARO_BASE,
  createScheduleSync,
  loadIntoLive,
  normalizeScheduleSettings,
  parseScheduleUrl,
  scheduleDefaults,
  syncLive,
  unlink,
} from './schedule.js';
import { createTwitch } from './twitch.js';
import { isEmptySegment } from '../public/shared/model.js';
import { createAccessCheck, isLoopback } from './access.js';
import { MacroError, macroAction } from './macros.js';
import { RESET_WINDOW_MS } from '../public/shared/macros.js';
import { timingSafeEqual } from 'node:crypto';
import { FONT_TYPES, MAX_FONT_BYTES, checkFontUpload, fontPath, removeFontFiles, writeFontFile } from './timerFont.js';

// Builds the HTTP + Socket.IO server without starting it, so tests can run it on a spare port.
export function createApp(config) {
  const store = createStore(config.dataDir);
  const textFiles = createTextFileWriter();

  // The output folder from Settings (relative to the project folder), or the one from config.
  function outputSettings() {
    const { outputDir, files } = store.getSettings();
    return { outputDir: outputDir ? path.resolve(ROOT_DIR, outputDir) : config.outputDir, files };
  }
  const settingsMessage = () => ({
    ...store.getSettings(),
    macroKey: store.getMacroKey(),
    defaultOutputDir: config.outputDir,
    resolvedOutputDir: outputSettings().outputDir,
  });

  // Clients use serverNow to line their clock up with the server's.
  const timerMessage = () => ({ ...store.getTimer(), serverNow: Date.now() });
  // Performer slots with a runner in the Live Segment: the ones that can finish.
  const activeSlots = () => store.getLive().current.performers.flatMap((p, i) => (p.name ? [i] : []));

  // Saves the live state, rewrites the OBS text files and tells every dashboard. If the Live
  // Segment changed in a way the stream title could show, the Dashboard reminds the operator to
  // update Twitch.
  function commitLive(next) {
    const before = titleFields(store.getLive().current);
    const live = store.saveLive(next);
    const { errors } = textFiles.write(live, outputSettings());
    io.emit('live', live);
    if (titleFields(live.current) !== before && !isEmptySegment(live.current)) {
      twitch.remind(live.current.name);
      io.emit('twitch', twitchMessage());
    }
    return { warnings: errors };
  }

  // The parts of a segment a stream title can use (not pronouns, for example).
  const titleFields = (segment) => JSON.stringify([
    segment.type, segment.name, segment.category, segment.estimate,
    segment.performers.map((p) => [p.name, p.social.platform, p.social.handle]),
  ]);

  /* Horaro schedule: imported on start and every few minutes (see src/schedule.js). */
  const defaultScheduleSettings = scheduleDefaults(config.horaro);
  const scheduleSettings = () => normalizeScheduleSettings(store.getSettings().schedule, defaultScheduleSettings);
  const scheduleMessage = () => ({
    items: [],
    ...store.getSchedule(),
    settings: scheduleSettings(),
    nextCheckAt: scheduleSync.nextCheckAt(),
  });
  const scheduleSync = createScheduleSync({
    getSettings: scheduleSettings,
    base: config.horaro?.apiBase ?? HORARO_BASE,
    onResult(result) {
      const now = Date.now();
      store.saveSchedule({ ...result, fetchedAt: now, checkedAt: now, error: null });
      // Rows in Edit Segment that came from the schedule and weren't edited follow the changes.
      const synced = syncLive(store.getLive(), result.items, store.getPerformers());
      if (synced) commitLive(synced);
      io.emit('schedule', scheduleMessage());
      return { updatedEditSegment: Boolean(synced) };
    },
    onError(err) {
      store.saveSchedule({ items: [], ...store.getSchedule(), checkedAt: Date.now(), error: err.message });
      io.emit('schedule', scheduleMessage());
    },
  });

  function resetSchedule() {
    store.clearSchedule();
    store.setScheduleSettings(null);
    if (store.getLive().schedule.nextIndex !== null) commitLive(unlink(store.getLive()));
  }

  /* Twitch: stream title and category (see src/twitch.js). */
  const twitch = createTwitch({ dataDir: config.dataDir, config: config.twitch, port: config.port ?? 3000 });
  const twitchMessage = () => twitch.status();
  let twitchTimer = null;
  // Keeps the Dashboard showing the channel's real title, even if it's changed somewhere else.
  async function pollTwitch() {
    const before = JSON.stringify(twitchMessage());
    await twitch.refreshChannel();
    if (JSON.stringify(twitchMessage()) !== before) io.emit('twitch', twitchMessage());
  }

  // Dashboard buttons and Stream Deck macros both go through here.
  function runTimerAction(payload) {
    const timer = applyTimerAction(store.getTimer(), payload, { now: Date.now(), activeSlots: activeSlots() });
    store.saveTimer(timer);
    io.emit('timer', timerMessage());
  }

  const startup = textFiles.write(store.getLive(), outputSettings());
  for (const error of startup.errors) console.error(`Text file error: ${error}`);

  const app = express();
  const server = http.createServer(app);
  // Only this computer's own dashboard pages may use it (see src/access.js).
  const access = createAccessCheck({ lan: !isLoopback(config.host) });
  const io = new SocketServer(server, { allowRequest: access.allowSocket });
  app.use(access.middleware);

  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, version: process.env.npm_package_version ?? null, node: process.version });
  });

  app.get('/api/live', (req, res) => {
    res.json(store.getLive());
  });

  // Timer font: the raw file is the request body, with its name in the X-Filename header.
  app.put('/api/timer-font', express.raw({ type: () => true, limit: MAX_FONT_BYTES }), (req, res) => {
    try {
      const name = path.basename(decodeURIComponent(req.get('x-filename') ?? ''));
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const ext = checkFontUpload(name, bytes);
      writeFontFile(store.fontsDir, ext, bytes);
      const font = store.setTimerFont({ name, ext, version: Date.now() });
      io.emit('settings', settingsMessage());
      res.json({ ok: true, font });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });
  app.use('/api/timer-font', (err, req, res, next) => {
    const error = err.type === 'entity.too.large' ? 'Font files can be up to 10 MB.' : err.message;
    res.status(err.status ?? 400).json({ ok: false, error });
  });

  app.delete('/api/timer-font', (req, res) => {
    removeFontFiles(store.fontsDir);
    store.setTimerFont(null);
    io.emit('settings', settingsMessage());
    res.json({ ok: true });
  });

  // Twitch sign-in: Settings links to /auth/twitch/start, which sends the operator to Twitch; Twitch
  // sends them back to /auth/twitch/callback. Either way they land on Settings with the result.
  const backToSettings = (res, result) => res.redirect(`/?twitch=${encodeURIComponent(result)}#settings`);
  app.get('/auth/twitch/start', (req, res) => {
    try {
      res.redirect(twitch.authorizeUrl());
    } catch (err) {
      backToSettings(res, `error:${err.message}`);
    }
  });
  app.get('/auth/twitch/callback', async (req, res) => {
    try {
      await twitch.finishSignIn(req.query);
      await twitch.refreshChannel();
      backToSettings(res, 'connected');
    } catch (err) {
      backToSettings(res, `error:${err.message}`);
    } finally {
      io.emit('twitch', twitchMessage());
    }
  });

  // Stream Deck macros: GET or POST /api/macro/<id>?key=<key> (see src/macros.js). They're plain
  // requests, which any web page could also make, so the key is what makes them safe.
  let resetArmedUntil = 0;
  const keyMatches = (given) => {
    const expected = Buffer.from(store.getMacroKey());
    const actual = Buffer.from(String(given ?? ''));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  app.all('/api/macro/:id', (req, res) => {
    const reply = (status, message) => res.status(status).json({ ok: status < 300, message, timer: store.getTimer().status });
    if (!['GET', 'POST'].includes(req.method)) return reply(405, 'Use GET or POST.');
    if (!keyMatches(req.query.key)) return reply(403, 'Wrong or missing key. Copy the address again from Settings.');
    try {
      const payload = macroAction(req.params.id, store.getTimer(), activeSlots());
      if (!payload) return reply(404, `There's no "${req.params.id}" macro.`);
      // Reset needs a second press within a few seconds, since a Stream Deck can't ask first.
      if (payload.action === 'reset' && store.getTimer().status !== 'stopped' && Date.now() > resetArmedUntil) {
        resetArmedUntil = Date.now() + RESET_WINDOW_MS;
        io.emit('notice', { kind: 'warn', message: 'Stream Deck: press Reset again within 3 seconds to reset the timer.' });
        return reply(202, 'Press Reset again within 3 seconds to reset the timer.');
      }
      resetArmedUntil = 0;
      runTimerAction(payload);
      return reply(200, 'Done.');
    } catch (err) {
      return reply(err instanceof MacroError ? err.status : 409, err.message);
    }
  });

  app.get('/fonts/timer', (req, res) => {
    const font = store.getSettings().timerFont;
    if (!font) return res.sendStatus(404);
    res.type(FONT_TYPES[font.ext].contentType).sendFile(fontPath(store.fontsDir, font.ext));
  });

  app.use('/shared', express.static(path.join(ROOT_DIR, 'public', 'shared')));
  app.use('/overlay', express.static(path.join(ROOT_DIR, 'public', 'overlay')));
  app.use('/', express.static(path.join(ROOT_DIR, 'public', 'dashboard')));

  // Runs a socket request handler and replies through the client's ack callback.
  function handle(socket, event, handler) {
    socket.on(event, async (...args) => {
      // The reply callback is always last, so a request sent without a payload still gets an answer.
      const ack = typeof args.at(-1) === 'function' ? args.pop() : null;
      const payload = args[0];
      const reply = ack ?? (() => {});
      try {
        reply({ ok: true, ...(await handler(payload)) });
      } catch (err) {
        console.error(`${event} failed: ${err.message}`);
        reply({ ok: false, error: err.message });
      }
    });
  }

  io.on('connection', (socket) => {
    socket.emit('hello', { serverTime: Date.now() });
    socket.emit('live', store.getLive());
    socket.emit('performers', store.getPerformers());
    socket.emit('settings', settingsMessage());
    socket.emit('timer', timerMessage());
    socket.emit('schedule', scheduleMessage());
    socket.emit('twitch', twitchMessage());

    handle(socket, 'live:save', (payload) => commitLive(payload));

    handle(socket, 'schedule:refresh', () => scheduleSync.refresh());

    handle(socket, 'twitch:settings', (payload) => {
      twitch.saveSettings(payload ?? {});
      io.emit('twitch', twitchMessage());
      return {};
    });

    handle(socket, 'twitch:disconnect', async () => {
      await twitch.disconnect();
      io.emit('twitch', twitchMessage());
      return {};
    });

    handle(socket, 'twitch:refresh', async () => {
      await twitch.refreshChannel();
      io.emit('twitch', twitchMessage());
      return {};
    });

    handle(socket, 'twitch:update', async (payload) => {
      const channel = await twitch.updateChannel(payload ?? {});
      io.emit('twitch', twitchMessage());
      return { channel };
    });

    handle(socket, 'twitch:dismiss', () => {
      twitch.dismissReminder();
      io.emit('twitch', twitchMessage());
      return {};
    });

    handle(socket, 'twitch:search', async (payload) => ({ categories: await twitch.searchCategories(payload?.query) }));

    // Puts a run in Next Segment and the runs after it in Future runs, and follows the schedule.
    handle(socket, 'schedule:load', (payload) => {
      const items = store.getSchedule()?.items ?? [];
      return commitLive(loadIntoLive(store.getLive(), items, Number(payload?.index), store.getPerformers()));
    });

    handle(socket, 'schedule:unlink', () => commitLive(unlink(store.getLive())));

    // Deletes the imported schedule, puts the Horaro settings back to their defaults and stops
    // Edit Segment following the schedule (its rows are kept). A backup is made first.
    handle(socket, 'schedule:reset', async () => {
      const backup = store.backup('schedule-reset');
      resetSchedule();
      await scheduleSync.start();
      io.emit('schedule', scheduleMessage());
      return { backup: path.relative(ROOT_DIR, backup) };
    });

    // Nuclear reset: every piece of data and every setting goes back to a fresh install. The OBS text
    // files are blanked at the old locations and at the default ones. A backup is made first.
    handle(socket, 'data:reset', async () => {
      const backup = store.backup('reset-all');
      const before = textFiles.clearAll(outputSettings());
      resetSchedule();
      store.clearPerformers();
      store.clearLive();
      store.saveSettings({});
      store.newMacroKey();
      removeFontFiles(store.fontsDir);
      store.setTimerFont(null);
      twitch.reset();
      io.emit('twitch', twitchMessage());
      textFiles.reset();
      const after = textFiles.clearAll(outputSettings());
      const errors = [...new Set([...before.errors, ...after.errors])];
      io.emit('settings', settingsMessage());
      io.emit('live', store.getLive());
      io.emit('timer', timerMessage());
      io.emit('performers', store.getPerformers());
      await scheduleSync.start();
      io.emit('schedule', scheduleMessage());
      return { backup: path.relative(ROOT_DIR, backup), warnings: errors };
    });

    handle(socket, 'schedule:settings', async (payload) => {
      const settings = normalizeScheduleSettings(payload, defaultScheduleSettings);
      if (settings.url) parseScheduleUrl(settings.url);
      store.setScheduleSettings(settings);
      await scheduleSync.start();
      io.emit('schedule', scheduleMessage());
      return { error: store.getSchedule()?.error ?? null };
    });

    handle(socket, 'timer', (payload) => {
      runTimerAction(payload ?? {});
      return {};
    });

    handle(socket, 'macros:new-key', () => {
      store.newMacroKey();
      io.emit('settings', settingsMessage());
      return {};
    });

    // New locations are written straight away; files at the old locations are left as they were.
    handle(socket, 'settings:save', (payload) => {
      const settings = normalizeOutputSettings(payload);
      const problems = validateOutputSettings(settings);
      if (problems.length) throw new Error(`Settings not saved: ${problems.map((p) => `${p.key} ${p.message}`).join(' ')}`);
      store.saveSettings(settings);
      textFiles.reset();
      const { errors } = textFiles.write(store.getLive(), outputSettings());
      io.emit('settings', settingsMessage());
      return { warnings: errors };
    });

    handle(socket, 'performers:upsert', (payload) => {
      const entry = store.upsertPerformer(payload);
      io.emit('performers', store.getPerformers());
      return { performer: entry };
    });

    // A spreadsheet import, read and previewed in the browser. A backup is made first.
    handle(socket, 'performers:import', (payload) => {
      if (store.getPerformers().length) store.backup('performer-import');
      const counts = store.importPerformers(payload?.performers, { updateExisting: payload?.updateExisting !== false });
      io.emit('performers', store.getPerformers());
      return counts;
    });

    handle(socket, 'performers:delete', (payload) => {
      store.deletePerformer(payload?.id);
      io.emit('performers', store.getPerformers());
      return {};
    });
  });

  return {
    server,
    io,
    store,
    outputDir: () => outputSettings().outputDir,
    // Starting the server also starts the schedule checks.
    listen(port, host) {
      return new Promise((resolve) => server.listen(port, host, () => {
        scheduleSync.start();
        pollTwitch();
        twitchTimer = setInterval(pollTwitch, 60_000);
        twitchTimer.unref?.();
        resolve(server.address());
      }));
    },
    close() {
      scheduleSync.stop();
      clearInterval(twitchTimer);
      return new Promise((resolve) => io.close(() => resolve()));
    },
  };
}
