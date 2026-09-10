/**
 * The sound design: what fires when, and what does not fire at all.
 *
 * Placement used to be a loop inside compose.mjs that pushed a sound on every
 * click and a whoosh on every cut. It worked, and it had the two problems every
 * home-made sound design has:
 *
 *   1. NOTHING STOPPED TWO CUES LANDING TOGETHER. The checkout of this very
 *      recording fires three clicks inside one second, and a click 40ms before
 *      a whoosh is not two sounds, it is one muddy one. "Supporting, not
 *      irritating" has to be a rule the code enforces, not a hope.
 *   2. ONE MIX FOR EVERY PLACEMENT. A cut that wants to feel premium and one
 *      that wants to feel like a game need different weights on the same seven
 *      moments — not different moments.
 *
 * So the tests are in two halves: TIMING, that every moment sounds where the
 * picture says it happens, and OVERLAP, that nothing collides and no cut is
 * left silent.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const near = (a, b, eps = 0.005) => Math.abs(a - b) <= eps;

const { CUES, CUE_KINDS, PROFILES, PROFILE_IDS, profileById, planCues, schedule, report } =
  await import(join(ROOT, 'scripts/ad/sound.mjs'));
const { variantById } = await import(join(ROOT, 'scripts/ad/variants.mjs'));
const { planCuts, resolveTiming, timeline } = await import(join(ROOT, 'scripts/ad/timing.mjs'));
const compose = read('scripts/ad/compose.mjs');
const sfxSrc = read('scripts/ad/sfx.mjs');
const soundSrc = read('scripts/ad/sound.mjs');

/* The real recording's own spans and clicks — order FM-2026-H2MKUSQ5,
   normalised to zero. A fixture with comfortable gaps everywhere would hide the
   one thing worth testing: what happens when cues arrive on top of each other. */
const BEATS_MS = {
  product: 0, buy: 4118, checkout: 5218, 'order-placed': 7795,
  delivery: 13791, 'email-open': 18656, 'email-detail': 21125, end: 23028,
};
const CLICKS = [4118, 5966, 7001, 7795];        // select, consent, pay, place
const beats = [
  ...Object.entries(BEATS_MS).map(([label, atMs]) => ({ label, atMs })),
  ...CLICKS.map((atMs) => ({ label: 'click', atMs, click: true })),
];
const at = (l) => (l in BEATS_MS ? BEATS_MS[l] : null);

const V = variantById('M');
const HERO = V.hero;
const built = (() => {
  const c = planCuts(V.scenes, at);
  const r = resolveTiming(c, { target: V.target - HERO, card: V.card, min: Math.min(15, V.target - HERO - 1) });
  const rows = timeline(r.cuts, r.card).rows.map((x) => ({ ...x, in: x.in + HERO, out: x.out + HERO }));
  const bodyEnd = HERO + r.cuts.reduce((a, x) => a + x.played, 0);
  // Exactly what compose builds: the hero cut is a cut too.
  const flashes = [HERO];
  let acc = HERO;
  r.cuts.forEach((x, i) => { acc += x.played; if (i < r.cuts.length - 1) flashes.push(acc); });
  return { cuts: r.cuts, rows, flashes, bodyEnd, total: HERO + r.total };
})();
const plan = planCues({
  cuts: built.cuts, beats, flashes: built.flashes, whipAt: V.whipAt,
  hero: HERO, bodyEnd: built.bodyEnd, cardAt: built.bodyEnd,
});
const sceneAt = (label) => built.rows.find((r) => r.label === label);
const firstOf = (cues, kind) => cues.find((c) => c.kind === kind);

console.log('— The seven moments each have a sound —');
{
  const want = [
    ['cursor click', 'click', 'click'],
    ['product selection', 'select', 'select'],
    ['transition', 'transition', 'whoosh'],
    ['payment success', 'payment', 'confirm'],
    ['email arrival', 'email', 'notify'],
    ['code reveal', 'reveal', 'impact'],
    ['the call to action', 'cta', 'tail'],
  ];
  for (const [moment, kind, sound] of want) {
    ok(`${moment} → ${sound}`, CUES[kind]?.sound === sound, CUES[kind]?.sound);
    ok(`…and it fires in this cut`, !!firstOf(plan, kind), 'never');
  }
  ok('a thrown cut gets a whip rather than a whoosh', CUES.throw.sound === 'whip');
  ok('every sound the cues name is generated', CUE_KINDS.every((k) =>
    new RegExp(`^  ${CUES[k].sound}: \\{`, 'm').test(sfxSrc)), 
    CUE_KINDS.filter((k) => !new RegExp(`^  ${CUES[k].sound}: \\{`, 'm').test(sfxSrc)).join(','));
  /* impact moved to the code reveal, so the end card needed its own, quieter
     hit — the same big low sound twice in a second made the brand card feel
     like a second climax rather than a full stop. */
  ok('the final hit is its own, smaller sound', CUES.cta.sound !== CUES.reveal.sound);
  ok('…and quieter than the reveal', CUES.cta.gain < CUES.reveal.gain);
}

