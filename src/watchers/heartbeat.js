// src/watchers/heartbeat.js
// Heartbeat simples p/ detectar travas silenciosas.
// Exports: beat(), startHeartbeatWatcher()

let lastBeat = Date.now();
let tripped = false;

const WINDOW_MS = Number(process.env.HEARTBEAT_WINDOW_MS || 5 * 60 * 1000); // 5 min
const TICK_MS   = Math.min(Math.floor(WINDOW_MS / 2), 30_000);              // 30s máx

export function beat(label = "tick") {
  const now = Date.now();
  const age = now - lastBeat;
  lastBeat = now;
  tripped = false;
  console.log(`[HB] beat: ${label} age=${Math.round(age/1000)}s`);
}

// Observer opcional: se passar do tempo sem "beat", loga/alerta
export function startHeartbeatWatcher(onTimeout) {
  console.log(`[HB] watcher iniciado (window=${WINDOW_MS}ms, tick=${TICK_MS}ms)`);
  setInterval(async () => {
    const age = Date.now() - lastBeat;
    if (age > WINDOW_MS && !tripped) {
      tripped = true;
      const msg = `[HB] heartbeat-timeout ${Math.round(age/1000)}s (window=${WINDOW_MS}ms)`;
      try {
        if (typeof onTimeout === 'function') {
          await onTimeout({ age, windowMs: WINDOW_MS, message: msg });
        } else {
          console.warn(msg);
        }
      } catch (e) {
        console.error('[HB] onTimeout error:', e);
      }
    }
  }, TICK_MS);
}
