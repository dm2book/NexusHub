import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Loader2, ExternalLink, Copy } from 'lucide-react';
import { api } from '../lib/api.js';
import { StatusBadge, STATUS_META } from '../components/ui.jsx';
import { useToast } from '../context/ToastContext.jsx';

const METHOD_ICON = { tikkie: '🟢', revolut: '⚫', paypal: '🔵' };
function payHref(m, eur) {
  let t = m.target || '';
  if (m.kind === 'email') return null;
  if (!/^https?:\/\//.test(t)) t = `https://${t}`;
  if (m.id === 'paypal' && /paypal\.me/i.test(t)) t = `${t.replace(/\/$/, '')}/${eur}EUR`;
  return t;
}

export default function Track() {
  const [params] = useSearchParams();
  const toast = useToast();
  const [number, setNumber] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState({ paymentMethods: [], paymentNote: '' });

  useEffect(() => { api.get('/api/config').then(setCfg).catch(() => {}); }, []);

  const lookup = async (num) => {
    setBusy(true); setError(''); setResult(null);
    try {
      setResult(await api.get(`/api/track/${encodeURIComponent(num.trim())}`));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  // Auto-track when arriving with ?number= (e.g. after guest checkout).
  useEffect(() => {
    const n = params.get('number');
    if (n) { setNumber(n.toUpperCase()); lookup(n); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const track = (e) => { e.preventDefault(); lookup(number); };

  return (
    <div className="max-w-2xl mx-auto px-5 py-16">
      <h1 className="text-3xl text-white mb-2">Track your order</h1>
      <p className="text-slate-400 mb-8">Enter your order number (e.g. FM-2026-XXXXXXXX).</p>

      <form onSubmit={track} className="flex gap-3 mb-8">
        <input value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())}
          placeholder="FM-2026-XXXXXXXX" className="input" />
        <button disabled={busy || !number} className="btn-primary px-6">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
        </button>
      </form>

      {error && <div className="card p-4 text-red-300 border border-red-500/30">{error}</div>}

      {result && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-slate-400 text-sm">Order</div>
              <div className="text-white text-lg font-mono">{result.number}</div>
            </div>
            <StatusBadge status={result.status} />
          </div>

          {result.status === 'pending' && (cfg.paymentMethods || []).length > 0 && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 mb-6">
              <div className="flex items-center justify-between">
                <div className="text-amber-200 font-semibold">⏳ Awaiting payment</div>
                <div className="text-white font-semibold">{result.totalFormatted}</div>
              </div>
              <p className="text-slate-300 text-sm mt-1">
                Pay with your order number{' '}
                <button onClick={() => { navigator.clipboard?.writeText(result.number); toast.success('Reference copied'); }}
                  className="font-mono text-white inline-flex items-center gap-1"><Copy size={12} /> {result.number}</button>{' '}
                as the reference. We confirm it manually (usually within minutes).
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                {cfg.paymentMethods.map((m) => {
                  const href = payHref(m, (result.total / 100).toFixed(2));
                  return href
                    ? <a key={m.id} href={href} target="_blank" rel="noreferrer" className="btn-primary text-sm"><ExternalLink size={15} /> {METHOD_ICON[m.id] || '💳'} {m.label}</a>
                    : <span key={m.id} className="btn-ghost text-sm cursor-default">{METHOD_ICON[m.id] || '💳'} {m.label}: {m.target}</span>;
                })}
              </div>
              {cfg.paymentNote && <p className="text-slate-500 text-xs mt-3">{cfg.paymentNote}</p>}
            </div>
          )}

          <Timeline history={result.history} />
        </div>
      )}
    </div>
  );
}

function Timeline({ history }) {
  return (
    <ol className="relative border-l border-white/10 ml-2 space-y-5">
      {history.map((h, i) => (
        <li key={i} className="ml-5">
          <span className="absolute -left-[7px] w-3.5 h-3.5 rounded-full bg-primary" />
          <div className="text-white text-sm">{STATUS_META[h.to]?.label || h.to}</div>
          <div className="text-slate-500 text-xs">{new Date(h.at).toLocaleString()}</div>
        </li>
      ))}
    </ol>
  );
}