console.log('\n— Timing: every cue lands where the picture says it happens —');
{
  const pay = sceneAt('payment'); const mail = sceneAt('the email'); const code = sceneAt('the code');
  ok('the payment cue is inside the payment scene',
    firstOf(plan, 'payment').at > pay.in && firstOf(plan, 'payment').at < pay.out,
    `${firstOf(plan, 'payment').at} vs ${pay.in.toFixed(2)}–${pay.out.toFixed(2)}`);
  ok('…a beat in, not on the cut that got there', firstOf(plan, 'payment').at - pay.in >= 0.1);
  ok('the mail landing is inside the email scene',
    firstOf(plan, 'email').at > mail.in && firstOf(plan, 'email').at < mail.out);
  ok('the code reveal is inside the code scene',
    firstOf(plan, 'reveal').at > code.in && firstOf(plan, 'reveal').at < code.out);
  ok('the product landing is on the scene that starts on the product beat',
    near(firstOf(plan, 'select').at, sceneAt('the product').in + 0.10));
  ok('the final hit is at the end card', near(firstOf(plan, 'cta').at, built.bodyEnd - 0.04));

  /* A whoosh LEADS into the cut; a throw lands ON it. A throw and its sound
     arriving apart is what makes a transition feel cheap. */
  const throws = plan.filter((c) => c.kind === 'throw');
  const whooshes = plan.filter((c) => c.kind === 'transition');
  ok('a whoosh leads the cut', whooshes.every((w) =>
    built.flashes.some((f) => near(f - w.at, 0.12))));
  ok('a throw lands on it', throws.every((t) =>
    built.flashes.some((f) => near(f - t.at, 0.06))));
  ok('there is one transition cue per cut', throws.length + whooshes.length === built.flashes.length,
    `${throws.length + whooshes.length} vs ${built.flashes.length}`);

  /* The off-by-one this replaced: the old loop asked whipCuts.has(i-1) for
     scene i, which is right only when nothing is in front of the footage. With
     a hero still the picture smeared on cut 0 and the sound whooshed. */
  ok('the cut out of the hero is thrown, because the picture throws it',
    V.whipAt.includes(0) && throws.some((t) => near(t.at, HERO - 0.06)),
    throws.map((t) => t.at).join(','));
  ok('…and the sound reads the same whipAt the picture does',
    /whipAt: variant\?\.whipAt \|\| \[\]/.test(compose));

  // Clicks are mapped from real time through the scene's own ramp.
  const clicks = plan.filter((c) => c.kind === 'click');
  ok('clicks are mapped through the speed ramp', clicks.every((c) => {
    return built.rows.some((r) => beats.some((b) => b.click
      && near(r.in + (b.atMs / 1000 - r.start) / r.speed, c.at, 0.002)));
  }), clicks.map((c) => c.at).join(','));
  /* A click in footage this cut skipped is a click nobody sees. The old loop
     already guarded this; it has to stay guarded now that the mapping moved. */
  const skipped = planCues({
    cuts: built.cuts, beats: [{ label: 'click', atMs: 99999, click: true }],
    flashes: [], whipAt: [], hero: HERO, bodyEnd: built.bodyEnd,
  }).filter((c) => c.kind === 'click');
  ok('…and none from footage this cut skipped', skipped.length === 0, `${skipped.length}`);

  ok('nothing lands before the first frame', plan.every((c) => c.at >= 0));
  ok('…or after the last', plan.every((c) => c.at <= built.total), 
    `${Math.max(...plan.map((c) => c.at))} vs ${built.total}`);
  ok('the plan is in order', plan.every((c, i) => i === 0 || c.at >= plan[i - 1].at));
}

