import { useEffect, useState } from 'react';
import { Shapes, RefreshCw, Plus, ExternalLink, Check, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageLoader } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * Catalog → Logo Library.
 *
 * The best available official logo per brand (services/logoDiscoveryService.js),
 * where it came from, under which licence, how good it is, and when it was last
 * looked for. Official files (brand assets page, press kit, developer portal)
 * are added here as links after accepting the brand's terms; Wikimedia Commons,
 * Simple Icons and the shop's own files are found by themselves. Cached 30 days.
 */
const TIER = { brand_assets: 'Official brand assets', press_kit: 'Official press kit', developer_portal: 'Developer portal',
  commons: 'Wikimedia Commons', public_svg: 'Simple Icons (public SVG)', shop_asset: 'ForgeMarket file' };
const day = (s) => (s ? new Date(s).toLocaleDateString() : '—');

function Score({ value }) {
  const c = value >= 70 ? '#34d399' : value >= 45 ? '#fbbf24' : '#f87171';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 54, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${value}%`, height: '100%', background: c }} />
      </span>
      <span className="text-slate-300" style={{ fontSize: 12 }}>{value}</span>
    </span>
  );
}

function Logo({ src, size = 56 }) {
  return (
    <span style={{ width: size, height: size, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'repeating-conic-gradient(#e8e8ee 0% 25%, #ffffff 0% 50%) 50% / 12px 12px', flexShrink: 0 }}>
      {src ? <img src={src} alt="" style={{ maxWidth: size - 10, maxHeight: size - 10 }} /> : <span className="text-slate-600" style={{ fontSize: 11 }}>none</span>}
    </span>
  );
}

function AddSource({ brand, types, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ tier: 'brand_assets', url: '', license: '', guidelines: '', logoType: 'svg logo' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.post('/api/admin/logos/sources', { brand, tier: f.tier, url: f.url, logoType: f.logoType,
        ...(f.license ? { license: f.license } : {}), ...(f.guidelines ? { guidelines: f.guidelines } : {}) });
      toast.success('Source added and checked'); onDone();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginTop: 10 }}>
      <select className="input" value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })} aria-label="Source type">
        <option value="brand_assets">Official brand assets</option><option value="press_kit">Official press kit</option><option value="developer_portal">Developer portal</option>
      </select>
      <input className="input" required type="url" placeholder="https://… direct link to the SVG/PNG" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} style={{ gridColumn: 'span 2' }} />
      <select className="input" value={f.logoType} onChange={(e) => setF({ ...f, logoType: e.target.value })} aria-label="Logo type">
        {types.map((t) => <option key={t}>{t}</option>)}
      </select>
      <input className="input" placeholder="Licence / terms (e.g. brand guidelines)" value={f.license} onChange={(e) => setF({ ...f, license: e.target.value })} />
      <input className="input" type="url" placeholder="Guidelines page (optional)" value={f.guidelines} onChange={(e) => setF({ ...f, guidelines: e.target.value })} />
      <button disabled={busy} className="btn-primary text-sm"><Plus size={14} /> {busy ? 'Checking…' : 'Add official source'}</button>
    </form>
  );
}

function BrandRow({ b, types, reload }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const c = b.chosen;
  const refresh = async () => {
    setBusy(true);
    try { await api.post('/api/admin/logos/refresh', { brand: b.key }); reload(); } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  const choose = async (id) => { try { await api.post(`/api/admin/logos/${id}/choose`, {}); reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="card p-4" data-testid={`logo-${b.key}`}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <Logo src={c?.src} />
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div className="text-white font-semibold">{b.label}</div>
          <div className="text-slate-400" style={{ fontSize: 12 }}>
            {c ? <>{TIER[c.tier]} · {c.logo_type || 'logo'} · {c.mime?.replace('image/', '').replace('+xml', '')}{c.mime === 'image/svg+xml' ? ' · vector' : c.width ? ` · ${c.width}×${c.height}` : ''}{c.transparent ? ' · transparent' : ''}</> : 'No usable logo — the card uses the category logo or ForgeMarket artwork'}
          </div>
          {c && <div className="text-slate-500" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Licence: {c.license || 'not recorded'}{c.guidelines ? <> · <a href={c.guidelines} target="_blank" rel="noreferrer" className="text-violet-300">guidelines</a></> : null}
            {' · '}<a href={c.source_url.startsWith('http') ? c.source_url : undefined} target="_blank" rel="noreferrer" className="text-violet-300">source <ExternalLink size={10} style={{ display: 'inline' }} /></a>
          </div>}
        </div>
        {c && <Score value={c.score} />}
        <span className="text-slate-500" style={{ fontSize: 12, minWidth: 80 }}>{day(b.updatedAt)}</span>
        <button type="button" onClick={refresh} disabled={busy} className="btn-ghost text-xs"><RefreshCw size={13} /> {busy ? '…' : 'Refresh'}</button>
        <button type="button" onClick={() => setOpen(!open)} className="btn-ghost text-xs">{open ? 'Close' : `${b.candidates.length} found`}</button>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          {b.candidates.map((x) => (
            <div key={x.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 12.5 }}>
              <Logo src={x.src} size={40} />
              <span className="text-slate-300" style={{ width: 170 }}>{TIER[x.tier]}</span>
              <span className="text-slate-400" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.source_url}</span>
              {x.status === 'ok' ? <Score value={x.score} /> : <span style={{ color: '#fca5a5' }}>{x.reject_reason}</span>}
              {x.status === 'ok' && (x.chosen ? <span className="text-emerald-300" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Check size={13} /> chosen</span>
                : <button type="button" onClick={() => choose(x.id)} className="btn-ghost text-xs">Use this</button>)}
            </div>
          ))}
          <AddSource brand={b.key} types={types} onDone={reload} />
        </div>
      )}
    </div>
  );
}

export default function LogoLibrary() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/api/admin/logos').then(setD).catch(() => setD(false));
  useEffect(() => { load(); }, []);
  const refreshAll = async () => {
    setBusy(true);
    try {
      /* Each request stays inside the platform's time limit and says what it
         did not reach; the page simply asks again for the rest. */
      let r = await api.post('/api/admin/logos/refresh', {});
      let done = r.done.length;
      for (let round = 0; round < 8 && r.remaining.length; round++) {
        r = await api.post('/api/admin/logos/refresh', { brands: r.remaining });
        done += r.done.length;
      }
      toast.success(`${done} brands looked at${r.remaining.length ? `, ${r.remaining.length} next time` : ''}`);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); load(); }
  };
  if (d === null) return <PageLoader />;
  if (!d) return <div className="card p-8 text-slate-400">Could not load the Logo Library.</div>;
  const r = d.report;
  return (
    <div className="space-y-4">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <h1 className="text-2xl text-white flex items-center gap-2"><Shapes size={22} className="text-violet-300" /> Logo Library</h1>
          <p className="text-slate-400 text-sm mt-1" style={{ maxWidth: 780 }}>
            The best official logo per brand. Order: official brand assets › press kit › developer portal › Wikimedia Commons (public domain / CC0) › Simple Icons › ForgeMarket files.
            SVG first; rasters need 512×512 and a transparent background; no JPEG, screenshots or mockups. Looked up again after {d.cacheDays} days, never on a page view.
          </p>
        </div>
        <button type="button" onClick={refreshAll} disabled={busy} className="btn-primary text-sm" data-testid="logos-refresh-all"><RefreshCw size={15} /> {busy ? 'Looking…' : 'Refresh all brands'}</button>
      </div>

      <section className="card p-4" data-testid="logo-report">
        <h3 className="text-white text-sm mb-2">Report</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, fontSize: 13 }}>
          <div><div className="text-emerald-300 font-semibold">Found ({r.found.length})</div><div className="text-slate-400">{r.found.map((x) => x.brand).join(', ') || '—'}</div></div>
          <div><div style={{ color: '#fca5a5' }} className="font-semibold">Missing ({r.missing.length})</div><div className="text-slate-400">{r.missing.join(', ') || '—'}</div></div>
          <div><div style={{ color: '#fcd34d' }} className="font-semibold">Low quality ({r.lowQuality.length})</div><div className="text-slate-400">{r.lowQuality.map((x) => `${x.brand} (${x.score})`).join(', ') || '—'}</div></div>
        </div>
        {r.recommendedUploads.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="text-slate-200 font-semibold" style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={14} /> Recommended manual uploads</div>
            <table style={{ width: '100%', fontSize: 12.5, marginTop: 6 }}><tbody>
              {r.recommendedUploads.map((u) => (
                <tr key={u.key} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <td className="text-slate-200" style={{ padding: '5px 4px', width: 160 }}>{u.brand}</td>
                  <td className="text-slate-400" style={{ padding: '5px 4px' }}>{u.why}</td>
                  <td style={{ padding: '5px 4px', textAlign: 'right', color: u.priority === 'high' ? '#fca5a5' : u.priority === 'medium' ? '#fcd34d' : '#94a3b8' }}>{u.priority}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </section>

      {d.brands.map((b) => <BrandRow key={b.key} b={b} types={d.logoTypes} reload={load} />)}
    </div>
  );
}
