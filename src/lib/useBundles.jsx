/**
 * The shop's active bundles, as GET /api/bundles prices them.
 *
 * Three surfaces show bundles now — the homepage row, /bundles and the "Cheaper
 * together" block on a product page — and a visitor walks between them. One
 * request per minute serves all three instead of one per page.
 *
 * Every number shown comes from that response: the server resolves each
 * bundle's products at today's prices (pricedBundles) and works out the normal
 * total, the bundle price and the saving. Nothing here computes a price, so the
 * card cannot promise a figure the checkout then contradicts — the checkout
 * applies the same bundle through POST /api/checkout/quote.
 *
 * Kept apart from bundles.js on purpose: the server imports that file for its
 * discount arithmetic, and it must not pull React in with it. The thumbnail
 * every bundle card draws lives here too, so the product page can show one
 * without loading the homepage row's code to get it.
 */
import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { api } from './api.js';
import { carriesOwnBackground } from './catalog.js';
import { iconFor } from './sampleCatalog.js';

/* A minute, then ask again. The server caches for 30 s and the edge for five
   minutes, so a tab left open all afternoon still catches a price change, and
   a visitor clicking from the homepage to a product page asks only once. */
const FRESH_MS = 60_000;
let cache = null;   // { at, list }
let inflight = null;

/** The bundles, as a promise. A failed request rejects — see useBundles. */
export function getBundles() {
  if (cache && Date.now() - cache.at < FRESH_MS) return Promise.resolve(cache.list);
  if (!inflight) {
    inflight = api.get('/api/bundles')
      .then((r) => {
        const list = Array.isArray(r?.bundles) ? r.bundles : [];
        cache = { at: Date.now(), list };
        /* Whether this shop has bundles at all, for the next visit: the rows
           that show them hold their space open only when something is likely
           to arrive. See expectBundles(). */
        try { localStorage.setItem('fm_had_bundles', list.length ? '1' : '0'); } catch { /* private mode */ }
        return list;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * The bundles as state.
 *
 * `bundles` is null while the first answer is on its way and an array after
 * it. `failed` is separate because "the shop has no bundles" and "the shop did
 * not answer" are different things to tell a visitor — the second must never
 * read as the first.
 */
export function useBundles() {
  const [state, setState] = useState(() => ({ bundles: cache ? cache.list : null, failed: false }));
  useEffect(() => {
    let live = true;
    getBundles()
      .then((list) => { if (live) setState({ bundles: list, failed: false }); })
      /* Keep what was already known: a hiccup on a refresh should not take
         the bundles off a page that was showing them a minute ago. */
      .catch(() => { if (live) setState((s) => ({ bundles: s.bundles || [], failed: !s.bundles })); });
    return () => { live = false; };
  }, []);
  return state;
}

/**
 * Should a bundle row hold its space before the answer arrives?
 *
 * Yes on a first visit — the common case, and the one where guessing wrong
 * costs least — and afterwards whatever the last answer said. A shop with no
 * bundles would otherwise open a gap and close it again, trading one layout
 * shift for another.
 */
export function expectBundles() {
  try { return localStorage.getItem('fm_had_bundles') !== '0'; } catch { return true; }
}

/**
 * The space the homepage's bundle row takes, held open until it arrives.
 *
 * Written here rather than in the row because the homepage reserves the same
 * space before the row's own code has loaded — the row is deferred, and the
 * sections under it must not jump when it lands. Measured with one bundle at
 * 360px and at 1280px.
 */
export const BUNDLE_ROW_SPACE = 'h-[354px] sm:h-[314px]';

/**
 * One product's picture at thumbnail size.
 *
 * The whole picture, never cropped: pack covers are 16:10, the generated boards
 * 7:6 and an owner's upload can be a portrait gift card, and cropping any of
 * those to one box throws away the amount or the brand. A bare category icon
 * has no background of its own, so it sits smaller on the tray instead of being
 * stretched to the edges.
 */
export function BundleThumb({ p }) {
  const src = p.image || iconFor(p.category);
  if (!src) return <Package size={20} className="text-slate-400" aria-hidden />;
  return (
    <img src={src} alt="" loading="lazy" decoding="async"
      className={carriesOwnBackground(src) ? 'w-full h-full object-contain' : 'w-9 h-9 object-contain'} />
  );
}