console.log('\n— Overlap: nothing lands on top of anything —');
{
  for (const id of PROFILE_IDS) {
    const p = profileById(id);
    const { cues, dropped } = schedule(plan, p);
    const tooClose = [];
    for (let i = 1; i < cues.length; i++) {
      if (cues[i].at - cues[i - 1].at < p.minGap) tooClose.push(`${cues[i - 1].kind}+${cues[i].kind}`);
    }
    ok(`${id}: no two cues within ${p.minGap}s`, tooClose.length === 0, tooClose.join(', '));

    /* The one cue that arrives in bursts. Three clicks inside a second is a
       rattle, and this recording's checkout fires exactly that. */
    const clicks = cues.filter((c) => c.kind === 'click').map((c) => c.at);
    const burst = clicks.filter((t) => clicks.filter((u) => Math.abs(u - t) <= 0.5).length > (p.clicks ?? 4));
    ok(`${id}: clicks are rate-limited`, burst.length === 0, burst.join(','));

    /* Priority, not loudness: a click may never evict a payment. */
    for (const d of dropped) {
      if (d.why === 'not in this profile' || d.why === 'too many clicks in one second') continue;
      const winner = cues.find((c) => Math.abs(c.at - d.at) < p.minGap);
      ok(`${id}: ${d.kind} lost to something that outranks it`,
        !!winner && winner.priority >= d.priority, `${d.kind} vs ${winner?.kind}`);
    }

    /* No cut is ACCIDENTALLY silent. A visible smear with nothing on it reads as
       a glitch — so where a profile fires transitions at all, a dropped one has
       to have been dropped FOR something.
       Minimal is exempt because silence between the four meaning cues is the
       whole format, not an oversight: it declares that by not listing
       transition or throw in `only`. */
    const firesCuts = !p.only || p.only.includes('transition') || p.only.includes('throw');
    if (firesCuts) {
      const silent = built.flashes.filter((f) => !cues.some((c) => Math.abs(c.at - f) < p.minGap + 0.13));
      ok(`${id}: every cut in the picture has a sound near it`, silent.length === 0, silent.join(','));
    } else {
      ok(`${id}: silence between the cuts is declared, not accidental`,
        !cues.some((c) => c.kind === 'transition' || c.kind === 'throw'));
    }
  }
}

console.log('\n— Four mixes of the same seven moments —');
{
  for (const id of ['gaming', 'premium', 'minimal', 'high-energy']) {
    ok(`there is a ${id} profile`, !!profileById(id));
  }
  ok('and no fifth', PROFILE_IDS.length === 4, PROFILE_IDS.join(','));
  ok('every profile says what it is for', PROFILE_IDS.every((id) => PROFILES[id].note?.length > 20));
  ok('lookup is case-insensitive — it comes off a command line',
    profileById('Premium') === PROFILES.premium && profileById('nope') === null);

  const mixes = Object.fromEntries(PROFILE_IDS.map((id) => [id, schedule(plan, profileById(id))]));

  /* They are PROFILES, not four different adverts: the plan is one plan, and
     each profile only decides what survives it and how loud. */
  ok('all four mix the same plan', PROFILE_IDS.every((id) =>
    mixes[id].cues.every((c) => plan.some((q) => q.kind === c.kind && near(q.at, c.at)))));
  ok('…and none of them moves a beat', PROFILE_IDS.every((id) =>
    mixes[id].cues.every((c) => plan.some((q) => q.at === c.at))));

  ok('minimal fires only the four moments that carry meaning',
    new Set(mixes.minimal.cues.map((c) => c.kind)).size === 4
    && mixes.minimal.cues.every((c) => ['payment', 'email', 'reveal', 'cta'].includes(c.kind)));
  ok('…and has no music bed under it', PROFILES.minimal.bed === 0);
  ok('…and no clicks at all', PROFILES.minimal.clicks === 0);

  ok('premium is quieter than gaming on the same cue',
    firstOf(mixes.premium.cues, 'payment').gain < firstOf(mixes.gaming.cues, 'payment').gain);
  ok('…and lower', (PROFILES.premium.pitch.reveal ?? 1) < 1);
  ok('…and further apart', PROFILES.premium.minGap > PROFILES.gaming.minGap);
  ok('…so it lets fewer through', mixes.premium.cues.length < mixes.gaming.cues.length);

  ok('high-energy is louder than gaming',
    firstOf(mixes['high-energy'].cues, 'reveal').gain > firstOf(mixes.gaming.cues, 'reveal').gain);
  ok('…and brighter', (PROFILES['high-energy'].pitch.click ?? 1) > 1);
  ok('…and closer together', PROFILES['high-energy'].minGap < PROFILES.gaming.minGap);

  /* Whatever a profile does, the three moments the viewer is waiting for are
     never the ones it drops. */
  for (const id of PROFILE_IDS) {
    ok(`${id}: the payment, the mail and the code always sound`,
      ['payment', 'email', 'reveal'].every((k) => mixes[id].cues.some((c) => c.kind === k)));
  }
  ok('the report says what was dropped and why',
    report(mixes.premium, PROFILES.premium).join(' ').includes('dropped'));
}

