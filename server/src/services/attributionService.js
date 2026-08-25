/**
 * Advertising attribution: which creative actually sold something.
 *
 * The shop runs adverts cut by scripts/ad/ — eight variants per product, each
 * with its own hook. Until now every one of them pointed at the same untagged
 * homepage, so the only available answer to "which one works" was whichever one
 * you happened to like. This turns that into a number.
 *
 * ── The chain ─────────────────────────────────────────────────────────────
 *
 *   ad click     happens on TikTok/YouTube; we never see it. What we see is the
 *                arrival it produced, carrying the parameters we put in the link.
 *   visit        one ad_visits row. This is our end of the click.
 *   product view an ad_events row, deduplicated per visit.
 *   checkout     an ad_events row, deduplicated per visit.
 *   purchase     orders.ad_visit_id, counted only when the order is actually paid.
 *
 * The last step is not an event. "Did it sell" already has exactly one authority
 * in this codebase — the order's status — and a second copy of that fact is a
 * second copy that can drift out of step with refunds, chargebacks and manual
 * cancellations. So the funnel's last stage is a join, not a row.
 *
 * ── What is deliberately not collected ────────────────────────────────────
 *
 * No IP, no user agent, no fingerprint, no email, and no platform click id.
 * ttclid / gclid / wbraid / fbclid are per-person handles; their only real use is
 * posting conversions back to the network, which nobody asked for. Their
 * PRESENCE tells us which network sent the click, so that is read and the value
 * itself is dropped before anything is written — see `NETWORK_CLICK_IDS`.
 *
 * The referrer is reduced to a host. A full referrer URL routinely carries a
 * query string from somebody else's site, and none of it is ours to keep.
 *
 * ── Consent ───────────────────────────────────────────────────────────────
 *
 * Following one person from click to purchase needs an identifier stored on
 * their device, which needs marketing consent. Counting arrivals does not. So
 * `sessionId` is optional throughout: without it a visit is still recorded and
 * still counted, it simply has nothing later to join to. Consent buys the
 * funnel, not the count — and a refused banner degrades the report rather than
 * emptying it.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';

const clip = (s, n) => {
  if (s === null || s === undefined) return null;
  const v = String(s).trim().slice(0, n);
  return v || null;
};

/**
 * Click-id parameter → network.
 *
 * Read for the network name only. The value is never stored: see the header.
 */
const NETWORK_CLICK_IDS = {
  ttclid: 'tiktok',
  gclid: 'google',
  gbraid: 'google',
  wbraid: 'google',
  fbclid: 'meta',
  msclkid: 'microsoft',
  twclid: 'twitter',
  li_fat_id: 'linkedin',
  epik: 'pinterest',
  sclid: 'snapchat',
};

/** utm_source values we recognise as a network, so `?utm_source=tiktok` works alone. */
const SOURCE_NETWORKS = {
  tiktok: 'tiktok',
  tiktokads: 'tiktok',
  youtube: 'youtube',
  yt: 'youtube',
  google: 'google',
  googleads: 'google',
  adwords: 'google',
  instagram: 'meta',
  facebook: 'meta',
  ig: 'meta',
  fb: 'meta',
  meta: 'meta',
  reels: 'meta',
  shorts: 'youtube',
  discord: 'discord',
  snapchat: 'snapchat',
  reddit: 'reddit',
  x: 'twitter',
  twitter: 'twitter',
};

/**
 * Parameter aliases, in priority order.
 *
 * Every network names the same three things differently, and TikTok and Google
 * both hand you macros that expand at click time. Rather than a branch per
 * network, each field lists the spellings it answers to and the first one
 * present wins — so a link tagged the standard UTM way and a link tagged with
 * TikTok's own macros both land in the same column.
 *
 * The short forms (`cid`, `crid`) exist because a TikTok bio link is typed by a
 * human on a phone and `utm_campaign=` is four times the length of `cid=`.
 */
const FIELDS = {
  source: ['utm_source', 'source', 'src'],
  medium: ['utm_medium', 'medium'],
  campaign: ['utm_campaign', 'campaign', 'campaign_name'],
  content: ['utm_content', 'content'],
  term: ['utm_term', 'term', 'keyword'],
  // TikTok: campaign_id / __CAMPAIGN_ID__. Google: campaignid. UTM: utm_id.
  campaignId: ['utm_id', 'campaign_id', 'campaignid', 'cid', 'tt_campaign_id'],
  adgroupId: ['adgroup_id', 'adgroupid', 'aid', 'ad_group_id', 'tt_adgroup_id'],
  // TikTok: creative_id / ad_id / __CID__. Google: creative / creativeid.
  creativeId: ['creative_id', 'creativeid', 'creative', 'ad_id', 'adid', 'crid', 'tt_creative_id'],
  placement: ['placement', '__placement__', 'ad_placement', 'network'],
  product: ['product', 'product_id', 'pid', 'sku'],
};

