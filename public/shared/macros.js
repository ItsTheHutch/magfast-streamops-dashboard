// Timer actions a Stream Deck (or any HTTP tool) can trigger, shared by the server and Settings.
// Each is a GET or POST to /api/macro/<id>?key=<key>.

import { MAX_PERFORMERS } from './model.js';

export const MACROS = [
  { id: 'timer-toggle', label: 'Start / Pause / Resume', note: 'One button that starts the timer, pauses it, and resumes it.' },
  { id: 'timer-start', label: 'Start' },
  { id: 'timer-pause', label: 'Pause' },
  { id: 'timer-resume', label: 'Resume' },
  { id: 'timer-finish', label: 'Finish', note: 'Ends the run. In Race Mode, use the runner buttons instead.' },
  ...Array.from({ length: MAX_PERFORMERS }, (_, i) => ({ id: `finish-runner-${i + 1}`, label: `Finish runner ${i + 1}`, note: i === 0 ? 'Race Mode: finishes the performer in that slot.' : '' })),
  { id: 'timer-undo-finish', label: 'Undo finish', note: 'In Race Mode, undoes the most recent finish.' },
  { id: 'timer-reset', label: 'Reset', note: 'Press twice within 3 seconds, so a stray press can\'t clear a run.' },
  { id: 'race-mode', label: 'Race Mode on/off' },
];

export const RESET_WINDOW_MS = 3000;
