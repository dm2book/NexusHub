import { useEffect, useState } from 'react';
import { RefreshCw, Check, X, Pencil, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, date } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * Products → Discovery.
 *
 * What the permitted sources (partner APIs with your credentials) sell that
 * the shop does not, each with the safety gate's verdict and every reason
 * behind it. AUTO_APPROVE products are added by the pipeline itself; anything
 * else waits here. A product without a supplier in stock, a known cost and a
 * price above the margin floor is only ever added HIDDEN.
 *
 * Second tab: the catalogue audit — per category, what is missing or wrong.
 */
const GATES = {
  AUTO_APPROVE: { t: 'Automatisch veilig', c: '#6ee7b7' },
  REVIEW_REQUIRED: { t: 'Review nodig', c: '#fcd34d' },
  UNSAFE_MATCH: { t: 'Onveilige match', c: '#fda4af' },
  UNAVAILABLE: { t: 'Niet beschikbaar', c: '#94a3b8' },
  DUPLICATE: { t: 'Bestaat al', c: '#7dd3fc' },
};
const pct = (v) => (v == null ? '' : `${Math.round(v * 100)}%`);
const chip = (c) => ({ color: c, background: `${c}14`, borderColor: `${c}4d` });

export default function ProductDiscovery() {
  const toast = useToast();
  const [tab, setTab] = useState('missing');
  const [data, setData] = useState(null);
  const [auditData, setAudit] = useState(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState(null);

  const load = () => api.get('/api/admin/discovery').then(setData).catch((e) => { toast.error(e.message); setData(false); });
  const loadAudit = () => api.get('/api/admin/discovery/audit').then(setAudit).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'audit' && !auditData) loadAudit(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (key, fn, ok) => {
    setBusy(key);
    try { const r = await fn(); if (ok) toast.success(typeof ok === 'function' ? ok(r) : ok); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(''); load(); }
  };
  const scan = (categories) => act('scan', () => api.post('/api/admin/discovery/scan', categories ? { categories } : {}),
    (r) => `${r.queries} zoektermen, ${r.evaluated} beoordeeld, ${r.added} toegevoegd.`);
  const saveEdit = () => act(`edit-${edit.id}`, () => api.patch(`/api/admin/discovery/${edit.id}`, {
    ...(edit.title ? { title: edit.title } : {}), ...(edit.category ? { category: edit.category } : {}),
    ...(edit.price ? { priceCents: Math.round(Number(String(edit.price).replace(',', '.')) * 100) } : {}),
  }).then((r) => { setEdit(null); return r; }), 'Opgeslagen en opnieuw beoordeeld.');

  if (data === null) return <PageLoader />;
  if (data === false) return <p className="text-slate-400">Kon Product Discovery niet laden.</p>;
  const open = data.items.filter((i) => !i.productId && i.status !== 'rejected');
  const items = open.filter((i) => !filter || i.gate === filter);
  const categories = [...new Set(open.map((i) => i.category).filter(Boolean))].sort();
  const available = data.sources.filter((s) => s.status === 'available');

  return (
    <div>
      <h1 className="text-2xl text-white mb-2">Product Discovery</h1>
      <p className="text-slate-400 text-sm mb-4 max-w-3xl">
        Producten die bij je bronnen te koop zijn en in ForgeMarket ontbreken. Alleen partner-API's met jouw sleutels — er
        wordt niets van websites geplukt. Automatisch toegevoegd wordt alleen wat ≥98% zeker overeenkomt, een afbeelding van
        ≥95% heeft, een leverancier op voorraad met bekende kostprijs en een winstgevende prijs. De rest wacht hier.
        Automatisch toevoegen staat <span className="text-white">{data.autoAdd ? 'aan' : 'uit'}</span>.
      </p>
      <div className="text-xs text-slate-400 mb-4">
        Bronnen: {available.length ? available.map((s) => s.label).join(', ') : <span style={{ color: '#fcd34d' }}>geen bron beschikbaar — voeg partner-API-sleutels toe (Kinguin, G2A, Eldorado, Eneba)</span>}
        {data.sources.filter((s) => s.status !== 'available' && !s.key.startsWith('official')).length > 0 && (
          <span> · niet beschikbaar: {data.sources.filter((s) => s.status !== 'available' && !s.key.startsWith('official')).map((s) => s.label).join(', ')}</span>
        )}
      </div>

      <div className="flex gap-2 mb-4">
        {[['missing', `Ontbrekende producten (${open.length})`], ['audit', 'Catalogus-audit']].map(([k, l]) => (
          <button key={k} type="button" className={tab === k ? 'btn-primary text-sm' : 'btn-ghost text-sm'} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'missing' && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 mb-4">
            {Object.entries(GATES).map(([k, v]) => (
              <button key={k} type="button" onClick={() => setFilter(filter === k ? '' : k)} className="rounded-xl border px-3 py-2 text-left"
                style={{ ...chip(v.c), borderColor: filter === k ? v.c : `${v.c}4d` }} data-testid={`gate-${k}`}>
                <div className="text-xs">{v.t}</div>
                <div className="text-xl text-white tabular-nums">{data.counts[k] || 0}</div>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button type="button" className="btn-primary text-sm" disabled={!!busy || !data.counts.AUTO_APPROVE}
              onClick={() => act('safe', () => api.post('/api/admin/discovery/add-safe', {}), (r) => `${r.added} veilige producten toegevoegd.`)}>
              <ShieldCheck size={14} /> Add all safe
            </button>
            <button type="button" className="btn-ghost text-sm" disabled={!!busy} onClick={() => scan(null)}>
              <RefreshCw size={14} /> {busy === 'scan' ? 'Bezig…' : 'Re-scan category'} (alle)
            </button>
            {categories.length > 0 && (
              <select className="input text-sm" style={{ width: 'auto' }} value="" disabled={!!busy}
                onChange={(e) => e.target.value && scan([e.target.value])} aria-label="Re-scan category">
                <option value="">Re-scan category…</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </div>

          {edit && (
            <div className="card p-4 mb-4 text-sm grid gap-2 sm:grid-cols-4 items-end">
              <label className="text-slate-400">Naam<input className="input mt-1" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
              <label className="text-slate-400">Categorie<input className="input mt-1" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></label>
              <label className="text-slate-400">Prijs (€)<input className="input mt-1" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} /></label>
              <div className="flex gap-2"><button type="button" className="btn-primary text-sm" onClick={saveEdit}>Opslaan</button>
                <button type="button" className="btn-ghost text-sm" onClick={() => setEdit(null)}>Annuleren</button></div>
            </div>
          )}

          <div className="card overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 1100 }}>
              <thead className="text-left text-slate-400 border-b border-white/5">
                <tr>
                  <th className="px-3 py-3">Product</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Bronnen</th>
                  <th className="px-3 py-3">Match</th><th className="px-3 py-3">Afbeelding</th><th className="px-3 py-3">Prijs</th>
                  <th className="px-3 py-3">Kostprijs</th><th className="px-3 py-3">Marge</th><th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {items.map((i) => {
                  const g = GATES[i.gate] || { t: i.gate ? i.gate : 'Nog niet beoordeeld', c: '#94a3b8' };
                  return (
                    <tr key={i.id} className="align-top">
                      <td className="px-3 py-3">
                        <div className="text-slate-200">{i.title}</div>
                        <div className="text-xs text-slate-500">{i.category || '—'} · {i.denomination != null ? `${i.denomination} ${i.unit}` : ''} · {i.platform} · {i.region}</div>
                      </td>
                      <td className="px-3 py-3" style={{ maxWidth: 260 }}>
                        <span className="inline-flex rounded-full border px-2 py-0.5 text-xs" style={chip(g.c)}>{g.t}</span>
                        {i.reasons?.length > 0 && <div className="text-xs text-slate-500 mt-1">{i.reasons.join(' · ')}</div>}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-400">{i.sources.join(', ')}
                        {i.supplier && <div className="text-slate-500">Leverancier: {i.supplier.name}{i.supplier.inStock ? '' : ' (uitverkocht)'}</div>}</td>
                      <td className="px-3 py-3 tabular-nums text-slate-300">{pct(i.matchConfidence)}</td>
                      <td className="px-3 py-3">
                        {i.image?.url ? <img src={i.image.url} alt="" className="rounded bg-white/5 object-contain" style={{ width: 44, height: 44 }} loading="lazy" title={`${i.image.sourceType} · ${i.image.width}×${i.image.height} · ${i.image.sourceUrl}`} /> : null}
                        <div className="text-xs text-slate-400 tabular-nums">{pct(i.imageConfidence)}</div>
                      </td>
                      <td className="px-3 py-3 tabular-nums text-slate-300">{i.suggestedPrice ? money(i.suggestedPrice) : ''}</td>
                      <td className="px-3 py-3 tabular-nums text-slate-300">{i.supplierCost != null ? money(i.supplierCost) : ''}</td>
                      <td className="px-3 py-3 tabular-nums text-slate-300">{i.margin != null ? `${i.margin}%` : ''}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {['AUTO_APPROVE', 'REVIEW_REQUIRED'].includes(i.gate) && (
                          <button type="button" className="btn-ghost text-xs" disabled={!!busy}
                            onClick={() => act(`add-${i.id}`, () => api.post(`/api/admin/discovery/${i.id}/add`, {}),
                              (r) => (r.sellable ? 'Toegevoegd en verkoopbaar.' : `Toegevoegd, verborgen: ${r.hiddenReason}.`))}>
                            <Check size={13} /> Approve & add
                          </button>
                        )}
                        <button type="button" className="btn-ghost text-xs" onClick={() => setEdit({ id: i.id, title: i.title, category: i.category || '', price: i.suggestedPrice ? (i.suggestedPrice / 100).toFixed(2) : '' })}>
                          <Pencil size={13} /> Edit
                        </button>
                        <button type="button" className="btn-ghost text-xs" disabled={!!busy} onClick={() => act(`rescan-${i.id}`, () => api.post(`/api/admin/discovery/${i.id}/rescan`, {}), 'Opnieuw bekeken.')}>
                          <RefreshCw size={13} /> Re-scan product
                        </button>
                        <button type="button" className="btn-ghost text-xs" disabled={!!busy} onClick={() => act(`rej-${i.id}`, () => api.post(`/api/admin/discovery/${i.id}/reject`, {}), 'Afgewezen.')}>
                          <X size={13} /> Reject
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!items.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">Niets in deze lijst.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'audit' && (!auditData ? <PageLoader /> : (
        <div>
          <div className="text-sm text-slate-400 mb-3">
            {auditData.totals.categories} categorieën · {auditData.totals.products} producten ({auditData.totals.active} actief) ·
            {' '}{auditData.totals.duplicates} dubbel · {auditData.totals.wrongCategory} mogelijk verkeerde categorie ·
            {' '}{auditData.totals.missingImage} zonder afbeelding · {auditData.totals.weakImage} zwakke afbeelding ·
            {' '}{auditData.totals.missingDescription} zonder beschrijving · {auditData.totals.missingSupplier} zonder leverancier ·
            {' '}{auditData.totals.missingDenominations == null ? 'ontbrekende denominaties: nog geen brondata' : `${auditData.totals.missingDenominations} ontbrekende denominaties`}
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 900 }}>
              <thead className="text-left text-slate-400 border-b border-white/5">
                <tr><th className="px-3 py-3">Categorie</th><th className="px-3 py-3">Producten</th><th className="px-3 py-3">Ontbrekende denominaties</th>
                  <th className="px-3 py-3">Dubbel</th><th className="px-3 py-3">Verkeerde cat.</th><th className="px-3 py-3">Geen afb.</th>
                  <th className="px-3 py-3">Zwakke afb.</th><th className="px-3 py-3">Geen beschr.</th><th className="px-3 py-3">Geen lev.</th></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {auditData.categories.map((c) => (
                  <tr key={c.category} className="align-top">
                    <td className="px-3 py-3 text-slate-200">{c.category}</td>
                    <td className="px-3 py-3 tabular-nums text-slate-300">{c.products} ({c.active})</td>
                    <td className="px-3 py-3 text-xs text-slate-400">{c.missingDenominations == null ? 'geen brondata' : c.missingDenominations.map((d) => d.title).join(', ') || '—'}</td>
                    {['duplicates', 'wrongCategory', 'missingImage', 'weakImage', 'missingDescription', 'missingSupplier'].map((k) => (
                      <td key={k} className="px-3 py-3 tabular-nums text-slate-300" title={c[k].map((x) => (Array.isArray(x) ? x.map((y) => y.name).join(' = ') : x.name)).join('\n')}>{c[k].length || ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-2">Beweeg over een getal voor de producten. Bijgewerkt {date(new Date().toISOString())}.</p>
        </div>
      ))}
    </div>
  );
}