const first = (query, keys) => {
  for (const k of keys) {
    // Networks hand back MACRO-SHAPED strings when a macro was not substituted
    // (`__CID__`, `{creative_id}`). Storing those would create a phantom
    // creative that outsells every real one, so treat them as absent.
    const v = clip(query?.[k], 200);
    if (v && !/^(__.*__|\{.*\}|%7B.*%7D)$/i.test(v)) return v;
  }
  return null;
};

/**
 * Read campaign parameters out of a query object.
 *
 * Returns `{ ...fields, network, hasAdParams }`. `hasAdParams` is what decides
 * whether an arrival is an ad arrival at all — someone typing the address in
 * directly must not create a visit row with every column null, because a
 * thousand of those would dilute every rate in the report.
 */
export function parseParams(query = {}) {
  const out = {};
  for (const [field, keys] of Object.entries(FIELDS)) out[field] = first(query, keys);

  /* Which network, in descending order of how much we trust the answer.
     utm_source FIRST, because it is what the advertiser declared and the click
     id is only ever an inference. A YouTube advert bought through Google Ads
     arrives carrying gclid, so reading the click id first files every YouTube
     campaign under "google" — true of the billing, and useless when the
     question is which platform the video is working on. */
  let network = out.source
    ? (SOURCE_NETWORKS[out.source.toLowerCase().replace(/[^a-z0-9]/g, '')] || null)
    : null;
  if (!network) {
    for (const [param, net] of Object.entries(NETWORK_CLICK_IDS)) {
      if (query?.[param]) { network = net; break; }      // value read, never kept
    }
  }

  const hasAdParams = !!(network || out.source || out.campaign || out.campaignId
    || out.creativeId || out.medium || out.content);

  return { ...out, network, hasAdParams };
}

/** The names a tagged link may use — for the docs, the admin UI, and the tests. */
export const RECOGNISED_PARAMS = [
  ...new Set([...Object.values(FIELDS).flat(), ...Object.keys(NETWORK_CLICK_IDS)]),
];

/** Host only. A full referrer belongs to whoever sent it, query string and all. */
function referrerHost(ref) {
  if (!ref) return null;
  try { return clip(new URL(String(ref)).hostname.replace(/^www\./, ''), 120); }
  catch { return null; }
}

/** Resolve a `?product=` value against an id, a SKU, or a name-ish slug. */
async function resolveProduct(value) {
  if (!value) return null;
  const v = String(value).trim();
  const row = await get(
    `SELECT id FROM products WHERE id = @v OR UPPER(sku) = UPPER(@v) LIMIT 1`, { v });
  return row?.id || null;
}

/**
 * How long one click keeps its claim on a session.
 *
 * Someone who clicks an advert, browses, leaves and comes back a week later
 * through a search is not that advert's sale. Thirty days is the window the
 * networks themselves report on, so the number here is comparable to the number
 * in their dashboard rather than quietly generous.
 */
export const ATTRIBUTION_WINDOW_DAYS = 30;

/** How long the raw rows are kept before the aggregates are all that remain. */
export const RETENTION_DAYS = 400;

const sinceIso = (days) => new Date(Date.now() - days * 86_400_000).toISOString();

/**
 * Record an arrival that carried campaign parameters.
 *
 * Returns `{ id }` for the visit, or null when there was nothing to attribute.
 * Best-effort by design — an advert report is never worth failing a page load
 * over — but the caller gets the id back, because the whole point is that the
 * checkout can quote it later.
 */
