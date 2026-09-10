#!/usr/bin/env node
/**
 * The sound design: which cue fires when, how loud, and what gets dropped.
 *
 * The placement used to live inside compose.mjs as a loop that pushed a sound
 * on every click and a whoosh on every cut. It worked, and it had the two
 * problems every home-made sound design has:
 *
 *   1. NOTHING STOPPED TWO CUES LANDING TOGETHER. A click 40ms before a whoosh
 *      is not two sounds, it is one muddy one, and the recording clicks a lot —
 *      the checkout alone fires three inside a second. That is the difference
 *      between sound design and noise, and it is why "supporting, not
 *      irritating" has to be a rule the code enforces rather than a hope.
 *   2. THE SAME MIX FOR EVERY PLACEMENT. A cut that wants to feel premium and a
 *      cut that wants to feel like a game need different weights on the same
 *      seven moments, not different moments.
 *
 * So: the seven moments are named here once, planned against the edit, and then
 * SCHEDULED — a pass that drops the lower-priority cue whenever two land too
 * close, and rate-limits the one cue that arrives in bursts. A profile is a set
 * of gains, pitches and gaps over that same plan.
 *
 * Nothing here reads the recording. It takes the resolved edit — where the cuts
 * are, which are thrown, which scene is the payment — so the sound is timed to
 * the picture by construction rather than by two files agreeing about seconds.
 */

/**
 * The seven moments, in the order they happen.
 *
 * `priority` decides who survives a collision. It is not loudness: a click is
 * the loudest thing in the checkout and the first thing to go, because it is
 * texture. The three that carry meaning — money clearing, mail landing, code
 * arriving — never lose one.
 */
export const CUES = {
  click: { sound: 'click', priority: 1, gain: 0.62 },
  select: { sound: 'select', priority: 2, gain: 0.5 },
  /* Above the texture, below the meaning.
     A transition and a throw outrank a click and a select because the PICTURE
     visibly cuts and smears there: a thrown cut whose whip got evicted by a
     product-landing chime is a visible throw with no sound, which reads as a
     glitch rather than as restraint. Measured on the premium profile, whose
     wider gap dropped two of three throws before this order was right. */
  transition: { sound: 'whoosh', priority: 3, gain: 0.5 },
  throw: { sound: 'whip', priority: 4, gain: 0.62 },
  cta: { sound: 'tail', priority: 5, gain: 0.55 },
  /* The three the viewer is actually waiting for. These never lose one. */
  payment: { sound: 'confirm', priority: 6, gain: 0.8 },
  email: { sound: 'notify', priority: 7, gain: 0.85 },
  reveal: { sound: 'impact', priority: 8, gain: 0.8 },
};
export const CUE_KINDS = Object.keys(CUES);

/**
 * Four mixes of the same seven moments.
 *
 *   gain    multiplies the cue's own level
 *   pitch   a playback-rate shift — up is brighter and shorter, down is heavier
 *   minGap  how close two cues may land before the quieter one is dropped
 *   clicks  the most clicks per second that may survive; the checkout fires
 *           three inside one and all three is a rattle
 *   only    when present, the ONLY cues this profile fires at all
 */
export const PROFILES = {
  gaming: {
    name: 'Gaming',
    note: 'bright and punchy, every beat marked',
    bed: 0.34, minGap: 0.12, clicks: 4,
    gain: { click: 1, select: 1, transition: 1, throw: 1, payment: 1, email: 1, reveal: 1, cta: 1 },
    pitch: { click: 1.06, transition: 1.04, throw: 1.05 },
  },
  premium: {
    name: 'Premium',
    /* Fewer, lower, further apart. The restraint IS the format: a premium cut
       that marks every click sounds like a cheap cut with the treble turned
       down. */
    note: 'restrained and low; the interface stops narrating itself',
    bed: 0.22, minGap: 0.24, clicks: 1,
    gain: { click: 0.42, select: 0.85, transition: 0.62, throw: 0.6, payment: 0.85, email: 0.85, reveal: 1, cta: 0.85 },
    pitch: { click: 0.92, transition: 0.9, throw: 0.9, reveal: 0.88, cta: 0.9 },
  },
  minimal: {
    name: 'Minimal',
    /* Only the four moments that carry information, no bed, and a wide gap. For
       a feed where the sound is off more often than on, and for anywhere the
       advert has to sit next to somebody's own audio. */
    note: 'the four moments that carry meaning, and silence between them',
    bed: 0, minGap: 0.35, clicks: 0,
    only: ['payment', 'email', 'reveal', 'cta'],
    gain: { payment: 0.7, email: 0.75, reveal: 0.7, cta: 0.5 },
    pitch: { reveal: 0.94 },
  },
  'high-energy': {
    name: 'High energy',
    note: 'everything, loud, close together',
    bed: 0.42, minGap: 0.08, clicks: 6,
    gain: { click: 1.12, select: 1.15, transition: 1.3, throw: 1.25, payment: 1.15, email: 1.1, reveal: 1.2, cta: 1.3 },
    pitch: { click: 1.1, transition: 1.08, throw: 1.1, reveal: 1.05 },
  },
};
export const PROFILE_IDS = Object.keys(PROFILES);
export const profileById = (id) => PROFILES[String(id || '').toLowerCase()] || null;

