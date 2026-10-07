import { useEffect, useState } from 'react';
import { Upload, RefreshCw, Copy, Link2, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * The platforms' own numbers in, without typing them: upload the export from
 * Meta or TikTok Ads Manager, or — with read-only keys set — pull them.
 * The tracking parameters below are what makes a platform row meet its sales:
 * paste them in the ad's "URL parameters" once.
 */
const money = (c) => (c == null ? '—' : `€${(c / 100).toFixed(2)}`);

export default function AdSpendImport({ onDone }) {
  const toast = useToast();
  const [st, setSt] = useState(null);
  const [network, setNetwork] = useState('meta');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const load = () => api.get('/api/admin/analytics/ads/sync').then(setSt).catch(() => setSt(false));
  useEffect(() => { load(); }, []);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true); setResult(null);
    try {
      const csv = await file.text();
      const r = await api.post('/api/admin/analytics/ads/import', { network, csv });
      setResult(r); toast.success(`${r.written} rows imported`); load(); onDone?.();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  const sync = async () => {
    setBusy(true);
    try { const r = await api.post('/api/admin/analytics/ads/sync', {}); toast.success('Synced'); setResult({ sync: r }); load(); onDone?.(); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast.success('Copied')).catch(() => {});

  if (!st) return null;
  const anyKey = st.meta.configured || st.tiktok.configured;
  return (
    <section className="card p-5 mb-6" data-testid="ad-spend-import">
      <h2 className="font-bold text-slate-200 mb-1">Platform numbers: spend, impressions, clicks</h2>
      <p className="text-slate-400 text-sm mb-4" style={{ maxWidth: 760 }}>
        Export a daily report from Meta or TikTok Ads Manager (with campaign and ad name; for Meta also broken down by Platform) and upload it here.
        Re-importing a day replaces it — nothing is counted twice.
        {anyKey ? ' Keys are set, so this also runs by itself every six hours.' : ' With META_ADS_TOKEN / TIKTOK_ADS_TOKEN set in Vercel it runs by itself every six hours.'}
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={network} onChange={(e) => setNetwork(e.target.value)} className="input" style={{ width: 'auto' }} aria-label="Platform">
          <option value="meta">Meta (Facebook / Instagram)</option>
          <option value="tiktok">TikTok</option>
        </select>
        <label className="btn-primary text-sm" style={{ cursor: busy ? 'wait' : 'pointer' }}>
          <Upload size={15} /> {busy ? 'Importing…' : 'Upload CSV export'}
          <input type="file" accept=".csv,text/csv,.txt" style={{ display: 'none' }} disabled={busy}
            onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} data-testid="ad-csv" />
        </label>
        {anyKey && <button type="button" onClick={sync} disabled={busy} className="btn-ghost text-sm"><RefreshCw size={15} /> Pull now</button>}
        {st.last && <span className="text-slate-500 text-xs">Last pull {new Date(st.last.at).toLocaleString()}
          {['meta', 'tiktok'].map((k) => (st.last[k]?.error ? ` · ${k}: ${st.last[k].error}` : st.last[k]?.written != null ? ` · ${k}: ${st.last[k].written} rows` : '')).join('')}</span>}
      </div>
      {result && !result.sync && (
        <p className="text-slate-300 text-sm mt-3">{result.rows} lines read, {result.written} day/ad rows written
          {result.skippedCount ? `, ${result.skippedCount} skipped (${result.skipped.slice(0, 3).map((s) => s.why).join('; ')})` : ''}.</p>
      )}

      <div style={{ marginTop: 18 }}>
        <h3 className="text-slate-200 text-sm mb-2" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Link2 size={14} /> URL parameters — paste once per ad account</h3>
        {[['Meta', st.tracking.meta], ['TikTok', st.tracking.tiktok]].map(([n, t]) => (
          <div key={n} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span className="text-slate-400 text-xs" style={{ width: 52 }}>{n}</span>
            <code className="text-slate-300" style={{ fontSize: 12, flex: 1, overflowX: 'auto', whiteSpace: 'nowrap', padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>{t}</code>
            <button type="button" onClick={() => copy(t)} className="btn-ghost text-xs" aria-label={`Copy ${n} parameters`}><Copy size={13} /></button>
          </div>
        ))}
        <p className="text-slate-500 text-xs">The platform fills in the campaign and ad name itself; the import stores the same names, so spend and sales meet per ad.</p>
      </div>

      {st.unmatched?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 className="text-sm mb-2" style={{ color: '#fcd34d', display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={14} /> Spend without a single visit (last 30 days)</h3>
          <p className="text-slate-500 text-xs mb-2">These ads cost money but no visit carried their name — their link probably lacks the parameters above.</p>
          <table style={{ width: '100%', fontSize: 12.5 }}>
            <tbody>
              {st.unmatched.map((u, i) => (
                <tr key={i} className="text-slate-300" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '5px 4px' }}>{u.network}</td><td style={{ padding: '5px 4px' }}>{u.campaign || '—'}</td>
                  <td style={{ padding: '5px 4px' }}>{u.creative || '—'}</td><td style={{ padding: '5px 4px', textAlign: 'right' }}>{money(u.spendCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