export async function recordVisit({ sessionId, query, path, referrer } = {}) {
  try {
    const p = parseParams(query || {});
    if (!p.hasAdParams) return null;

    const sid = clip(sessionId, 64);

    /* Last touch wins, but a reload is not a new touch.
       A tagged link opened twice in a minute — a tap, a back, a tap again — is
       one click as far as the platform is concerned, and counting it twice
       would halve the measured conversion rate of the creative that earned it.
       Same session and same creative within the hour reuses the visit. */
    if (sid) {
      const recent = await get(
        `SELECT id FROM ad_visits
          WHERE session_id = @sid
            AND COALESCE(creative_id,'') = COALESCE(@crid,'')
            AND COALESCE(campaign_id,'') = COALESCE(@cid,'')
            AND COALESCE(campaign,'')    = COALESCE(@camp,'')
            AND created_at > @since
          ORDER BY created_at DESC LIMIT 1`,
        { sid, crid: p.creativeId, cid: p.campaignId, camp: p.campaign,
          since: new Date(Date.now() - 3_600_000).toISOString() });
      if (recent) return { id: recent.id, deduped: true };
    }

    const id = newId('adv');
    await run(
      `INSERT INTO ad_visits
         (id, session_id, network, source, medium, campaign, content, term,
          campaign_id, adgroup_id, creative_id, placement, product_id,
          landing_path, referrer_host, created_at)
       VALUES (@id, @sid, @net, @src, @med, @camp, @cont, @term,
          @cid, @agid, @crid, @plc, @pid, @path, @rhost, @at)`,
      { id, sid, net: p.network, src: p.source, med: p.medium, camp: p.campaign,
        cont: p.content, term: p.term, cid: p.campaignId, agid: p.adgroupId,
        crid: p.creativeId, plc: p.placement,
        pid: await resolveProduct(p.product),
        path: clip(path, 300), rhost: referrerHost(referrer), at: nowIso() });
    return { id, deduped: false };
  } catch (e) {
    console.error('[attribution] visit', e.message);
    return null;
  }
}

/**
 * Give an already-recorded anonymous visit the identifier it was missing.
 *
 * The banner is answered AFTER the page has loaded, which used to mean two rows
 * for one click: an anonymous one written on arrival, and an identified one
 * written the moment the visitor pressed Accept. Measured against a real click:
 * two visits, one person, every conversion rate halved.
 *
 * Reporting the arrival only once the banner is answered would have been the
 * other kind of wrong — every visitor who ignores it would vanish from the
 * count. So the arrival is recorded immediately without an id, and consent
 * attaches one to the row that already exists.
 *
 * Only ever fills a NULL session_id. A visit that already has one belongs to
 * somebody, and letting a later caller overwrite it would let anyone who learns
 * a visit id claim its purchase.
 */
export async function adoptVisit(visitId, sessionId) {
  try {
    const id = clip(visitId, 64);
    const sid = clip(sessionId, 64);
    if (!id || !sid) return null;
    await run(
      `UPDATE ad_visits SET session_id = @sid
        WHERE id = @id AND session_id IS NULL AND created_at > @since`,
      { id, sid, since: sinceIso(ATTRIBUTION_WINDOW_DAYS) });
    return (await get(
      `SELECT id FROM ad_visits WHERE id = @id AND session_id = @sid`, { id, sid }))?.id || null;
  } catch (e) {
    console.error('[attribution] adopt', e.message);
    return null;
  }
}

/** The visit a session should be credited to, or null. */
export async function latestVisit(sessionId) {
  const sid = clip(sessionId, 64);
  if (!sid) return null;
  const r = await get(
    `SELECT id FROM ad_visits
      WHERE session_id = @sid AND created_at > @since
      ORDER BY created_at DESC LIMIT 1`,
    { sid, since: sinceIso(ATTRIBUTION_WINDOW_DAYS) });
  return r?.id || null;
}

/** A visit id is only usable if it exists and is still inside the window. */
export async function validVisit(visitId) {
  const id = clip(visitId, 64);
  if (!id) return null;
  const r = await get(
    `SELECT id FROM ad_visits WHERE id = @id AND created_at > @since`,
    { id, since: sinceIso(ATTRIBUTION_WINDOW_DAYS) });
  return r?.id || null;
}

const EVENT_KINDS = new Set(['product_view', 'checkout']);

/**
 * Record a funnel step against a visit.
 *
 * Deduplicated in the database, not here — the unique index is the thing that
 * holds when two tabs fire at once, and a SELECT-then-INSERT is exactly the
 * race it exists to lose.
 */
export async function recordEvent({ visitId, sessionId, kind, productId } = {}) {
  try {
    if (!EVENT_KINDS.has(kind)) return null;
    const visit = (await validVisit(visitId)) || (await latestVisit(sessionId));
    if (!visit) return null;                 // not an ad visitor; nothing to say
    await run(
      `INSERT INTO ad_events (id, visit_id, kind, product_id, created_at)
       VALUES (@id, @v, @k, @p, @at)
       ON CONFLICT DO NOTHING`,
      { id: newId('ade'), v: visit, k: kind, p: clip(productId, 64), at: nowIso() });
    return { visitId: visit };
  } catch (e) {
    console.error('[attribution] event', e.message);
    return null;
  }
}