/**
 * Where every cue lands in the finished cut.
 *
 * Takes the RESOLVED edit rather than the recording, so the sound is timed to
 * the picture by construction. `flashes` are the cut boundaries compose already
 * computed and `whipAt` the indices it smears — read here rather than
 * recomputed, because a sound that disagrees with the picture about which cut
 * is a throw is worse than no sound.
 */
export function planCues({ cuts, beats = [], flashes = [], whipAt = [], hero = 0, bodyEnd, cardAt }) {
  const cues = [];
  const add = (kind, at, extra = {}) => {
    if (!(at >= 0)) return;
    cues.push({ kind, at: +at.toFixed(3), ...CUES[kind], ...extra });
  };
  const thrown = new Set(whipAt);

  /* Transitions. A whoosh LEADS into the cut and a throw lands ON it: a throw
     and its sound arriving apart is what makes a transition feel cheap. */
  flashes.forEach((t, i) => {
    if (thrown.has(i)) add('throw', t - 0.06);
    else add('transition', t - 0.12);
  });

  let cursor = hero;
  for (const c of cuts) {
    // Clicks, mapped from real time into edited time through the scene's ramp.
    for (const b of beats) {
      if (!b.click) continue;
      const rel = b.atMs / 1000 - c.start;
      if (rel < 0 || rel > c.srcLen) continue;
      add('click', cursor + rel / (c.speed || 1));
    }
    /* The product landing. The scene that STARTS on the product beat is the
       moment the choice registered — the click that caused it has already
       sounded, and this is the answer to it. */
    if (c.from === 'product') add('select', cursor + 0.10);
    if (c.confirm) add('payment', cursor + 0.14);
    if (c.notify) add('email', cursor + 0.12);
    /* The shot the whole advert is built to reach. A beat in, so it lands with
       the push rather than with the cut that got there. */
    if (c.label === 'the code') add('reveal', cursor + 0.18);
    cursor += c.played;
  }

  /* The end card. `impact` used to fire here and nowhere else, so the brand
     card was the climax and the code — the thing being sold — arrived in
     silence. Now the code gets the impact and this gets a full stop. */
  const card = cardAt ?? bodyEnd ?? cursor;
  add('cta', card - 0.04);

  return cues.sort((a, b) => a.at - b.at);
}

/**
 * The pass that makes it sound designed rather than merely triggered.
 *
 * Two rules, both of which exist because of what the recording actually does:
 *
 *   · A cue within `minGap` of a louder-meaning one is DROPPED. Not ducked —
 *     ducked, it is still there, still smearing the transient it sits on.
 *   · Clicks are rate-limited. The checkout fires three inside a second and all
 *     three is a rattle, so the profile says how many may survive.
 *
 * Returns what survived and what did not, because a mix that silently discards
 * half its cues is one nobody can debug.
 */
export function schedule(cues, profile) {
  const p = profile || PROFILES.gaming;
  const allowed = (k) => (p.only ? p.only.includes(k) : true) && (p.gain?.[k] ?? 1) > 0;
  const wanted = cues.filter((c) => allowed(c.kind));
  const dropped = cues.filter((c) => !allowed(c.kind)).map((c) => ({ ...c, why: 'not in this profile' }));

  /* Highest priority first, so a click never evicts a payment. Ties go to the
     earlier cue, which keeps the result stable rather than depending on sort. */
  const order = [...wanted].sort((a, b) => (b.priority - a.priority) || (a.at - b.at));
  const kept = [];
  const clicks = [];
  for (const c of order) {
    const clash = kept.find((k) => Math.abs(k.at - c.at) < p.minGap);
    if (clash) { dropped.push({ ...c, why: `within ${p.minGap}s of ${clash.kind}` }); continue; }
    if (c.kind === 'click') {
      const near = clicks.filter((t) => Math.abs(t - c.at) <= 0.5).length;
      if (near >= (p.clicks ?? 4)) { dropped.push({ ...c, why: 'too many clicks in one second' }); continue; }
      clicks.push(c.at);
    }
    kept.push(c);
  }

  return {
    cues: kept.map((c) => ({
      ...c,
      gain: +(c.gain * (p.gain?.[c.kind] ?? 1)).toFixed(3),
      pitch: p.pitch?.[c.kind] ?? 1,
    })).sort((a, b) => a.at - b.at),
    dropped: dropped.sort((a, b) => a.at - b.at),
  };
}

/** What happened, for the operator. */
export function report({ cues, dropped }, profile) {
  const by = {};
  for (const c of cues) by[c.kind] = (by[c.kind] || 0) + 1;
  const line = CUE_KINDS.filter((k) => by[k]).map((k) => `${by[k]}× ${k}`).join(', ');
  return [`   ${profile.name}: ${cues.length} cues (${line || 'none'})`,
    ...(dropped.length ? [`   ${dropped.length} dropped — ${
      [...new Set(dropped.map((d) => d.why))].join('; ')}`] : [])];
}

// Runnable on its own, to see what a profile does to the same edit.
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('\nSound profiles:\n');
  for (const [id, p] of Object.entries(PROFILES)) {
    console.log(`  ${id.padEnd(13)} ${p.name.padEnd(12)} bed ${String(p.bed).padEnd(5)} `
      + `gap ${String(p.minGap).padEnd(5)} clicks/s ${String(p.clicks).padEnd(2)} ${p.note}`);
  }
  console.log('\nThe seven moments:\n');
  for (const [k, c] of Object.entries(CUES)) {
    console.log(`  ${k.padEnd(12)} ${c.sound.padEnd(8)} priority ${c.priority}`);
  }
  console.log('');
}
