import { useEffect, useState } from 'react';
import { ImageOff, Clock, BadgeCheck, ImageDown, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * Products → Media.
 *
 * Every active product's picture, judged: missing (none, or only a drawn tile,
 * an icon, a generated or an unverified picture), low quality, outdated, or
 * official. Official means the publisher's artwork through a channel the shop
 * may use — a supplier's own product API, or an upload the owner marked as
 * official (press kit, distributor asset pack). Nothing is scraped or
 * generated here.
 */
const STATUS = {
  /* Colours inline: four status tints are not worth new utility classes in a
     stylesheet with a size budget. */
  missing: { label: 'Ontbreekt', icon: ImageOff, c: '#fda4af' },
  low_quality: { label: 'Lage kwaliteit', icon: ImageDown, c: '#fcd34d' },
  outdated: { label: 'Verouderd', icon: Clock, c: '#7dd3fc' },
  official: { label: 'Officieel', icon: BadgeCheck, c: '#6ee7b7' },
};
const SOURCE = { supplier: 'Leverancier (API)', official: 'Eigen upload, officieel', upload: 'Eigen upload', link: 'Link',
  generated: 'Gegenereerd', licensed: 'Merklogo (Wikimedia Commons, vrije licentie)', artwork: 'Shop-artwork', 'matched-art': 'Shop-artwork', unknown: 'Onbekend' };

export default function ProductMedia() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const load = () => api.get('/api/admin/products/media').then(setData).catch((e) => { toast.error(e.message); setData(false); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* A few products per request (each is a search at every supplier), until the
     queue is empty or the owner stops it by leaving the page. */
  const enrich = async () => {
    setBusy(true); setLog([]);
    try {
      for (let round = 0; round < 50; round++) {
        // eslint-disable-next-line no-await-in-loop
        const r = await api.post('/api/admin/products/media/enrich', {});
        if (r.done || !r.rows?.length) break;
        setLog((l) => [...l, ...r.rows]);
        if (!r.applied && r.rows.every((x) => x.status !== 'applied')) break;
      }
      toast.success('Klaar — de lijst is bijgewerkt.');
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); load(); }
  };
  const markOfficial = async (item, official) => {
    try { await api.post(`/api/admin/products/${item.id}/media/official`, { official }); load(); }
    catch (e) { toast.error(e.message); }
  };

  if (data === null) return <PageLoader />;
  if (data === false) return <p className="text-slate-400">Kon de productafbeeldingen niet laden.</p>;
  const items = data.items.filter((i) => !filter || i.status === filter);

  return (
    <div>
      <h1 className="text-2xl text-white mb-2">Productafbeeldingen</h1>
      <p className="text-slate-400 text-sm mb-5 max-w-3xl">
        Alleen officiële artwork telt: de productafbeelding die je leverancier via zijn eigen API meestuurt, of een upload
        die jij als officieel markeert (persmateriaal van de uitgever of je distributeur). Getekende tegels, iconen,
        gegenereerde plaatjes en stockfoto's tellen niet. Er wordt niets van andere sites geplukt.
        Verouderd = langer dan {data.maxAgeDays} dagen niet ververst; lage kwaliteit = score onder {data.minQuality}/100.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-5">
        {Object.entries(STATUS).map(([k, v]) => (
          <button key={k} type="button" onClick={() => setFilter(filter === k ? '' : k)} data-testid={`media-${k}`}
            className="rounded-xl border px-4 py-3 text-left"
            style={{ color: v.c, background: `${v.c}14`, borderColor: filter === k ? v.c : `${v.c}4d` }}>
            <div className="flex items-center gap-2 text-sm"><v.icon size={15} /> {v.label}</div>
            <div className="text-2xl text-white mt-1 tabular-nums">{data.counts[k] || 0}</div>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 mb-4">
        <button type="button" className="btn-primary text-sm" disabled={busy} onClick={enrich}>
          <RefreshCw size={14} /> {busy ? 'Bezig…' : 'Officiële afbeeldingen zoeken'}
        </button>
        <span className="text-xs text-slate-500">Zoekt bij je leveranciers voor alles wat niet "Officieel" is. Je eigen uploads blijven staan.</span>
      </div>
      {log.length > 0 && (
        <div className="card p-3 mb-4 text-xs text-slate-400 overflow-y-auto" style={{ maxHeight: 160 }}>
          {log.map((r, i) => <div key={i}>{r.name}: {r.status === 'applied' ? `✓ van ${r.from}` : r.detail || r.status}</div>)}
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="text-left text-slate-400 border-b border-white/5">
            <tr><th className="px-4 py-3">Product</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Bron</th>
              <th className="px-4 py-3">Bijgewerkt</th><th className="px-4 py-3">Kwaliteit</th><th className="px-4 py-3" /></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((i) => {
              const s = STATUS[i.status];
              return (
                <tr key={i.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {i.image ? <img src={i.image} alt="" className="rounded-lg object-contain bg-white/5" style={{ width: 40, height: 40 }} loading="lazy" />
                        : <div className="rounded-lg bg-white/5" style={{ width: 40, height: 40 }} />}
                      <div><div className="text-slate-200">{i.name}</div><div className="text-xs text-slate-500">{i.category}</div></div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs" style={{ color: s.c, background: `${s.c}14`, borderColor: `${s.c}4d` }}><s.icon size={12} /> {s.label}</span>
                    {i.reasons?.length > 0 && <div className="text-xs text-slate-500 mt-1">{i.reasons.join(' · ')}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {SOURCE[i.source] || i.source || '—'}{i.from ? ` · ${i.from}` : ''}
                    {i.sourceUrl && <div className="truncate text-slate-500" style={{ maxWidth: 220 }} title={i.sourceUrl}>{i.sourceUrl}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{i.updatedAt ? date(i.updatedAt) : '—'}</td>
                  <td className="px-4 py-3 text-slate-300 tabular-nums">{i.quality != null ? `${i.quality}/100` : '—'}
                    {i.width ? <div className="text-xs text-slate-500">{i.width}×{i.height}</div> : null}</td>
                  <td className="px-4 py-3 text-right">
                    {/^\/api\/images\//.test(i.image || '') && i.source !== 'supplier' && (
                      <button type="button" className="btn-ghost text-xs" onClick={() => markOfficial(i, !i.official)}>
                        {i.official ? 'Niet officieel' : 'Markeer als officieel'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