/**
 * Attach an order to the visit that produced it. Called once, at order creation.
 *
 * Written with `ad_visit_id IS NULL` in the WHERE so a retry, a resumed
 * checkout or a second call can never re-attribute a sale to a later advert the
 * buyer happened to click while their order sat unpaid.
 */
export async function attachOrder(orderId, { visitId, sessionId } = {}) {
  try {
    const visit = (await validVisit(visitId)) || (await latestVisit(sessionId));
    if (!visit) return null;
    await run(
      `UPDATE orders SET ad_visit_id = @v WHERE id = @o AND ad_visit_id IS NULL`,
      { v: visit, o: orderId });
    return visit;
  } catch (e) {
    console.error('[attribution] attach', e.message);
    return null;
  }
}

/* Paid, not refunded — the same definition analyticsService uses for revenue,
   deliberately copied rather than re-invented so the attribution report and the
   revenue chart can never disagree about what a sale is. */
const PAID = "status IN ('payment_received','processing','awaiting_fulfillment','completed')";

/**
 * Per-visit rollups, joined once each.
 *
 * A visit has many events AND may have an order, and joining both onto ad_visits
 * in one statement multiplies them: three events beside one paid order makes
 * SUM(total) report the sale three times. COUNT(DISTINCT) hides it — the money
 * does not. So each side is collapsed to one row per visit before it is joined,
 * and every column below is then a plain sum of things that exist once.
 */
const ROLLUPS = `
  WITH ev AS (
    SELECT visit_id,
           MAX(CASE WHEN kind = 'product_view' THEN 1 ELSE 0 END) AS pv,
           MAX(CASE WHEN kind = 'checkout'     THEN 1 ELSE 0 END) AS co
      FROM ad_events GROUP BY visit_id
  ), ord AS (
    SELECT ad_visit_id,
           COUNT(*)              AS purchases,
           COALESCE(SUM(total),0) AS revenue
      FROM orders
     WHERE ad_visit_id IS NOT NULL AND ${PAID}
     GROUP BY ad_visit_id
  )`;

/**
 * The report: one row per creative, with what it actually produced.
 *
 * Grouped by creative first and campaign second, because "which advert" is the
 * question being asked. A creative with no id of its own falls back to its
 * utm_content and then to the campaign, so a link tagged only the basic UTM way
 * still appears rather than collapsing into one anonymous bucket.
 */
export async function creativePerformance({ days = 30, limit = 100 } = {}) {
  const since = sinceIso(days);
  const rows = await all(
    `${ROLLUPS}
     SELECT
        COALESCE(v.creative_id, v.content, '—')  AS creative,
        COALESCE(v.campaign, v.campaign_id, '—') AS campaign,
        v.network                          AS network,
        COUNT(*)                           AS visits,
        COALESCE(SUM(ev.pv), 0)            AS product_views,
        COALESCE(SUM(ev.co), 0)            AS checkouts,
        COALESCE(SUM(ord.purchases), 0)    AS purchases,
        COALESCE(SUM(ord.revenue), 0)      AS revenue
      FROM ad_visits v
      LEFT JOIN ev  ON ev.visit_id     = v.id
      LEFT JOIN ord ON ord.ad_visit_id = v.id
     WHERE v.created_at > @since
     GROUP BY 1, 2, 3
     ORDER BY revenue DESC, purchases DESC, visits DESC
     LIMIT @limit`,
    { since, limit });

  return rows.map((r) => {
    const visits = Number(r.visits || 0);
    const purchases = Number(r.purchases || 0);
    const revenue = Number(r.revenue || 0);
    return {
      creative: r.creative,
      campaign: r.campaign,
      network: r.network || null,
      visits,
      productViews: Number(r.product_views || 0),
      checkouts: Number(r.checkouts || 0),
      purchases,
      revenue,
      /* Null, not zero, when there is nothing to divide. A creative that has had
         four visits and no sale has a conversion rate of 0%; one that has had no
         visits at all does not have a conversion rate, and showing 0% for it
         reads as "this advert fails" when the truth is "this advert has not run
         yet". Same rule the recovery card already follows. */
      conversionRate: visits ? Math.round((purchases / visits) * 1000) / 10 : null,
      revenuePerVisit: visits ? Math.round(revenue / visits) : null,
    };
  });
}

