// The speedrun timer, shared by the server (which owns the state) and the browser (which shows it).
//
// Times are milliseconds. While running, elapsed = banked + (now - startedAt), using the server's
// clock. Normally the run finishes as a whole. In Race Mode (two or more performers) each
// performer slot records its own finish time, and the timer stops when every runner has finished.
// Undoing a finish after the timer stops carries on as if it never stopped.

import { MAX_PERFORMERS } from './model.js';

export const TIMER_STATUSES = ['stopped', 'running', 'paused', 'finished'];

export function emptyTimer() {
  return {
    status: 'stopped',
    raceMode: false,
    banked: 0,         // time counted before the current running stretch
    startedAt: null,   // when the current running stretch began
    stoppedAt: null,   // when the last runner finished
    finishes: Array.from({ length: MAX_PERFORMERS }, () => null),
  };
}

const asTime = (value) => (Number.isFinite(value) && value >= 0 ? value : null);

export function normalizeTimer(raw) {
  const t = raw !== null && typeof raw === 'object' ? raw : {};
  const status = TIMER_STATUSES.includes(t.status) ? t.status : 'stopped';
  const finishes = Array.isArray(t.finishes) ? t.finishes : [];
  return {
    status,
    raceMode: t.raceMode === true,
    banked: asTime(t.banked) ?? 0,
    startedAt: status === 'running' ? asTime(t.startedAt) ?? Date.now() : null,
    stoppedAt: status === 'finished' ? asTime(t.stoppedAt) : null,
    finishes: Array.from({ length: MAX_PERFORMERS }, (_, i) => asTime(finishes[i])),
  };
}

export function timerElapsed(timer, now) {
  return timer.status === 'running' ? timer.banked + Math.max(0, now - timer.startedAt) : timer.banked;
}

// 1:23:45.6 (hours always shown, like estimates).
export function formatTimer(ms) {
  const tenths = Math.floor(ms / 100);
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(tenths / 36000);
  const m = Math.floor(tenths / 600) % 60;
  const s = Math.floor(tenths / 10) % 60;
  return `${h}:${pad(m)}:${pad(s)}.${tenths % 10}`;
}

// Places for finished runners, e.g. [1, null, 2, null]. Ties share a place.
export function finishPlaces(finishes) {
  const times = finishes.filter((t) => t !== null);
  return finishes.map((t) => (t === null ? null : 1 + times.filter((other) => other < t).length));
}

// Race Mode only counts with two or more runners; with one, it's a single run.
export function isRace(timer, activeSlots) {
  return timer.raceMode && activeSlots.length >= 2;
}

// Applies an operator action and returns the new timer. activeSlots are the performer slots that
// have a runner in the Live Segment. Throws when the action doesn't make sense right now.
export function applyTimerAction(timer, { action, slot, on }, { now, activeSlots }) {
  const next = structuredClone(timer);
  const elapsed = timerElapsed(timer, now);
  const race = isRace(timer, activeSlots);
  const stopAt = (t) => ({ ...t, status: 'finished', banked: elapsed, startedAt: null, stoppedAt: now });
  // Carry on from when the timer stopped, so the time in between still counts.
  const carryOn = (t) => ({ ...t, status: 'running', startedAt: timer.stoppedAt ?? now, stoppedAt: null });

  switch (action) {
    case 'start':
      if (timer.status !== 'stopped') throw new Error('The timer has already started. Reset it first.');
      return { ...emptyTimer(), raceMode: timer.raceMode, status: 'running', startedAt: now };

    case 'pause':
      if (timer.status !== 'running') throw new Error('The timer is not running.');
      return { ...next, status: 'paused', banked: elapsed, startedAt: null };

    case 'resume':
      if (timer.status !== 'paused') throw new Error('The timer is not paused.');
      return { ...next, status: 'running', startedAt: now };

    // Reset also turns Race Mode off, ready for the next segment.
    case 'reset':
      return emptyTimer();

    case 'race':
      if (on && activeSlots.length < 2) throw new Error('Race Mode needs two or more performers in the Live Segment.');
      if (timer.finishes.some((t) => t !== null)) throw new Error('Undo the finish times before changing Race Mode.');
      return { ...next, raceMode: Boolean(on) };

    case 'finish': {
      if (timer.status !== 'running' && timer.status !== 'paused') throw new Error('The timer is not running.');
      if (!race) return stopAt(next);
      if (!activeSlots.includes(slot)) throw new Error('There is no runner in that slot.');
      if (timer.finishes[slot] !== null) throw new Error('That runner has already finished.');
      next.finishes[slot] = elapsed;
      return activeSlots.every((i) => next.finishes[i] !== null) ? stopAt(next) : next;
    }

    case 'unfinish': {
      if (!race) {
        if (timer.status !== 'finished') throw new Error('The timer has not finished.');
        return carryOn(next);
      }
      if (!Number.isInteger(slot) || timer.finishes[slot] === null || timer.finishes[slot] === undefined) {
        throw new Error('That runner has not finished.');
      }
      next.finishes[slot] = null;
      return timer.status === 'finished' ? carryOn(next) : next;
    }

    default:
      throw new Error(`Unknown timer action "${action}".`);
  }
}