console.log('\n— One video, four mixes —');
{
  ok('compose takes a profile', /arg\('sounds'\) \|\| arg\('sound'\)/.test(compose));
  ok('…or all of them', /arg\('sounds'\) === 'all' \? PROFILE_IDS/.test(compose));
  ok('an unknown profile stops the run', /No sound profile "\$\{id\}"/.test(compose));
  ok('a variant may carry its own', /variant\?\.sound/.test(compose));

  /* "The same video with a different sound profile" has to mean the same video.
     Re-rendering four times would give four files differing in the encoder's
     noise as well as in the mix. Verified on a real render: one video MD5,
     four audio MD5s. */
  ok('the extra profiles copy the video rather than re-encoding it',
    /'-c:v', 'copy'/.test(compose));
  ok('…and the profile is in the filename', /\$\{stem\}-\$\{id\}\.mp4/.test(compose));
  ok('the plan is built once for all of them',
    compose.indexOf('const cuePlan = planCues(') < compose.indexOf('const audioFor ='));

  ok('the mix is still normalised to what the platforms play at',
    /loudnorm=I=-14:TP=-1\.5:LRA=11/.test(compose));
  /* In TWO passes. Single-pass loudnorm estimates as it goes, and a
     twelve-second mix that is mostly silence between transients is exactly
     where the estimate fails: minimal came out at −33.0 LUFS and −24.1 dBFS
     peak, twenty under the platforms — the same fault this toolkit already
     fixed once. Measured first, the four profiles land at −13.4 to −13.8. */
  ok('…measured first, not estimated as it goes', /const measured = \(profileId\)/.test(compose));
  ok('…and the measurement is handed back', /measured_I=\$\{m\.input_i\}/.test(compose)
    && /offset=\$\{m\.target_offset\}/.test(compose));
  ok('…as a single gain, so a sparse mix stays sparse', /linear=true/.test(compose));
  ok('…and every profile is measured, not just the first',
    /audioFor\(id, 0, measured\(id\)\)/.test(compose));
  /* alimiter auto-levels its output UP to the limit unless told not to, so it
     had been undoing loudnorm: dropping the limit made the files louder. */
  ok('the limiter only ever reduces', /level=disabled/.test(compose));
  /* And limited below the ceiling, not at it: alimiter limits the SAMPLE peak
     and every platform re-encodes, which adds inter-sample overshoot. Measured
     at 0.95, two profiles delivered 0.0 dBFS true peak. */
  ok('…and still limited, because loudnorm does not stop a transient',
    /alimiter=limit=0\.85:level=disabled/.test(compose));
  ok('…with headroom for what a lossy re-encode adds on top',
    Number(/alimiter=limit=(0\.\d+)/.exec(compose)[1]) <= 0.89);
  ok('a silent profile still produces a valid track', /volume=0,atrim=duration/.test(compose));
  ok('pitch is a rate shift, resampled straight back',
    /asetrate=48000\*\$\{c\.pitch\},aresample=48000/.test(compose));
}

console.log('\n— Nothing sampled, nothing licensed —');
{
  ok('the two new sounds are waveform maths like the rest',
    /select: \{[\s\S]{0,120}expr:/.test(sfxSrc) && /tail: \{[\s\S]{0,120}expr:/.test(sfxSrc));
  ok('the select cue is quieter than the payment it is not',
    CUES.select.gain < CUES.payment.gain);
  ok('sound.mjs reads the edit, never the recording',
    !/beats\.json|raw\.webm/.test(soundSrc));
  ok('…and is runnable on its own to see what a profile does',
    /import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`/.test(soundSrc));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ad-sound: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
