// Turns a Stream Deck macro into a timer action, using the same rules as the Dashboard's buttons.

import { isRace } from '../public/shared/timer.js';

export class MacroError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Returns the timer action for a macro (or null for an unknown macro), given the current timer and
// the performer slots with a runner in the Live Segment. Throws MacroError when it doesn't apply.
export function macroAction(id, timer, activeSlots) {
  const race = isRace(timer, activeSlots);
  const { status } = timer;
  const runner = /^finish-runner-([1-9])$/.exec(id);

  if (runner) {
    if (!race) throw new MacroError(409, 'Race Mode isn\'t on. Use Finish instead.');
    return { action: 'finish', slot: Number(runner[1]) - 1 };
  }

  switch (id) {
    case 'timer-toggle':
      if (status === 'stopped') return { action: 'start' };
      if (status === 'running') return { action: 'pause' };
      if (status === 'paused') return { action: 'resume' };
      throw new MacroError(409, 'The run has finished. Reset the timer to start again.');
    case 'timer-start':
      return { action: 'start' };
    case 'timer-pause':
      return { action: 'pause' };
    case 'timer-resume':
      return { action: 'resume' };
    case 'timer-finish':
      if (race) throw new MacroError(409, 'Race Mode is on. Use the Finish runner buttons.');
      return { action: 'finish' };
    case 'timer-undo-finish': {
      if (!race) return { action: 'unfinish' };
      // The runner who finished most recently.
      const latest = timer.finishes.reduce((best, t, i) => (t !== null && (best === -1 || t >= timer.finishes[best]) ? i : best), -1);
      if (latest === -1) throw new MacroError(409, 'No runner has finished yet.');
      return { action: 'unfinish', slot: latest };
    }
    case 'timer-reset':
      return { action: 'reset' };
    case 'race-mode':
      return { action: 'race', on: !timer.raceMode };
    default:
      return null;
  }
}
