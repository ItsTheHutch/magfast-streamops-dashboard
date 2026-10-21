import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTimerAction, emptyTimer, finishPlaces, formatTimer, normalizeTimer, timerElapsed } from '../public/shared/timer.js';

// Applies a list of [time, action, slot?] steps with runners in activeSlots, in Race Mode if asked.
function run(steps, activeSlots = [0], { raceMode = false } = {}) {
  return steps.reduce(
    (t, [now, action, slot]) => applyTimerAction(t, { action, slot }, { now, activeSlots }),
    { ...emptyTimer(), raceMode },
  );
}

test('formatTimer shows H:MM:SS and tenths', () => {
  assert.equal(formatTimer(0), '0:00:00.0');
  assert.equal(formatTimer(61_250), '0:01:01.2');
  assert.equal(formatTimer(5_025_999), '1:23:45.9');
});

test('pausing stops the clock and resuming leaves the paused time out', () => {
  const t = run([[1000, 'start'], [6000, 'pause'], [60_000, 'resume']]);
  assert.equal(t.status, 'running');
  assert.equal(timerElapsed(t, 61_000), 6000);
});

test('outside Race Mode, Finish stops the whole run', () => {
  const t = run([[0, 'start'], [90_000, 'finish']], [0, 1]);
  assert.equal(t.status, 'finished');
  assert.deepEqual(t.finishes, [null, null, null, null]);
  assert.equal(timerElapsed(t, 200_000), 90_000);
});

test('in Race Mode the timer runs until every runner finishes', () => {
  const slots = [0, 1, 2, 3];
  let t = run([[0, 'start'], [50_000, 'finish', 2], [70_000, 'finish', 0], [80_000, 'finish', 3]], slots, { raceMode: true });
  assert.equal(t.status, 'running');
  t = applyTimerAction(t, { action: 'finish', slot: 1 }, { now: 95_000, activeSlots: slots });
  assert.equal(t.status, 'finished');
  assert.deepEqual(t.finishes, [70_000, 95_000, 50_000, 80_000]);
  assert.deepEqual(finishPlaces(t.finishes), [2, 4, 1, 3]);
});

test('undoing a finish carries on as if the timer never stopped', () => {
  const solo = run([[0, 'start'], [90_000, 'finish']]);
  const resumed = applyTimerAction(solo, { action: 'unfinish' }, { now: 100_000, activeSlots: [0] });
  assert.equal(resumed.status, 'running');
  assert.equal(timerElapsed(resumed, 100_000), 100_000);

  const race = run([[0, 'start'], [80_000, 'finish', 0], [90_000, 'finish', 1]], [0, 1], { raceMode: true });
  const reopened = applyTimerAction(race, { action: 'unfinish', slot: 1 }, { now: 100_000, activeSlots: [0, 1] });
  assert.equal(reopened.status, 'running');
  assert.deepEqual(reopened.finishes.slice(0, 2), [80_000, null]);
  assert.equal(timerElapsed(reopened, 100_000), 100_000);
});

test('Race Mode needs two runners, stays put once someone finishes, and is cleared by Reset', () => {
  const act = (t, payload, activeSlots = [0, 1]) => applyTimerAction(t, payload, { now: 5000, activeSlots });
  assert.throws(() => act(emptyTimer(), { action: 'race', on: true }, [0]), /two or more performers/);
  const on = act(emptyTimer(), { action: 'race', on: true });
  assert.equal(on.raceMode, true);
  assert.equal(act(on, { action: 'start' }).raceMode, true);

  const midRace = run([[0, 'start'], [3000, 'finish', 0]], [0, 1], { raceMode: true });
  assert.throws(() => act(midRace, { action: 'race', on: false }), /Undo the finish times/);
  assert.equal(act(midRace, { action: 'reset' }).raceMode, false);

  // With only one runner left in the segment, Race Mode no longer applies.
  const solo = run([[0, 'start'], [4000, 'finish']], [0], { raceMode: true });
  assert.equal(solo.status, 'finished');
});

test('actions that make no sense are refused', () => {
  const running = run([[0, 'start']], [0, 1], { raceMode: true });
  const act = (t, action, slot) => () => applyTimerAction(t, { action, slot }, { now: 5000, activeSlots: [0, 1] });
  assert.throws(act(running, 'start'), /already started/);
  assert.throws(act(emptyTimer(), 'finish', 0), /not running/);
  assert.throws(act(running, 'finish', 3), /no runner/);
  assert.throws(act(running, 'unfinish', 0), /has not finished/);
  assert.throws(act(running, 'explode'), /Unknown timer action/);
});

test('ties share a place', () => {
  assert.deepEqual(finishPlaces([10, null, 10, 5]), [2, null, 2, 1]);
});

test('normalizeTimer repairs bad saved state', () => {
  assert.deepEqual(normalizeTimer('nope'), emptyTimer());
  const t = normalizeTimer({ status: 'paused', banked: 5000, startedAt: 123, finishes: [1000, 'x'] });
  assert.equal(t.startedAt, null);
  assert.deepEqual(t.finishes, [1000, null, null, null]);
});