/**
 * The same numbers rolled up per campaign, for when there are many creatives.
 *
 * Grouped by campaign ALONE. Network is a property of the campaign here, not a
 * second grouping key: one launch pushed to TikTok and YouTube is one campaign,
 * and splitting it in two makes the rollup a longer version of the creative
 * table rather than a summary of it. The networks it ran on come back as a list,
 * which is the thing you actually want to read next to the total.
 */
export async function campaignPerformance({ days = 30, limit = 50 } = {}) {
  const since = sinceIso(days);
  const rows = await all(
    `${ROLLUPS}
     SELECT
        COALESCE(v.campaign, v.campaign_id, '—') AS campaign,
        STRING_AGG(DISTINCT v.network, ',') AS networks,
        COUNT(*)                           AS visits,
        COUNT(DISTINCT COALESCE(v.creative_id, v.content)) AS creatives,
        COALESCE(SUM(ord.purchases), 0)    AS purchases,
        COALESCE(SUM(ord.revenue), 0)      AS revenue
      FROM ad_visits v
      LEFT JOIN ord ON ord.ad_visit_id = v.id
     WHERE v.created_at > @since
     GROUP BY 1
     ORDER BY revenue DESC, visits DESC
     LIMIT @limit`,
    { since, limit });
  return rows.map((r) => ({
    campaign: r.campaign,
    networks: r.networks ? r.networks.split(',').sort() : [],
    visits: Number(r.visits || 0),
    creatives: Number(r.creatives || 0),
    purchases: Number(r.purchases || 0),
    revenue: Number(r.revenue || 0),
    conversionRate: Number(r.visits) ? Math.round((Number(r.purchases) / Number(r.visits)) * 1000) / 10 : null,
  }));
}

/**
 * The five stages, in order, with the drop between each.
 *
 * `adClicks` is not measured here and says so. The click happens on TikTok's
 * servers; the only honest number this shop has is the arrival it produced, and
 * reporting arrivals as clicks would silently absorb every click that never
 * loaded the page.
 */
export async function funnel({ days = 30 } = {}) {
  const since = sinceIso(days);
  const r = await get(
    `${ROLLUPS}
     SELECT
        COUNT(*)                        AS visits,
        COALESCE(SUM(ev.pv), 0)         AS product_views,
        COALESCE(SUM(ev.co), 0)         AS checkouts,
        COALESCE(SUM(ord.purchases), 0) AS purchases,
        COALESCE(SUM(ord.revenue), 0)   AS revenue,
        COUNT(*) FILTER (WHERE v.session_id IS NULL) AS unfollowed
      FROM ad_visits v
      LEFT JOIN ev  ON ev.visit_id     = v.id
      LEFT JOIN ord ON ord.ad_visit_id = v.id
     WHERE v.created_at > @since`, { since });

  const visits = Number(r?.visits || 0);
  const productViews = Number(r?.product_views || 0);
  const checkouts = Number(r?.checkouts || 0);
  const purchases = Number(r?.purchases || 0);
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

  return {
    rangeDays: days,
    // Named so nobody reads it as a click count. See the note above.
    adClicksMeasured: false,
    stages: [
      { id: 'visit', label: 'Website visit', count: visits, ofPrevious: null },
      { id: 'product_view', label: 'Product view', count: productViews, ofPrevious: pct(productViews, visits) },
      { id: 'checkout', label: 'Checkout', count: checkouts, ofPrevious: pct(checkouts, productViews) },
      { id: 'purchase', label: 'Purchase', count: purchases, ofPrevious: pct(purchases, checkouts) },
    ],
    revenue: Number(r?.revenue || 0),
    conversionRate: pct(purchases, visits),
    /* Visits with no session id: counted, but impossible to follow, because the
       visitor refused marketing storage. Surfaced rather than hidden — a funnel
       that narrows sharply is a different problem from a funnel measuring a
       population it is not allowed to follow, and the owner needs to be able to
       tell those apart. */
    notFollowed: Number(r?.unfollowed || 0),
  };
}

/**
 * Drop rows past the retention window.
 *
 * ad_events cascade with their visit. Orders keep their ad_visit_id — a dangling
 * pointer, on purpose: the revenue stays counted in the order's own history, and
 * the row it pointed at is gone.
 */
export async function pruneAttribution({ days = RETENTION_DAYS } = {}) {
  const cutoff = sinceIso(days);
  const before = await get('SELECT COUNT(*) AS n FROM ad_visits WHERE created_at <= @c', { c: cutoff });
  await run('DELETE FROM ad_visits WHERE created_at <= @c', { c: cutoff });
  return { removed: Number(before?.n || 0), cutoff };
}
