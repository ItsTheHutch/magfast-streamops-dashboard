// Who may use the dashboard. It's meant for the stream PC only, so by default the server listens on
// 127.0.0.1 and only this computer can reach it. Two checks cover what that alone doesn't:
//
// - Host: a request must be addressed to this computer by name (localhost / 127.0.0.1) or, when
//   LAN access is turned on, by IP address. This stops DNS rebinding, where an outside website
//   points its own domain name at 127.0.0.1 to reach local servers.
// - Origin: a request made by a web page must come from one of the dashboard's own pages. This
//   stops other websites open in a browser on this PC (OBS browser sources included) from talking
//   to the dashboard's live connection, which browsers don't otherwise block.

import { isIP } from 'node:net';

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1']);

// True when the server only listens on this computer.
export function isLoopback(host) {
  return !host || LOOPBACK_NAMES.has(String(host).replace(/^\[|\]$/g, '').toLowerCase());
}

export function createAccessCheck({ lan = false } = {}) {
  function hostAllowed(hostHeader) {
    if (!hostHeader) return false;
    let hostname;
    try {
      hostname = new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    } catch {
      return false;
    }
    if (LOOPBACK_NAMES.has(hostname)) return true;
    // An IP address can't be rebound, so with LAN access the PC's network address is fine.
    return lan && isIP(hostname) !== 0;
  }

  // Requests without an Origin don't come from a web page (OBS text sources, scripts, tests).
  function originAllowed(origin, hostHeader) {
    if (!origin) return true;
    try {
      return new URL(origin).host === String(hostHeader).toLowerCase();
    } catch {
      return false;
    }
  }

  return {
    hostAllowed,
    originAllowed,

    // Express: every request needs an allowed Host; anything that changes something needs our Origin.
    middleware(req, res, next) {
      const changes = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (!hostAllowed(req.headers.host) || (changes && !originAllowed(req.headers.origin, req.headers.host))) {
        return res.status(403).type('text').send('This dashboard only accepts requests from its own pages on this computer.');
      }
      next();
    },

    // Socket.IO's allowRequest: the live connection needs both.
    allowSocket(req, callback) {
      callback(null, hostAllowed(req.headers.host) && originAllowed(req.headers.origin, req.headers.host));
    },
  };
}
