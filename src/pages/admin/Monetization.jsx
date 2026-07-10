import { useEffect, useState, useCallback } from 'react';
import {
  Tag, Gift, Package, Plus, Trash2, Eye, EyeOff, Power, Copy, Percent, Euro,
  BarChart3, TrendingDown, Wallet, CalendarDays,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, date } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const TABS = [
  { id: 'coupons', label: 'Coupons', icon: Tag },
  { id: 'giftcards', label: 'Gift cards', icon: Gift },
  { id: 'bundles', label: 'Bundles', icon: Package },
  { id: 'drops', label: 'Drops', icon: CalendarDays },
  { id: 'report', label: 'Report', icon: BarChart3 },
];

export default function Monetization() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [products, setProducts] = useState([]);
  const [tab, setTab] = useState('coupons');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/api/admin/monetization').then(setData).catch((e) => toast.error(e.message));
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/api/admin/products').then((r) => setProducts(r.products || [])).catch(() => {}); }, []);

  const call = async (fn) => { setBusy(true); try { await fn(); load(); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };

  if (!data) return <PageLoader />;

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl text-white mb-1">Monetization</h1>
      <p className="text-slate-400 text-sm mb-6">Coupons, gift cards and bundle offers — all live and database-backed.</p>

      <div className="flex gap-2 mb-6">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm border transition ${
              tab === t.id ? 'bg-primary/20 border-primary/40 text-white' : 'border-white/10 text-slate-400 hover:text-white'}`}>
            <t.icon size={15} /> {t.label}
            {t.id !== 'report' && t.id !== 'drops' && <span className="text-xs text-slate-500">{data[t.id === 'giftcards' ? 'giftCards' : t.id]?.length || 0}</span>}
          </button>
        ))}
      </div>

      {tab === 'coupons' && <Coupons coupons={data.coupons} toast={toast} call={call} busy={busy} />}
      {tab === 'giftcards' && <GiftCards cards={data.giftCards} toast={toast} call={call} busy={busy} />}
      {tab === 'bundles' && <Bundles bundles={data.bundles} products={products} toast={toast} call={call} busy={busy} />}
      {tab === 'drops' && <Drops toast={toast} />}
      {tab === 'report' && <Report toast={toast} />}
    </div>
  );
}

// ── Drop calendar ─────────────────────────────────────────────────────────────
function Drops({ toast }) {
  const [drops, setDrops] = useState(null);
  const [f, setF] = useState({ title: '', category: '', note: '', startsAt: '' });
  const load = () => api.get('/api/admin/drops').then((r) => setDrops(r.drops || [])).catch(() => setDrops([]));
  useEffect(() => { load(); }, []);
  const add = async () => {
    if (!f.title.trim() || !f.startsAt) { toast.error('Title and date/time are required.'); return; }
    try {
      await api.post('/api/admin/drops', {
        title: f.title.trim(), category: f.category.trim() || undefined,
        note: f.note.trim() || undefined, startsAt: new Date(f.startsAt).toISOString(),
      });
      toast.success('Drop scheduled.');
      setF({ title: '', category: '', note: '', startsAt: '' }); load();
    } catch (e) { toast.error(e.message); }
  };
  const del = async (id) => { if (!confirm('Delete this drop?')) return; try { await api.del(`/api/admin/drops/${id}`); load(); } catch (e) { toast.error(e.message); } };
  if (!drops) return <PageLoader />;
  return (
    <div className="space-y-5">
      <div className="card p-4 grid sm:grid-cols-2 gap-3">
        <div><label className="label">Title</label>
          <input className="input" placeholder="e.g. Robux restock" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div><label className="label">When</label>
          <input type="datetime-local" className="input" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></div>
        <div><label className="label">Category (optional)</label>
          <input className="input" placeholder="robux, v-bucks…" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></div>
        <div><label className="label">Note (optional)</label>
          <input className="input" placeholder="Big restock + 10% off" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        <div className="sm:col-span-2"><button onClick={add} className="btn-primary"><Plus size={16} /> Schedule drop</button></div>
      </div>
      {drops.length === 0 ? <div className="card p-8 text-center text-slate-400">No drops yet.</div> : (
        <div className="space-y-2">
          {drops.map((d) => (
            <div key={d.id} className="card p-3 flex items-center gap-3">
              <div className="text-sm text-white font-mono shrink-0">{date(d.startsAt)}</div>
              <div className="min-w-0 flex-1">
                <div className="text-white text-sm font-medium">{d.title} {d.category && <span className="text-slate-500 text-xs">· {d.category}</span>}</div>
                {d.note && <div className="text-slate-400 text-xs">{d.note}</div>}
              </div>
              <button title="Delete" onClick={() => del(d.id)} className="text-slate-500 hover:text-red-400"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Coupons ──────────────────────────────────────────────────────────────────
function Coupons({ coupons, toast, call }) {
  const [f, setF] = useState({ code: '', kind: 'percent', value: 10, minSubtotal: '', maxRedemptions: '', perUserLimit: '', expiresAt: '' });
  const create = () => call(async () => {
    await api.post('/api/admin/monetization/coupons', {
      code: f.code.trim().toUpperCase(), kind: f.kind, value: Number(f.value),
      minSubtotal: f.minSubtotal ? Math.round(Number(f.minSubtotal) * 100) : 0,
      maxRedemptions: f.maxRedemptions ? Number(f.maxRedemptions) : null,
      perUserLimit: f.perUserLimit ? Number(f.perUserLimit) : null,
      expiresAt: f.expiresAt || null,
    });
    toast.success('Coupon created.');
    setF({ code: '', kind: 'percent', value: 10, minSubtotal: '', maxRedemptions: '', perUserLimit: '', expiresAt: '' });
  });

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <h3 className="text-white mb-4 flex items-center gap-2"><Plus size={16} /> New coupon</h3>
        <div className="grid sm:grid-cols-3 gap-3">
          <div><label className="label">Code</label><input className="input uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="WELCOME10" /></div>
          <div><label className="label">Type</label>
            <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="percent">% off</option><option value="fixed">€ off</option>
            </select></div>
          <div><label className="label">{f.kind === 'percent' ? 'Percent (1-90)' : 'Amount (€)'}</label>
            <input className="input" type="number" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></div>
          <div><label className="label">Min spend (€)</label><input className="input" type="number" value={f.minSubtotal} onChange={(e) => setF({ ...f, minSubtotal: e.target.value })} placeholder="optional" /></div>
          <div><label className="label">Max uses</label><input className="input" type="number" value={f.maxRedemptions} onChange={(e) => setF({ ...f, maxRedemptions: e.target.value })} placeholder="∞" /></div>
          <div><label className="label">Per customer</label><input className="input" type="number" value={f.perUserLimit} onChange={(e) => setF({ ...f, perUserLimit: e.target.value })} placeholder="∞" /></div>
        </div>
        <button onClick={create} disabled={!f.code.trim()} className="btn-primary mt-4">Create coupon</button>
      </div>

      {coupons.length === 0 ? <div className="card p-8 text-center text-slate-400">No coupons yet.</div> : (
        <div className="card divide-y divide-white/5">
          {coupons.map((c) => (
            <div key={c.id} className={`flex items-center gap-3 px-5 py-3.5 ${c.active ? '' : 'opacity-50'}`}>
              <span className="w-9 h-9 rounded-xl grid place-items-center bg-violet-500/10 text-violet-300 shrink-0">{c.kind === 'percent' ? <Percent size={15} /> : <Euro size={15} />}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-white">{c.code}</span>
                  <button onClick={() => { navigator.clipboard?.writeText(c.code); toast.success('Copied'); }} className="text-slate-500 hover:text-white"><Copy size={12} /></button>
                  <span className="text-emerald-300 text-sm">{c.kind === 'percent' ? `${c.value}% off` : `${money(c.value, 'EUR')} off`}</span>
                </div>
                <div className="text-slate-500 text-xs mt-0.5">
                  {c.minSubtotal ? `min ${money(c.minSubtotal, 'EUR')} · ` : ''}
                  used {c.redeemedCount}{c.maxRedemptions ? `/${c.maxRedemptions}` : ''}
                  {c.perUserLimit ? ` · ${c.perUserLimit}/customer` : ''}
                  {c.expiresAt ? ` · expires ${date(c.expiresAt)}` : ''}
                </div>
              </div>
              <button title={c.active ? 'Disable' : 'Enable'} onClick={() => call(() => api.patch(`/api/admin/monetization/coupons/${c.id}`, { active: !c.active }))}
                className={`p-2 rounded-lg hover:bg-white/10 ${c.active ? 'text-emerald-400' : 'text-slate-500'}`}><Power size={15} /></button>
              <button title="Delete" onClick={() => confirm(`Delete ${c.code}?`) && call(() => api.del(`/api/admin/monetization/coupons/${c.id}`))}
                className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-white/10"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Gift cards ───────────────────────────────────────────────────────────────
function GiftCards({ cards, toast, call }) {
  const [f, setF] = useState({ amount: '', recipientEmail: '', note: '' });
  const issue = () => call(async () => {
    const r = await api.post('/api/admin/monetization/gift-cards', {
      amount: Math.round(Number(f.amount) * 100),
      recipientEmail: f.recipientEmail.trim() || undefined, note: f.note.trim() || undefined,
    });
    toast.success(`Issued ${r.giftCard.code}`);
    setF({ amount: '', recipientEmail: '', note: '' });
  });
  return (
    <div className="space-y-5">
      <div className="card p-5">
        <h3 className="text-white mb-4 flex items-center gap-2"><Plus size={16} /> Issue gift card</h3>
        <div className="grid sm:grid-cols-3 gap-3">
          <div><label className="label">Amount (€)</label><input className="input" type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="25.00" /></div>
          <div><label className="label">Recipient email</label><input className="input" value={f.recipientEmail} onChange={(e) => setF({ ...f, recipientEmail: e.target.value })} placeholder="optional" /></div>
          <div><label className="label">Note</label><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="optional" /></div>
        </div>
        <button onClick={issue} disabled={!f.amount} className="btn-primary mt-4">Issue gift card</button>
      </div>

      {cards.length === 0 ? <div className="card p-8 text-center text-slate-400">No gift cards yet.</div> : (
        <div className="card divide-y divide-white/5">
          {cards.map((g) => (
            <div key={g.id} className={`flex items-center gap-3 px-5 py-3.5 ${g.status === 'active' ? '' : 'opacity-60'}`}>
              <span className="w-9 h-9 rounded-xl grid place-items-center bg-pink-500/10 text-pink-300 shrink-0"><Gift size={15} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-white text-sm">{g.code}</span>
                  <button onClick={() => { navigator.clipboard?.writeText(g.code); toast.success('Copied'); }} className="text-slate-500 hover:text-white"><Copy size={12} /></button>
                </div>
                <div className="text-slate-500 text-xs mt-0.5">
                  {money(g.balance, g.currency)} / {money(g.initialBalance, g.currency)} · <span className={g.status === 'redeemed' ? 'text-fuchsia-300' : g.status === 'disabled' ? 'text-red-300' : 'text-emerald-300'}>{g.status}</span>
                  {g.recipientEmail ? ` · ${g.recipientEmail}` : ''}
                </div>
              </div>
              {g.status !== 'redeemed' && (
                <button title={g.status === 'active' ? 'Disable' : 'Enable'}
                  onClick={() => call(() => api.patch(`/api/admin/monetization/gift-cards/${g.id}`, { status: g.status === 'active' ? 'disabled' : 'active' }))}
                  className={`p-2 rounded-lg hover:bg-white/10 ${g.status === 'active' ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {g.status === 'active' ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Report ───────────────────────────────────────────────────────────────────
function Report({ toast }) {
  const [r, setR] = useState(null);
  useEffect(() => { api.get('/api/admin/monetization/report?days=90').then(setR).catch((e) => toast.error(e.message)); }, [toast]);
  if (!r) return <PageLoader />;

  const Table = ({ title, rows, keyField, keyLabel }) => (
    <div>
      <h3 className="text-white text-sm font-semibold mb-3">{title}</h3>
      {rows.length === 0 ? <div className="card p-6 text-slate-500 text-sm">No data in the last {r.rangeDays} days.</div> : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-400 border-b border-white/5">
              <tr><th className="px-4 py-2.5 font-medium">{keyLabel}</th><th className="px-4 py-2.5 font-medium text-right">Orders</th><th className="px-4 py-2.5 font-medium text-right">Discount given</th><th className="px-4 py-2.5 font-medium text-right">Revenue</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-white/5">
                  <td className="px-4 py-2.5 font-mono text-white">{row[keyField]}</td>
                  <td className="px-4 py-2.5 text-right text-slate-300">{row.orders}</td>
                  <td className="px-4 py-2.5 text-right text-amber-300">−{row.discountFormatted}</td>
                  <td className="px-4 py-2.5 text-right text-emerald-300">{row.revenueFormatted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={TrendingDown} label="Discounts given (90d)" value={r.totals.totalDiscountFormatted} tone="text-amber-300 bg-amber-500/10" />
        <Kpi icon={BarChart3} label="Promo-driven revenue" value={r.totals.promoRevenueFormatted} tone="text-emerald-300 bg-emerald-500/10" />
        <Kpi icon={Gift} label="Gift cards outstanding" value={r.giftCards.outstandingFormatted} tone="text-pink-300 bg-pink-500/10" sub={`${r.giftCards.issued} issued · ${r.giftCards.redeemed} redeemed`} />
        <Kpi icon={Wallet} label="Gift-card value redeemed" value={r.giftCards.redeemedValueFormatted} tone="text-violet-300 bg-violet-500/10" />
      </div>
      <Table title="Top coupons by revenue" rows={r.coupons} keyField="code" keyLabel="Code" />
      <Table title="Top bundles by revenue" rows={r.bundles} keyField="name" keyLabel="Bundle" />
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className="card p-4">
      <span className={`w-9 h-9 rounded-xl grid place-items-center mb-3 ${tone}`}><Icon size={17} /></span>
      <div className="text-xl font-display text-white leading-none">{value}</div>
      <div className="text-slate-400 text-sm mt-1.5">{label}</div>
      {sub && <div className="text-slate-500 text-xs mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Bundles ──────────────────────────────────────────────────────────────────
function Bundles({ bundles, products, toast, call }) {
  const [f, setF] = useState({ name: '', description: '', discountPercent: 15, productIds: [] });
  const toggle = (id) => setF((p) => ({ ...p, productIds: p.productIds.includes(id) ? p.productIds.filter((x) => x !== id) : [...p.productIds, id] }));
  const create = () => call(async () => {
    await api.post('/api/admin/monetization/bundles', {
      name: f.name.trim(), description: f.description.trim() || null,
      productIds: f.productIds, discountPercent: Number(f.discountPercent),
    });
    toast.success('Bundle created.');
    setF({ name: '', description: '', discountPercent: 15, productIds: [] });
  });
  const nameOf = (id) => products.find((p) => p.id === id)?.name || id;

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <h3 className="text-white mb-4 flex items-center gap-2"><Plus size={16} /> New bundle</h3>
        <div className="grid sm:grid-cols-3 gap-3 mb-3">
          <div className="sm:col-span-2"><label className="label">Name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Starter pack" /></div>
          <div><label className="label">Discount %</label><input className="input" type="number" value={f.discountPercent} onChange={(e) => setF({ ...f, discountPercent: e.target.value })} /></div>
        </div>
        <label className="label">Products (pick at least 2)</label>
        <div className="max-h-44 overflow-auto rounded-xl border border-white/10 divide-y divide-white/5">
          {products.length === 0 ? <div className="p-3 text-slate-500 text-sm">Loading products…</div> : products.map((p) => (
            <label key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-white/5">
              <input type="checkbox" checked={f.productIds.includes(p.id)} onChange={() => toggle(p.id)} />
              <span className="text-slate-200 flex-1 truncate">{p.name}</span>
              <span className="text-slate-500">{money(p.price, p.currency)}</span>
            </label>
          ))}
        </div>
        <button onClick={create} disabled={!f.name.trim() || f.productIds.length < 2} className="btn-primary mt-4">Create bundle</button>
      </div>

      {bundles.length === 0 ? <div className="card p-8 text-center text-slate-400">No bundles yet.</div> : (
        <div className="card divide-y divide-white/5">
          {bundles.map((b) => (
            <div key={b.id} className={`flex items-center gap-3 px-5 py-3.5 ${b.active ? '' : 'opacity-50'}`}>
              <span className="w-9 h-9 rounded-xl grid place-items-center bg-amber-500/10 text-amber-300 shrink-0"><Package size={15} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-white text-sm">{b.name} <span className="text-emerald-300">−{b.discountPercent}%</span></div>
                <div className="text-slate-500 text-xs mt-0.5 truncate">{b.productIds.map(nameOf).join(' + ')}</div>
              </div>
              <button title={b.active ? 'Disable' : 'Enable'} onClick={() => call(() => api.patch(`/api/admin/monetization/bundles/${b.id}`, { active: !b.active }))}
                className={`p-2 rounded-lg hover:bg-white/10 ${b.active ? 'text-emerald-400' : 'text-slate-500'}`}><Power size={15} /></button>
              <button title="Delete" onClick={() => confirm(`Delete ${b.name}?`) && call(() => api.del(`/api/admin/monetization/bundles/${b.id}`))}
                className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-white/10"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
