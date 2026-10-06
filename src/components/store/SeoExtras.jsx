import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useI18n } from '../../lib/i18n.jsx';
import { GAMES, BRANDS, PLATFORMS } from '../../lib/seoCatalog.js';

/**
 * The FAQ and related links of a catalogue page, from the generator
 * (src/lib/seoCatalog.js, served by /api/seo/page). Used under the
 * hand-written landing pages and on the generated ones. The FAQPage schema
 * for a generated page is written by the server; for a hand-written landing
 * page it is added here, once, matching the questions on screen.
 */
export function linkLabel(l, t) {
  if (l.type === 'giftcard') return t('seo.giftcards', '{x} gift cards', { x: BRANDS.find((b) => b.id === l.key)?.name || l.key });
  if (l.type === 'platform') return t('seo.platform', 'For {x}', { x: PLATFORMS.find((p) => p.id === l.key)?.name || l.key });
  if (l.type === 'budget') return t('seo.budget', 'Gifts under €{x}', { x: String(l.key).replace('under-', '') });
  const g = GAMES[l.key];
  return g ? t('seo.game', '{unit} for {name}', { unit: g.unit, name: g.name }) : l.path;
}

export function useSeoPage(path) {
  const { lang } = useI18n();
  const boot = typeof window !== 'undefined' ? window.__FM_BOOT__?.seoPage : null;
  const [page, setPage] = useState(boot && boot.path === path && lang === 'nl' ? boot : null);
  useEffect(() => {
    let live = true;
    api.get(`/api/seo/page?path=${encodeURIComponent(path)}&lang=${lang}`)
      .then((r) => { if (live) setPage(r.page || null); }).catch(() => { if (live) setPage(false); });
    return () => { live = false; };
  }, [path, lang]);
  return page;
}

export function SeoFaq({ page, withSchema = false }) {
  const { t } = useI18n();
  useEffect(() => {
    if (!withSchema || !page?.faq?.length) return undefined;
    const el = document.createElement('script');
    el.type = 'application/ld+json'; el.id = 'jsonld-faq';
    el.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: page.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
    document.getElementById('jsonld-faq')?.remove();
    document.head.appendChild(el);
    return () => el.remove();
  }, [page, withSchema]);
  if (!page?.faq?.length) return null;
  return (
    <section className="mt-12" data-testid="seo-faq">
      <h2 className="text-2xl font-extrabold text-slate-900 mb-4">{t('product.faqTitle', 'Frequently asked')}</h2>
      <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm divide-y divide-slate-100 overflow-hidden">
        {page.faq.map((f) => (
          <details key={f.q} className="group">
            <summary className="flex items-center justify-between gap-3 cursor-pointer list-none px-4 py-3.5 hover:bg-slate-50 transition" style={{ minHeight: 56 }}>
              <span className="font-semibold text-slate-900 text-[14.5px]">{f.q}</span>
              <ChevronDown size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <p className="px-4 pb-4 -mt-1 text-sm text-slate-600 leading-relaxed">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function SeoLinks({ page }) {
  const { t } = useI18n();
  if (!page?.links?.length) return null;
  return (
    <section className="mt-10" data-testid="seo-links">
      <h2 className="text-lg font-bold text-slate-900 mb-3">{t('seo.related', 'Related')}</h2>
      <div className="flex flex-wrap gap-2">
        {page.links.map((l) => (
          <Link key={l.path} to={l.path} className="rounded-full border border-slate-200 bg-white px-3.5 h-9 inline-flex items-center text-sm font-semibold text-slate-700 hover:border-violet-300 hover:text-violet-700 transition">
            {linkLabel(l, t)}
          </Link>
        ))}
      </div>
    </section>
  );
}
