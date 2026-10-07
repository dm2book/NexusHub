import { useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Download, Info, Archive, Rss, Copy } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageLoader } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { loadStaticFonts, loadImage, drawStatic, drawCatalog, carouselCards, drawCarouselCard, staticFileName } from '../../lib/adStudio/statics.js';
import { makeZip } from '../../lib/zip.js';

/**
 * Growth → Static ads.
 *
 * The still images Meta and TikTok run beside video: square (1:1), feed (4:5)
 * and story (9:16), per product, in four languages — the product's own card in
 * its brand's colours, the price, one line, the address. What each image may
 * say is decided on the server and passed through the shop's claim gate; this
 * page draws them (src/lib/adStudio/statics.js) and hands them over as PNG,
 * one at a time or all in one ZIP.
 */
const TEMPLATE = {
  price: 'Price', ladder: 'Amounts', myth: '"Free …" is fake', password: 'Username, not password',
  code: 'Code by email', refund: 'Not delivered? Money back', value: 'Price per 1,000', rating: 'Rating (real reviews only)',
};
const LANGS = { nl: 'Nederlands', en: 'English', de: 'Deutsch', fr: 'Français' };

function CarouselCard({ ad, spec, i, n, images }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.width = 1080; ref.current.height = 1080;
    drawCarouselCard(ref.current.getContext('2d'), ad, spec, images, i, n);
  }, [ad, spec, images, i, n]);
  const download = () => ref.current.toBlob((b) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = staticFileName(ad, `carousel-${i + 1}`, 'square'); a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
  return (
    <figure style={{ margin: 0 }}>
      <canvas ref={ref} data-testid={`carousel-${i + 1}`} style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 12, display: 'block', background: '#000' }} />
      <figcaption style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <button type="button" onClick={download} className="btn-ghost text-xs"><Download size={13} /> PNG</button>
      </figcaption>
    </figure>
  );
}

function Preview({ ad, tpl, fmtId, fmt, images }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.width = fmt.w; ref.current.height = fmt.h;
    drawStatic(ref.current.getContext('2d'), fmt, ad, tpl, images);
  }, [ad, tpl, fmt, images]);
  const download = () => ref.current.toBlob((b) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = staticFileName(ad, tpl.id, fmtId); a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
  return (
    <figure style={{ margin: 0 }}>
      <canvas ref={ref} data-testid={`static-${tpl.id}-${fmtId}`}
        style={{ width: '100%', aspectRatio: `${fmt.w} / ${fmt.h}`, borderRadius: 12, display: 'block', background: '#000' }} />
      <figcaption style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <span className="text-slate-400 text-xs">{fmt.label}</span>
        <button type="button" onClick={download} className="btn-ghost text-xs"><Download size={13} /> PNG</button>
      </figcaption>
    </figure>
  );
}

/**
 * The catalogue feed for dynamic product ads: the feed URLs to paste into
 * Meta Commerce Manager / TikTok Catalog / Google Merchant, and one button that
 * draws every product's 1080×1080 catalogue image (no price — the platform
 * prints the live price over it) and stores it in the shop.
 */
