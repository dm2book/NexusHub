/**
 * Who is selling — the form, in the admin, beside the readiness panel that
 * fails without it.
 *
 * ── WHY IT IS HERE AND NOT IN A CONFIG FILE ───────────────────────────────
 * These four fields are the legal minimum a Dutch webshop must publish before a
 * consumer may buy. They used to be environment variables baked into the
 * browser bundle at build time, so filling them in meant a Vercel setting plus
 * a redeploy by somebody who knew a redeploy was needed. The failure mode has a
 * date on it: register at the KvK, type the number into Vercel, see it saved,
 * and the site keeps telling buyers there is no registered company — because
 * nothing rebuilt.
 *
 * Typed here, they are live on the next page load.
 *
 * ── WHAT `source` IS FOR ──────────────────────────────────────────────────
 * A field can come from here or from the build. An owner about to change a KvK
 * number needs to know which, because an environment variable they have
 * forgotten about is not overwritten by this form — it is overridden, and only
 * while a value is stored here.
 */
import { useCallback, useEffect, useState } from 'react';
import { Building2, Check, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';

/* Order and copy are the order a buyer reads them in, not the order they are
   stored in. `hint` says what the field is for in the one case where the name
   alone is not enough. */
const ROWS = [
  { key: 'tradeName', label: 'Trading name', placeholder: 'ForgeMarket' },
  { key: 'legalName', label: 'Legal name', required: true,
    hint: 'Your own name, or the company name as registered.' },
  { key: 'address', label: 'Street and number', required: true,
    hint: 'A geographic address. A PO box is not enough under Dutch law.' },
  { key: 'postcode', label: 'Postcode', required: true },
  { key: 'city', label: 'City', required: true },
  { key: 'country', label: 'Country', placeholder: 'Nederland' },
  { key: 'kvk', label: 'KvK number', hint: 'After registering. Leave empty until then.' },
  { key: 'vat', label: 'BTW-identificatienummer', hint: 'Only once you actually have one.' },
];

export default function SellerIdentityCard() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    api.get('/api/admin/legal-identity')
      .then((d) => { setData(d); setForm(d.values || {}); })
      .catch(() => setData(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data) return null;

  const dirty = ROWS.some((r) => (form[r.key] || '') !== (data.values?.[r.key] || ''));

  const save = async () => {
    setBusy(true);
    try {
      const d = await api.put('/api/admin/legal-identity',
        Object.fromEntries(ROWS.map((r) => [r.key, form[r.key] || ''])));
      setData(d); setForm(d.values || {});
      toast.success(d.complete
        ? 'Seller identity published — the legal pages show it now.'
        : `Saved. Still missing: ${(d.missingLabels || d.missing).join(', ')}.`);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const tone = data.complete
    ? (data.registered ? 'emerald' : 'amber')
    : 'red';
  const frame = {
    emerald: 'border-emerald-500/30 bg-emerald-500/10',
    amber: 'border-amber-500/30 bg-amber-500/10',
    red: 'border-red-500/40 bg-red-500/10',
  }[tone];

  return (
    <div className={`rounded-2xl border ${frame} mb-8`}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 p-5 text-left">
        <span className={`w-11 h-11 rounded-xl grid place-items-center shrink-0 ${
          tone === 'emerald' ? 'bg-emerald-500/20' : tone === 'amber' ? 'bg-amber-500/20' : 'bg-red-500/20'}`}>
          {data.complete ? <Check size={20} className={tone === 'emerald' ? 'text-emerald-400' : 'text-amber-400'} />
            : <AlertTriangle size={20} className="text-red-400" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-white font-semibold flex items-center gap-2">
            <Building2 size={15} className="text-slate-400" /> Seller identity
          </div>
          <div className="text-slate-400 text-sm">
            {data.complete
              ? `${data.values.legalName} — ${data.values.postcode} ${data.values.city}`
                + (data.registered ? ` · KvK ${data.values.kvk}` : ' · no KvK number yet')
              : `The legal pages cannot say who is selling. Missing: ${(data.missingLabels || data.missing).join(', ')}.`}
          </div>
        </div>
        <span className="text-slate-400 text-xs">{open ? 'Close' : 'Edit'}</span>
      </button>

      {open && (
        <div className="px-5 pb-5">
          <p className="text-slate-400 text-xs mb-4">
            Dutch law (Art. 6:230m BW) requires a name and a geographic address before a
            consumer buys. Saved here, it is live on the next page load — no deploy.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            {ROWS.map((r) => (
              <div key={r.key} className={r.key === 'address' || r.key === 'legalName' ? 'sm:col-span-2' : ''}>
                <label className="label flex items-center gap-2">
                  {r.label}
                  {r.required && <span className="text-red-300 text-[11px]">required</span>}
                  {/* Where this value is coming from right now. An owner editing a
                      field that an environment variable also sets should know it. */}
                  {data.source?.[r.key] === 'environment' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400">
                      from the build
                    </span>
                  )}
                </label>
                <input className="input" value={form[r.key] || ''} placeholder={r.placeholder || ''}
                  onChange={(e) => setForm({ ...form, [r.key]: e.target.value })} />
                {r.hint && <div className="text-slate-500 text-[11px] mt-1">{r.hint}</div>}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={save} disabled={busy || !dirty} className="btn-primary disabled:opacity-40">
              {busy ? 'Saving…' : 'Save and publish'}
            </button>
            {dirty && <span className="text-slate-400 text-xs">Not saved yet.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
