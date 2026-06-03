import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { StatusBadge, STATUS_META } from '../components/ui.jsx';

export default function Track() {
  const [params] = useSearchParams();
  const [number, setNumber] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