function FeedPanel({ products }) {
  const toast = useToast();
  const [st, setSt] = useState(null);
  const [prog, setProg] = useState(null);
  const load = () => api.get('/api/admin/analytics/ad-feed').then(setSt).catch(() => setSt(false));
  useEffect(() => { load(); }, []);
  const makeAll = async () => {
    await loadStaticFonts();
    let done = 0, failed = 0;
    setProg({ done, total: products.length });
    for (const p of products) {
      try {
        const ad = await api.get(`/api/admin/analytics/ad-statics/${p.id}?lang=nl`);
        const img = await loadImage(ad.product.image);
        const c = document.createElement('canvas'); c.width = 1080; c.height = 1080;
        drawCatalog(c.getContext('2d'), ad, { [ad.product.image]: img });
        await api.post(`/api/admin/analytics/ad-feed/${p.id}/image`, { image: c.toDataURL('image/jpeg', 0.9) });
      } catch { failed++; }
      done++; setProg({ done, total: products.length, failed });
    }
    toast.success(`${done - failed} catalogue images stored${failed ? `, ${failed} failed` : ''}`);
    load();
  };
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast.success('Copied')).catch(() => {});
  if (!st) return null;
  return (
    <section className="card p-4" data-testid="ad-feed">
      <h3 className="text-white text-sm mb-1" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Rss size={15} /> Catalogue feed — dynamic product ads</h3>
      <p className="text-slate-400 text-xs mb-3" style={{ maxWidth: 760 }}>
        Meta, TikTok and Google build ads from this list themselves (the product someone looked at, with today&rsquo;s price).
        {` ${st.inFeed} of ${st.total} products are in the feed`}{st.withoutImage ? ` — ${st.withoutImage} still need a catalogue image.` : '.'}
      </p>
      <button type="button" onClick={makeAll} disabled={!!prog && prog.done < prog.total} className="btn-primary text-sm" data-testid="feed-images">
        <ImageIcon size={15} /> {prog && prog.done < prog.total ? `Drawing ${prog.done}/${prog.total}…` : 'Draw catalogue images for all products'}
      </button>
      <div style={{ marginTop: 12 }}>
        {Object.entries(st.urls).map(([n, u]) => (
          <div key={n} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span className="text-slate-400 text-xs" style={{ width: 52, textTransform: 'capitalize' }}>{n}</span>
            <code className="text-slate-300" style={{ fontSize: 12, flex: 1, overflowX: 'auto', whiteSpace: 'nowrap', padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>{u}</code>
            <button type="button" onClick={() => copy(u)} className="btn-ghost text-xs" aria-label={`Copy ${n} feed URL`}><Copy size={13} /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function AdStatics() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [productId, setProductId] = useState('');
  const [lang, setLang] = useState('nl');
  const [ad, setAd] = useState(null);
  const [images, setImages] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/admin/analytics/ad-statics').then((r) => { setList(r.products); setProductId(r.products[0]?.id || ''); })
      .catch(() => setList([]));
    loadStaticFonts();
  }, []);

  useEffect(() => {
    if (!productId) return;
    let live = true;
    setAd(null);
    api.get(`/api/admin/analytics/ad-statics/${productId}?lang=${lang}`).then(async (a) => {
      await loadStaticFonts();
      const urls = [a.product.image, ...(a.ladder || []).map((x) => x.image)];
      const imgs = {};
      for (const u of urls) imgs[u] = await loadImage(u);
      if (live) { setImages(imgs); setAd(a); }
    }).catch((e) => toast.error(e.message));
    return () => { live = false; };
  }, [productId, lang]);

  const formats = useMemo(() => Object.entries(ad?.formats || {}), [ad]);

  /* Every template × format in every language, drawn off-screen, in one ZIP. */
  const zipAll = async () => {
    setBusy(true);
    try {
      const files = [];
      for (const L of Object.keys(LANGS)) {
        const a = L === lang ? ad : await api.get(`/api/admin/analytics/ad-statics/${productId}?lang=${L}`);
        const cards = carouselCards(a);
        for (let i = 0; i < cards.length; i++) {
          const c = document.createElement('canvas'); c.width = 1080; c.height = 1080;
          drawCarouselCard(c.getContext('2d'), a, cards[i], images, i, cards.length);
          const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
          files.push({ name: `${L}/${staticFileName(a, `carousel-${i + 1}`, 'square')}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
        }
        for (const tpl of a.templates) {
          for (const [fid, fmt] of Object.entries(a.formats)) {
            const c = document.createElement('canvas'); c.width = fmt.w; c.height = fmt.h;
            drawStatic(c.getContext('2d'), fmt, a, tpl, images);
            const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
            files.push({ name: `${L}/${staticFileName(a, tpl.id, fid)}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
          }
        }
      }
      const z = makeZip(files);
      const el = document.createElement('a');
      el.href = URL.createObjectURL(z);
      el.download = `forgemarket-static-ads-${staticFileName(ad, 'all', 'formats').replace(/^forgemarket-|-all-formats-[a-z]+\.png$/g, '')}.zip`;
      el.click();
      setTimeout(() => URL.revokeObjectURL(el.href), 4000);
      toast.success(`${files.length} images`);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  if (list === null) return <PageLoader />;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl text-white flex items-center gap-2"><ImageIcon size={22} className="text-violet-300" /> Static ads</h1>
        <p className="text-slate-400 text-sm mt-1 max-w-3xl">
          Still images for Meta and TikTok in 1:1, 4:5 and 9:16: the product&rsquo;s own card in its brand&rsquo;s colours, the price and one line.
          Every line comes from the catalogue and passes the claim gate; a design that would say something the shop cannot prove is left out.
        </p>
      </div>

      <FeedPanel products={list} />

      <div className="card p-4" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ flex: '2 1 260px' }}>
          <span className="text-slate-400 text-xs">Product</span>
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className="input mt-1">
            {list.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sold ? ` · ${p.sold} sold` : ''}</option>)}
          </select>
        </label>
        <label style={{ flex: '1 1 160px' }}>
          <span className="text-slate-400 text-xs">Language</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="input mt-1">
            {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button type="button" onClick={zipAll} disabled={!ad || busy} className="btn-primary text-sm" data-testid="static-zip">
          <Archive size={15} /> {busy ? 'Drawing…' : 'Download all (4 languages, ZIP)'}
        </button>
      </div>

      {!ad ? <PageLoader /> : (
        <>
          {ad.refused?.length > 0 && (
            <div className="card p-4" style={{ display: 'flex', gap: 8, fontSize: 12.5, color: '#fcd34d' }}>
              <Info size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>Left out by the claim gate: {ad.refused.map((r) => `${TEMPLATE[r.template] || r.template} (“${r.lines[0]?.text}”)`).join(', ')}</span>
            </div>
          )}
          {ad.templates.map((tpl) => (
            <section key={tpl.id} className="card p-4">
              <h3 className="text-white text-sm mb-3">{TEMPLATE[tpl.id] || tpl.id}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14, alignItems: 'end' }}>
                {formats.map(([fid, fmt]) => <Preview key={fid} ad={ad} tpl={tpl} fmtId={fid} fmt={fmt} images={images} />)}
              </div>
            </section>
          ))}
          {carouselCards(ad).length > 0 && (
            <section className="card p-4" data-testid="carousel">
              <h3 className="text-white text-sm mb-1">Carousel (Meta: 1:1 cards, one per amount)</h3>
              <p className="text-slate-500 text-xs mb-3">Upload the cards in this order; give each card its product&rsquo;s own link.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
                {carouselCards(ad).map((spec, i, all) => <CarouselCard key={i} ad={ad} spec={spec} i={i} n={all.length} images={images} />)}
              </div>
            </section>
          )}
          <p className="text-slate-500 text-xs max-w-3xl">
            Link for the ad (fill in the network, design and format so the attribution report can tell which image sold):<br />
            <code className="text-slate-300 break-all">{ad.link}</code>
          </p>
        </>
      )}
    </div>
  );
}
