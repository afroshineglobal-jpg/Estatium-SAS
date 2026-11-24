/**
 * Alert sounds, generated in the browser (no audio files to download, works offline).
 *   VISITOR   - doorbell "ding-dong"                 (someone at the gate / visitor decision)
 *   MESSAGE   - two soft pops                         (chat messages and notices)
 *   EMERGENCY - loud two-tone siren, repeats until silenced (SOS)
 * Browsers only allow sound after the person has touched the page once, so unlockAudio() runs on the first tap.
 */
const PREF_KEY = 'estatium_sound_prefs';
const DEFAULTS = { VISITOR: true, MESSAGE: true, volume: 0.8 };

export function getPrefs() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(PREF_KEY)) || {}) }; } catch { return { ...DEFAULTS }; }
}
export function setPrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...getPrefs(), ...p })); } catch { /* private mode */ } }

let ctx = null;
const getCtx = () => { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); return ctx; };
export function unlockAudio() { try { const c = getCtx(); if (c.state === 'suspended') c.resume(); } catch { /* unsupported */ } }
export const audioReady = () => { try { return getCtx().state === 'running'; } catch { return false; } };

function tone(c, { freq, start = 0, dur = 0.4, vol = 0.5, type = 'sine', to }) {
  const o = c.createOscillator(); const g = c.createGain(); o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start); if (to) o.frequency.linearRampToValueAtTime(to, c.currentTime + start + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime + start); g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), c.currentTime + start + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g); g.connect(c.destination); o.start(c.currentTime + start); o.stop(c.currentTime + start + dur + 0.05);
}

const recipes = {
  VISITOR: (c, v) => { tone(c, { freq: 987, dur: 0.5, vol: 0.55 * v }); tone(c, { freq: 659, start: 0.5, dur: 0.7, vol: 0.5 * v }); },
  MESSAGE: (c, v) => { tone(c, { freq: 880, dur: 0.12, vol: 0.35 * v, type: 'triangle' }); tone(c, { freq: 1175, start: 0.16, dur: 0.16, vol: 0.35 * v, type: 'triangle' }); },
};

let lastPlayed = {};
/** Plays a one-off sound. Repeated calls for the same kind within 1.5 s are ignored (socket + push can both announce one event). */
export async function playSound(kind, { force = false } = {}) {
  if (kind === 'EMERGENCY') return startAlarm();
  const prefs = getPrefs();
  if (!force && !prefs[kind]) return;
  const now = Date.now(); if (!force && now - (lastPlayed[kind] || 0) < 1500) return; lastPlayed[kind] = now;
  try {
    const c = getCtx(); if (c.state === 'suspended') await c.resume();
    if (c.state !== 'running') { window.dispatchEvent(new Event('sound-blocked')); return; }
    recipes[kind]?.(c, Math.min(1, Math.max(0.05, prefs.volume)));
  } catch { /* audio unavailable */ }
}

let alarmTimer = null; let alarmStop = null;
export const alarmActive = () => !!alarmTimer;
/** Siren that repeats until stopAlarm() (or 45 s). Always plays at full volume: an SOS must never be muted by a preference. */
export async function startAlarm() {
  if (alarmTimer) return;
  try {
    const c = getCtx(); if (c.state === 'suspended') await c.resume();
    if (c.state !== 'running') window.dispatchEvent(new Event('sound-blocked'));
    const cycle = () => { tone(c, { freq: 960, dur: 0.45, vol: 0.9, type: 'sawtooth' }); tone(c, { freq: 720, start: 0.45, dur: 0.45, vol: 0.9, type: 'sawtooth' }); };
    cycle(); alarmTimer = setInterval(cycle, 900);
    alarmStop = setTimeout(stopAlarm, 45000);
    window.dispatchEvent(new CustomEvent('alarm-state', { detail: true }));
  } catch { /* audio unavailable */ }
}
export function stopAlarm() {
  if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; }
  if (alarmStop) { clearTimeout(alarmStop); alarmStop = null; }
  window.dispatchEvent(new CustomEvent('alarm-state', { detail: false }));
}
