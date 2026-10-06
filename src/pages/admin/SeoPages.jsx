import { useEffect, useState } from 'react';
import { FileText, Info, ExternalLink, Search } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageLoader } from '../../components/ui.jsx';

/**
 * Growth → SEO pages.
 *
 * Every page generated from the catalogue (game, gift card, platform, gift
 * budget) with its title, meta description, FAQ count, internal links and
 * target keywords, ranked by four real signals — marketplace listings
 * observed, own sales (90 days), own visits (30 days) and catalogue depth.
 * There is no search-volume column because there is no search-volume data;
 * connect Search Console to add real impressions.
 */
const TYPE = { game: 'Game', giftcard: 'Gift card', platform: 'Platform', budget: 'Gift budget' };
const lenTone = (n, max) => (n > max ? 'text-red-300' : n < max * 0.5 ? 'text-amber-300' : 'text-emerald-300');

export default function SeoPages() {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => { api.get('/api/admin/seo/pages').then(setD).catch(() => setD(false)); }, []);
  if (d === null) return <PageLoader />;
  if (!d) return <div className="card p-8 text-slate-400">Could not build the SEO report.</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl text-white flex items-center gap-2"><FileText size={22} className="text-violet-300" /> SEO pages</h1>
        <p className="text-slate-400 text-sm mt-1 max-w-3xl">
          {d.pages.length} pages generated from the live catalogue — each with title, meta description, FAQ (with FAQPage schema),
          ItemList / Breadcrumb schema and internal links. A page exists only where the catalogue has depth (2+ products, 4+ for a gift budget).
        </p>
        <p className="text-[12px] text-amber-300/90 mt-2 flex gap-1.5 max-w-3xl"><Info size={14} className="shrink-0 mt-0.5" /> {d.note}
          {' '}Weights: market {d.weights.market}, sales {d.weights.sales}, visits {d.weights.visits}, depth {d.weights.depth}.</p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-slate-400 text-left">
            <tr className="border-b border-white/5">
              <th className="p-3">Priority</th><th className="p-3">Page</th><th className="p-3">Title / description</th>
              <th className="p-3 text-right">Listings</th><th className="p-3 text-right">Sales 90d</th><th className="p-3 text-right">Visits 30d</th>
              <th className="p-3 text-right">Products</th><th className="p-3 text-right">FAQ · links</th>
            </tr>
          </thead>
          <tbody>
            {d.pages.map((p) => (
              <tr key={p.path} className="border-b border-white/5 align-top hover:bg-white/5 cursor-pointer" onClick={() => setOpen(open === p.path ? null : p.path)} data-testid="seo-row">
                <td className="p-3 text-white font-bold tabular-nums">{p.priority}</td>
                <td className="p-3">
                  <a href={p.path} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-violet-300 hover:underline inline-flex items-center gap-1">{p.path} <ExternalLink size={11} /></a>
                  <div className="text-slate-500 text-[11.5px]">{TYPE[p.type]}{p.handWritten ? ' · hand-written copy, generated FAQ + links' : ''}</div>
                </td>
                <td className="p-3 max-w-md">
                  <div className="text-slate-100">{p.title} <span className={`text-[11px] ${lenTone(p.titleLength, 60)}`}>{p.titleLength}/60</span></div>
                  <div className="text-slate-400 text-[12px] mt-0.5">{p.description} <span className={`text-[11px] ${lenTone(p.descriptionLength, 155)}`}>{p.descriptionLength}/155</span></div>
                  {open === p.path && (
                    <div className="mt-2 text-[12px] text-slate-400"><Search size={11} className="inline mr-1" />Targets: {p.keywords.join(' · ')}</div>
                  )}
                </td>
                <td className="p-3 text-right tabular-nums text-slate-300">{p.signals.market}</td>
                <td className="p-3 text-right tabular-nums text-slate-300">{p.signals.sales}</td>
                <td className="p-3 text-right tabular-nums text-slate-300">{p.signals.visits}{p.signals.searchVisits ? <span className="text-slate-500"> ({p.signals.searchVisits} search)</span> : ''}</td>
                <td className="p-3 text-right tabular-nums text-slate-300">{p.products}</td>
                <td className="p-3 text-right tabular-nums text-slate-300">{p.faq} · {p.links}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-5" data-testid="seo-missing">
        <h3 className="text-white mb-1">Keywords no page answers yet ({d.missingKeywords.length})</h3>
        <p className="text-[12px] text-slate-500 mb-3">
          Implied by products in the catalogue (a game&rsquo;s currency, a gift card&rsquo;s amount, a platform), but carried by no page&rsquo;s title, heading,
          description or intro. Usually the fix is a second product for that brand or game — one product does not get a page of its own.
        </p>
        {d.missingKeywords.length === 0 ? <p className="text-slate-500 text-sm">Every keyword the catalogue implies is covered.</p> : (
          <div className="flex flex-wrap gap-1.5">
            {d.missingKeywords.map((k) => <span key={k.keyword} className="rounded-md bg-white/5 border border-white/10 px-2 py-1 text-[12px] text-slate-300">{k.keyword}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}
