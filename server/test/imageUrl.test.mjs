/** Pure-unit checks for the product-image helpers: what counts as a safe image
 *  value, the SSRF guard, og:image extraction and the Pinterest-style resolver.
 *  No DB or network — the resolver runs against a mock fetch. */
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };
const threw = async (fn) => { try { await fn(); return false; } catch { return true; } };

const { isSafeImageValue, assertPublicHttpUrl, extractOgImage, resolveImageUrl } =
  await import('../src/utils/imageUrl.js');

// ── isSafeImageValue ─────────────────────────────────────────────────────────
console.log('— isSafeImageValue —');
ok('site path allowed', isSafeImageValue('/products/packs/brawl-2000.svg'));
ok('https link allowed', isSafeImageValue('https://i.pinimg.com/564x/ab.jpg'));
ok('http link allowed', isSafeImageValue('http://cdn.example.com/x.png'));
ok('png data URI allowed', isSafeImageValue('data:image/png;base64,iVBORw0KGgoAAAANSU='));
ok('jpeg data URI allowed', isSafeImageValue('data:image/jpeg;base64,/9j/4AAQSkZJRg=='));
ok('protocol-relative rejected', !isSafeImageValue('//evil.com/x.png'));
ok('svg data URI rejected (script vector)', !isSafeImageValue('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='));
ok('html data URI rejected', !isSafeImageValue('data:text/html;base64,PGgxPg=='));
ok('javascript: rejected', !isSafeImageValue('javascript:alert(1)'));
ok('empty rejected', !isSafeImageValue(''));
ok('oversized data URI rejected', !isSafeImageValue('data:image/png;base64,' + 'A'.repeat(3_100_000)));

// ── assertPublicHttpUrl (SSRF guard) ─────────────────────────────────────────
console.log('— assertPublicHttpUrl —');
ok('public https ok', assertPublicHttpUrl('https://i.pinimg.com/x.jpg').hostname === 'i.pinimg.com');
ok('localhost blocked', await threw(() => assertPublicHttpUrl('http://localhost/x')));
ok('127.0.0.1 blocked', await threw(() => assertPublicHttpUrl('http://127.0.0.1:8080/x')));
ok('metadata IP blocked', await threw(() => assertPublicHttpUrl('http://169.254.169.254/latest/meta-data')));
ok('private 10.x blocked', await threw(() => assertPublicHttpUrl('http://10.0.0.5/x')));
ok('.internal blocked', await threw(() => assertPublicHttpUrl('http://db.internal/x')));
ok('ftp blocked', await threw(() => assertPublicHttpUrl('ftp://example.com/x')));
ok('garbage blocked', await threw(() => assertPublicHttpUrl('not a url')));

// ── extractOgImage ───────────────────────────────────────────────────────────
console.log('— extractOgImage —');
ok('og:image (property first)', extractOgImage('<meta property="og:image" content="https://i.pinimg.com/orig/a.jpg">') === 'https://i.pinimg.com/orig/a.jpg');
ok('og:image (content first)', extractOgImage('<meta content="https://i.pinimg.com/orig/b.jpg" property="og:image">') === 'https://i.pinimg.com/orig/b.jpg');
ok('twitter:image fallback', extractOgImage('<meta name="twitter:image" content="https://x.com/c.jpg">') === 'https://x.com/c.jpg');
ok('none → null', extractOgImage('<html><body>no meta</body></html>') === null);

// ── resolveImageUrl (mock fetch) ─────────────────────────────────────────────
console.log('— resolveImageUrl —');
const mockFetch = (map) => async (url) => {
  const r = map[url];
  if (!r) throw new Error('network');
  return {
    url: r.finalUrl || url,
    headers: { get: (k) => (r.headers || {})[k.toLowerCase()] ?? null },
    text: async () => r.body || '',
  };
};

// A direct image link passes straight through.
{
  const f = mockFetch({ 'https://i.pinimg.com/orig/a.jpg': { headers: { 'content-type': 'image/jpeg' } } });
  const out = await resolveImageUrl('https://i.pinimg.com/orig/a.jpg', { fetchImpl: f });
  ok('direct image returned as-is', out === 'https://i.pinimg.com/orig/a.jpg');
}
// A pin page → its og:image.
{
  const f = mockFetch({ 'https://pin.it/abc': {
    finalUrl: 'https://www.pinterest.com/pin/123/',
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '<html><head><meta property="og:image" content="https://i.pinimg.com/orig/real.jpg"></head></html>',
  } });
  const out = await resolveImageUrl('https://pin.it/abc', { fetchImpl: f });
  ok('page link resolves to og:image', out === 'https://i.pinimg.com/orig/real.jpg', out);
}
// A relative og:image resolves against the final URL.
{
  const f = mockFetch({ 'https://shop.example.com/item': {
    headers: { 'content-type': 'text/html' },
    body: '<meta property="og:image" content="/img/hero.png">',
  } });
  const out = await resolveImageUrl('https://shop.example.com/item', { fetchImpl: f });
  ok('relative og:image made absolute', out === 'https://shop.example.com/img/hero.png', out);
}
// HTML with no image → clear error.
{
  const f = mockFetch({ 'https://example.com/none': { headers: { 'content-type': 'text/html' }, body: '<p>nothing</p>' } });
  ok('no image on page throws', await threw(() => resolveImageUrl('https://example.com/none', { fetchImpl: f })));
}
// Private host is rejected before any fetch.
ok('resolver blocks private host', await threw(() => resolveImageUrl('http://169.254.169.254/x', { fetchImpl: async () => { throw new Error('should not fetch'); } })));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
