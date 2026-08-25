/**
 * Ad attribution, browser side.
 *
 * The adverts this shop cuts (scripts/ad/) each get their own tagged link. This
 * reads those parameters off the landing URL, tells the server, remembers which
 * visit it was, and then reports the two funnel steps in between — a product
 * looked at and a checkout reached. The purchase is attached by the server at
 * order creation, because that is the only place a sale is a fact.
 *
 * ── Consent ───────────────────────────────────────────────────────────────
 *
 * Remembering the visit across page loads means writing an id to this person's
 * device, which is exactly the thing the banner asks about. So:
 *
 *   marketing allowed      the visit id is persisted, the funnel joins up, and
 *                          the purchase is credited to the advert that earned it.
 *   marketing refused      the landing is still reported — a bare campaign
 *                          counter with no identifier is not personal data and
 *                          nothing is written to the device — but it is reported
 *                          without an id, so it can be counted and not followed.
 *
 * The report says how many of those there were rather than quietly folding them
 * in, so a narrow funnel can be told apart from a funnel measuring people it is
 * not allowed to follow.
 *
 * Nothing here ever throws into a render. A shop that cannot sell because its
 * advert reporting broke is a worse outcome than not knowing which advert sold.
 */
import { api } from './api.js';
import { allowed } from './consent.js';

/** Kept in sessionStorage: one browsing session is the natural life of a click. */
const KEY = 'fm_attr';

/**
 * Parameters that mark an arrival as coming from an advert.
 *
 * The server owns the full list and does the real parsing — this is only the
 * cheap "is it worth sending at all" test, so it stays short on purpose and
 * matches the FIELDS/NETWORK_CLICK_IDS tables in attributionService.js.
 */
const AD_PARAM = /^(utm_|tt_)|^(source|medium|campaign|content|term|src|cid|crid|aid|adid|creative|creative_id|creativeid|campaign_id|campaignid|campaign_name|adgroup_id|adgroupid|ad_group_id|ad_id|placement|ad_placement|network|keyword|product|product_id|pid|sku)$|clid$|^gclid$|^gbraid$|^wbraid$|^fbclid$|^msclkid$|^epik$|^li_fat_id$/i;

const readStore = () => {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
};

/** Merge, never replace: the id and the visit are written at different moments. */
const writeStore = (patch) => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...(readStore() || {}), ...patch }));
  } catch { /* private mode */ }
};

/** Drop everything this device is holding. Called when marketing is refused. */
export function forgetAttribution() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  // The in-memory copies too, or a refusal would leave the page still able to
  // attribute the next click from this load.
  visitThisLoad = null;
  queued.length = 0;
}

/**
 * The anonymous id used to join a landing to a later purchase.
 *
 * Its own id, stored beside the visit under the marketing category — NOT the
 * `fm_sid` the visitor counter uses. Sharing that one looked like the frugal
 * choice, and it was wrong: fm_sid belongs to the analytics category, so a
 * visitor who allows marketing and refuses analytics has it purged out from
 * under them, and every one of those people silently drops out of the report.
 * Measured on a real run before it was two identifiers.
 *
 * Minted only when marketing is allowed, so a refusal leaves nothing behind,
 * and purged with the rest of the record when consent is withdrawn.
 */
