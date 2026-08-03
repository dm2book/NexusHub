import { useEffect } from 'react';
import { SITE, metaFor, canonicalFor, NOINDEX } from '../content/seo.js';

/**
 * Keep the head correct while the app is running.
 *
 * The tags that matter for search and for link previews are already in the HTML
 * — written per route at build time by scripts/prerender.mjs, and per product at
 * request time by server/src/routes/seo.js. That is the half that counts, since
 * a link scraper never executes any of this.
 *
 * What this does is the other half: a visitor clicking from the shop to a
 * product never reloads the document, so without it the tab title and the
 * canonical would still describe the page they arrived on. It reads from the
 * same content/seo.js the prerender uses, so the two cannot disagree.
 */

const upsert = (selector, create) => {
  let el = document.head.querySelector(selector);
  if (!el) { el = create(); document.head.appendChild(el); }
  return el;
};

const setMeta = (attr, key, value) => {
  if (!value) return;
  const el = upsert(`meta[${attr}="${key}"]`, () => {
    const m = document.createElement('meta');
    m.setAttribute(attr, key);
    return m;
  });
  el.setAttribute('content', value);
};

/**
 * Set the title, description, canonical and social tags for the current page.
 *
 * `title` and `description` are optional: a route with copy in seo.js uses that,
 * so a page does not have to repeat itself. Pages with content of their own —
 * a product, a category — pass it in.
 */
export function usePageMeta(title, description, { image, type = 'website' } = {}) {
  useEffect(() => {
    const path = window.location.pathname;
    const fallback = metaFor(path, document.documentElement.lang === 'nl' ? 'nl' : 'en');
    const t = title ? `${title} · ${SITE.name}` : `${fallback.title} · ${SITE.name}`;
    const d = description || fallback.description;
    const canonical = canonicalFor(path);
    const img = image
      ? (image.startsWith('http') ? image : SITE.url + image)
      : SITE.url + SITE.ogImage;

    document.title = t;
    setMeta('name', 'description', d);

    // Referral links (?ref=) and shop filters (?category=) both mint crawlable
    // duplicates of the same page. Point every URL at its clean self so the
    // duplicates consolidate instead of competing.
    upsert('link[rel="canonical"]', () => {
      const l = document.createElement('link');
      l.setAttribute('rel', 'canonical');
      return l;
    }).setAttribute('href', canonical);

    // Kept in sync for the same reason the canonical is: someone who navigates
    // in-app and then shares from the address bar should not send the preview
    // of the page they arrived on.
    setMeta('property', 'og:title', t);
    setMeta('property', 'og:description', d);
    setMeta('property', 'og:url', canonical);
    setMeta('property', 'og:type', type);
    setMeta('property', 'og:image', img);
    setMeta('name', 'twitter:title', t);
    setMeta('name', 'twitter:description', d);
    setMeta('name', 'twitter:image', img);

    // Checkout, cart and the account area have nothing to offer a search result.
    const clean = path.replace(/\/+$/, '') || '/';
    const hidden = NOINDEX.has(clean) || clean.startsWith('/account') || clean.startsWith('/admin');
    const robots = document.head.querySelector('meta[name="robots"]');
    if (hidden) setMeta('name', 'robots', 'noindex, follow');
    else if (robots) robots.remove();
  }, [title, description, image, type]);
}

/**
 * Inject a schema.org JSON-LD block for rich search results.
 *
 * Removed on unmount so structured data never leaks onto the next page — a
 * Product block still sitting on the checkout is the kind of mismatch that
 * earns a manual action rather than a rich result.
 */
export function useJsonLd(id, data) {
  const json = data ? JSON.stringify(data) : '';
  useEffect(() => {
    if (!json) return undefined;
    let tag = document.getElementById(`jsonld-${id}`);
    if (!tag) {
      tag = document.createElement('script');
      tag.type = 'application/ld+json';
      tag.id = `jsonld-${id}`;
      document.head.appendChild(tag);
    }
    tag.textContent = json;
    return () => tag.remove();
  }, [id, json]);
}
