/**
 * Every key the shop runs on, in one place, typed in rather than deployed.
 *
 * ── WHY EACH ROW LEADS WITH THE CONSEQUENCE ───────────────────────────────
 * "STRIPE_WEBHOOK_SECRET" is a setting name. "Without it buyers can pay, the
 * money arrives, and no order is ever marked paid" is the reason anybody would
 * go and find it. The second is what this screen shows, because the owner is
 * not reading documentation while they do this — they are trying to open a
 * shop.
 *
 * ── AND WHY A VALUE NEVER COMES BACK ──────────────────────────────────────
 * The server sends status only: set or not, from here or from the build, and
 * the last four characters. A screen that can display a live Stripe key is a
 * screen that can leak one — a shared screen, a screenshot, a support call. The
 * last four are enough to tell two keys apart, which is the only reason to look
 * at one you already saved.
 */
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Check, AlertTriangle, Eye } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';

export default function KeysCard() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    api.get('/api/admin/settings/keys').then(setData).catch(() => setData(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data) return null;

  const save = async (id) => {
    setBusy(id);
    try {
      const out = await api.put(`/api/admin/settings/keys/${id}`, { value: draft[id] ?? '' });
      setData(out);
      setDraft((d) => ({ ...d, [id]: '' }));
      toast.success(draft[id]?.trim() ? 'Saved — it is in use now.' : 'Cleared.');
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  const groups = [...new Set(data.keys.map((k) => k.group))];
  const missing = data.missing || [];
  const unreadable = data.keys.filter((k) => k.unreadable);
  const tone = missing.length ? 'red' : 'emerald';
  const frame = {
    emerald: 'border-emerald-500/30 bg-emerald-500/10',
    red: 'border-red-500/40 bg-red-500/10',
  }[tone];

  return (
    <div className={`rounded-2xl border ${frame} mb-8`}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 p-5 text-left">
        <span className={`w-11 h-11 rounded-xl grid place-items-center shrink-0 ${
          tone === 'emerald' ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
          {missing.length
            ? <AlertTriangle size={20} className="text-red-400" />
            : <Check size={20} className="text-emerald-400" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-white font-semibold flex items-center gap-2">
            <KeyRound size={15} className="text-slate-400" /> Keys and connections
          </div>
          <div className="text-slate-400 text-sm">
            {missing.length
              ? `Still needed: ${missing.map((m) => m.what).join(', ')}.`
              : `${data.keys.filter((k) => k.set).length} of ${data.keys.length} set. Nothing here needs a deploy.`}
          </div>
        </div>
        <span className="text-slate-400 text-xs">{open ? 'Close' : 'Open'}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-6">
          {/* A key encrypted under a JWT_SECRET that has since changed cannot be
              read back. Saying "not set" would send the owner looking for a
              setting that is there. */}
          {unreadable.length > 0 && (
            <p className="text-[12.5px] text-amber-300">
              {unreadable.length} stored value(s) cannot be decrypted — JWT_SECRET has changed
              since they were saved. Type them again; they are not lost, they are unusable.
            </p>
          )}

          {groups.map((g) => (
            <div key={g}>
              <h4 className="text-[12.5px] font-semibold text-slate-300 mb-2">{g}</h4>
              <div className="space-y-3">
                {data.keys.filter((k) => k.group === g).map((k) => (
                  <div key={k.id} className="rounded-xl bg-space-black/50 px-4 py-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-white text-sm">{k.label}</span>
                      {k.set ? (
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                          k.source === 'admin'
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                            : 'bg-white/5 text-slate-300 border-white/10'}`}>
                          {k.source === 'admin' ? 'set here' : 'from the build'}
                        </span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-slate-500 border border-white/10">
                          not set
                        </span>
                      )}
                      {/* Enough to tell two keys apart, never enough to use one. */}
                      {k.set && k.masked && (
                        <span className="text-[11px] text-slate-500 font-mono inline-flex items-center gap-1">
                          <Eye size={11} /> {k.masked}
                        </span>
                      )}
                    </div>
                    <div className="text-slate-400 text-[12px] mt-1">{k.why}</div>
                    {k.hint && <div className="text-slate-500 text-[11px] mt-0.5">{k.hint}</div>}
                    <div className="flex flex-wrap gap-2 mt-2">
                      <input className="input !py-1.5 flex-1 min-w-[220px]" type="password"
                        autoComplete="off" placeholder={k.set ? 'Replace it…' : 'Paste it here…'}
                        value={draft[k.id] || ''}
                        onChange={(e) => setDraft({ ...draft, [k.id]: e.target.value })} />
                      <button onClick={() => save(k.id)} disabled={busy === k.id || !(draft[k.id] || '').trim()}
                        className="btn-primary !py-1.5 !px-3 text-xs disabled:opacity-40">
                        {busy === k.id ? '…' : 'Save'}
                      </button>
                      {k.source === 'admin' && (
                        <button onClick={() => { setDraft({ ...draft, [k.id]: '' }); save(k.id); }}
                          disabled={busy === k.id}
                          className="text-xs text-slate-400 hover:text-red-300 px-2">
                          Clear
                        </button>
                      )}
                    </div>
                    {/* The environment still works, and clearing here falls back
                        to it rather than to nothing. */}
                    <div className="text-slate-600 text-[11px] mt-1.5">
                      Or set {k.env} in your hosting environment — this overrides it while it is set.
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