function sessionId() {
  if (!allowed('marketing')) return null;
  try {
    const held = readStore();
    if (held?.sid) return held.sid;
    const sid = 'a_' + (crypto.randomUUID
      ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    writeStore({ sid });
    return sid;
  } catch { return null; }
}

/** Campaign parameters on the current URL, or null. */
function adParamsFrom(search) {
  const out = {};
  try {
    for (const [k, v] of new URLSearchParams(search)) {
      if (AD_PARAM.test(k) && v) out[k] = v;
    }
  } catch { return null; }
  return Object.keys(out).length ? out : null;
}

/**
 * The visit this page load produced, held in memory only.
 *
 * Memory, not storage, because at the moment it is set the visitor may not have
 * answered the banner yet and nothing may be written to their device. It exists
 * so that if they then say yes, consent can attach an id to the arrival already
 * on file rather than filing a second one — see the adopt path below.
 */
let visitThisLoad = null;

/**
 * Funnel steps that arrived before there was a visit to hang them on.
 *
 * Child effects run before parent effects in React, so the product page reports
 * its view before App has even started the landing request. Measured: the first
 * product view of every ad click was being dropped — and for an advert that
 * lands directly on the product it advertised, that is the only product view
 * there is. Holding them costs nothing and the queue is bounded, because an
 * unbounded one would be a memory leak with a nice name.
 */
const queued = [];
const QUEUE_MAX = 8;

/**
 * Report an arrival, once per set of parameters.
 *
 * Called on every route change, because a single-page app has exactly one real
 * page load and the tagged link may be the second thing a visitor opens.
 * Re-reporting the same parameters is prevented here AND deduplicated server
 * side within the hour — belt and braces, because the browser half is the half
 * that gets cleared.
 */
export async function reportLanding({ pathname, search }) {
  try {
    const params = adParamsFrom(search);
    if (!params) return;

    const marketing = allowed('marketing');
    const fingerprint = JSON.stringify(params);
    const held = readStore();
    if (marketing && held?.fingerprint === fingerprint) { flush(); return; }  // already sent

    const res = await api.post('/api/attribution/visit', {
      ...(marketing ? { sid: sessionId() || undefined } : {}),
      // Only meaningful together with a sid, and only for a visit this page load
      // recorded anonymously a moment ago. The server refuses to adopt a visit
      // that already belongs to somebody.
      ...(marketing && visitThisLoad ? { adopt: visitThisLoad } : {}),
      params,
      path: pathname,
      ref: document.referrer || undefined,
    });
    const visit = res?.visit || null;
    if (visit) visitThisLoad = visit;

    /* Only now, and only with permission. A refused banner leaves nothing on
       the device — not an id, not a campaign name, not the fact that they
       arrived from an advert. */
    if (marketing && visit) { writeStore({ visit, fingerprint, at: Date.now() }); flush(); }
  } catch { /* reporting is not the visitor's problem */ }
}

/**
 * Re-report the landing after consent is given, so the arrival already on file
 * gains its identifier instead of being filed twice. Called by the hook when
 * the banner is answered.
 */
export function onMarketingGranted(loc) {
  if (!allowed('marketing')) return;
  reportLanding(loc);
}

/** Send anything that was waiting for a visit to exist. */
function flush() {
  if (!queued.length) return;
  const batch = queued.splice(0, queued.length);
  for (const step of batch) send(step);
}

/** The visit this browser is carrying, if any. */
export function currentVisit() {
  return allowed('marketing') ? (readStore()?.visit || null) : null;
}

/**
 * What the checkout sends with the order.
 *
 * Both fields, because either alone can be the one that survives: the visit id
 * is exact but lives in sessionStorage, while the session id is durable but
 * only resolves to the most recent visit. The server prefers the visit id and
 * falls back.
 */
export function attributionForOrder() {
  if (!allowed('marketing')) return {};
  const visit = currentVisit();
  const sid = sessionId();
  return { ...(visit ? { adVisit: visit } : {}), ...(sid ? { adSession: sid } : {}) };
}

/**
 * Report a funnel step.
 *
 * Silent unless this browser is carrying a visit. The great majority of traffic
 * is not from an advert, and keying this on the session id instead would fire a
 * request on every product view the shop ever serves in exchange for a row the
 * server discards. The session id still travels as a second chance for the
 * server to resolve the visit, but it is not what decides to send.
 */
export function reportStep(kind, productId) {
  try {
    const step = { kind, productId };
    if (currentVisit()) return send(step);
    /* Queued even when marketing is not (yet) allowed. The banner is answered
       AFTER the page has rendered, so the product view of the page the advert
       landed on always happens first — refusing to queue it meant that view was
       lost for every visitor who said yes, which is all of the ones that count.
       Nothing is sent and nothing is stored until there is a visit; a refusal
       clears the queue and it dies with the page either way. */
    /* No visit yet. Either the landing is still in the air, or this browser is
       not carrying one at all. Queue it: a landing that lands flushes the
       queue, and one that never comes leaves it to be discarded with the page.
       The queue is what stops the landing product view — the most likely one
       there is — from being lost to its own round trip. */
    if (queued.length < QUEUE_MAX) queued.push(step);
  } catch { /* never break a page */ }
}

function send({ kind, productId }) {
  try {
    const visit = currentVisit();
    if (!visit) return;
    const sid = sessionId();
    api.post('/api/attribution/event', {
      kind,
      visit,
      ...(sid ? { sid } : {}),
      ...(productId ? { productId } : {}),
    }).catch(() => {});
  } catch { /* never break a page */ }
}
