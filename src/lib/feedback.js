/**
 * Tactile feedback layer — haptics (mobile) + subtle synthesized sound.
 *
 * Defaults are chosen for production taste:
 *   • Haptics ON  — expected on mobile, silent, cheap (navigator.vibrate).
 *   • Sound   OFF — never surprise a user with audio; opt-in via Settings.
 * Both are remembered in localStorage. Audio is synthesized with the Web Audio
 * API (no asset downloads) and only ever created after a user gesture.
 */
const PREF = { haptics: 'fm_haptics', sound: 'fm_sound' };
const pref = (k, def) => { try { const v = localStorage.getItem(k); return v == null ? def : v === '1'; } catch { return def; } };
export const getFeedbackPrefs = () => ({ haptics: pref(PREF.haptics, true), sound: pref(PREF.sound, false) });
export const setFeedbackPref = (kind, on) => { try { localStorage.setItem(PREF[kind], on ? '1' : '0'); } catch { /* ignore */ } };

// ── Haptics ───────────────────────────────────────────────────────────────
const PATTERNS = { light: 8, medium: 16, success: [12, 40, 24], error: [40, 30, 40] };
export function haptic(type = 'light') {
  if (!pref(PREF.haptics, true)) return;
  try { navigator.vibrate?.(PATTERNS[type] ?? 8); } catch { /* unsupported */ }
}

// ── Sound (lazy Web Audio) ──────────────────────────────────────────────────
let actx = null;
const ctx = () => {
  if (actx) return actx;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; }
  return actx;
};
function blip(freq, start, dur, gain = 0.05, type = 'sine') {
  const ac = ctx(); if (!ac) return;
  const o = ac.createOscillator(); const g = ac.createGain();
  o.type = type; o.frequency.value = freq;
  o.connect(g); g.connect(ac.destination);
  const t = ac.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.02);
}
const TONES = {
  light:   () => blip(880, 0, 0.06, 0.03),
  success: () => { blip(660, 0, 0.09, 0.045); blip(990, 0.07, 0.12, 0.045); },
  error:   () => blip(180, 0, 0.18, 0.05, 'triangle'),
};
export function chime(type = 'light') {
  if (!pref(PREF.sound, false)) return;
  try { const ac = ctx(); if (ac?.state === 'suspended') ac.resume(); (TONES[type] || TONES.light)(); } catch { /* ignore */ }
}

/** Combined cue for an interaction. Used centrally by the toast system. */
export function feedback(type = 'light') { haptic(type); chime(type); }
