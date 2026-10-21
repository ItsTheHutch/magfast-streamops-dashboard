// Drawing the timer, shared by the Dashboard and the OBS timer page (browser only).

// Each digit gets a fixed-width box (1ch of the timer font), so the clock doesn't jiggle with
// fonts whose digits are different widths. Tenths are drawn smaller.
export function setClockText(el, text) {
  const part = (chars, className) => {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = chars;
    return span;
  };
  const [main, tenths] = text.split('.');
  const small = part('', 'tenths');
  small.append(part('.', 'sep'), part(tenths, 'd'));
  el.replaceChildren(...[...main].map((c) => part(c, c === ':' ? 'sep' : 'd')), small);
}

// Loads the uploaded timer font under a name unique to its version, so a new upload replaces the
// old one, and sets --timer-font / --timer-weight on the page. null switches back to the default.
export async function useTimerFont(font) {
  const root = document.documentElement;
  if (!font) {
    root.style.removeProperty('--timer-font');
    root.style.removeProperty('--timer-weight');
    return;
  }
  const family = `TimerFont${font.version}`;
  const face = new FontFace(family, `url(/fonts/timer?v=${font.version})`);
  document.fonts.add(await face.load());
  root.style.setProperty('--timer-font', `"${family}"`);
  // Uploaded fonts are usually a single weight; asking for bold would fake it.
  root.style.setProperty('--timer-weight', '400');
}
