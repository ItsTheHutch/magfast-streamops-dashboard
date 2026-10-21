import { formatTimer, timerElapsed } from '/shared/timer.js';
import { setClockText, useTimerFont } from '/shared/clock.js';

/* global io */
const socket = io();
const clock = document.getElementById('clock');

let timer = null;
let clockOffset = 0; // the server's clock minus this browser's, so it matches the Dashboard
let shown = '';
let frame = null;
let fontVersion = null;

function render() {
  const text = formatTimer(timer ? timerElapsed(timer, Date.now() + clockOffset) : 0);
  if (text !== shown) {
    shown = text;
    setClockText(clock, text);
  }
  frame = timer?.status === 'running' ? requestAnimationFrame(render) : null;
}

socket.on('timer', ({ serverNow, ...state }) => {
  clockOffset = serverNow - Date.now();
  timer = state;
  document.body.dataset.status = state.status;
  if (frame === null) render();
});

socket.on('settings', async ({ timerFont }) => {
  const version = timerFont?.version ?? null;
  if (version === fontVersion) return;
  fontVersion = version;
  try {
    await useTimerFont(timerFont);
  } catch {
    // Keep the default font; the Dashboard reports font problems.
  }
});
