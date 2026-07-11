import { useEffect, useState, useCallback } from 'react';
import { Search, ShieldCheck, Mail, Crown, Loader2, BadgeCheck, Gift, Wallet, Plus, Minus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { date, money } from '../../lib/format.js';
import { PageLoader, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

const ROLE_STYLE = {
  owner: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  admin: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30',
  support: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  moderator: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  customer: 'bg-white/5 text-slate-400 border-white/10',
};

export default function AdminUsers() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [roles, setRoles] = useState([]);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [creditUser, setCreditUser] = useState(null);

  const load = useCallback((q = '') => {
    const qs = q ? `?search=${encodeURIComponent(q)}` : '';
    return api.get(`/api/admin/security/users${qs}`).then((r) => setUsers(r.users)).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    load();
    api.get('/api/admin/security/roles').then((r) => setRoles(r.roles)).catch(() => {});
  }, [load]);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => load(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search, load]);

  const grantCoins = async (u) => {
    const raw = prompt(`How many Forge Coins for ${u.email}? (negative deducts)`, '5');
    if (raw == null) return;
    const amount = parseInt(raw, 10);
    if (!amount) { toast.error('Enter a non-zero whole number.'); return; }
    setBusyId(u.id);
    try {
      const r = await api.post(`/api/admin/security/users/${u.id}/coins`, { amount });
      toast.success(`${amount > 0 ? 'Gave' : 'Deducted'} ${Math.abs(amount)} coin(s) — balance is now ${r.balance}.`);
    } catch (e) { toast.error(e.message); }
    finally { setBusyId(null); }
  };

  const grantPlus = async (u) => {
    setBusyId(u.id);
    try { await api.post(`/api/admin/security/users/${u.id}/membership`, { days: 30 }); toast.success(`Forge+ granted to ${u.email} (30 days).`); }
    catch (err) { toast.error(err.message); } finally { setBusyId(null); }
  };

  const toggleRole = async (u, roleId) => {
    const has = u.roles.includes(roleId);
    const next = has ? u.roles.filter((r) => r !== roleId) : [...u.roles, roleId];
    if (next.length === 0) return toast.error('A user needs at least one role.');
    setBusyId(u.id);
    try {
      await api.put(`/api/admin/security/users/${u.id}/roles`, { roles: next });
      toast.success(`${has ? 'Removed' : 'Granted'} ${roleId} for ${u.email}`);
      await load(search.trim());
    } catch (err) { toast.error(err.message); }
    finally { setBusyId(null); }
  };

  if (!users) return <PageLoader />;

  const sorted = [...users].sort((a, b) => {
    const rank = (u) => (u.roles.includes('owner') ? 3 : u.roles.includes('admin') ? 2 : u.roles.some((r) => r !== 'customer') ? 1 : 0);
    return rank(b) - rank(a);
  });
  const adminCount = users.filter((u) => u.roles.some((r) => r !== 'customer')).length;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
        <h1 className="text-2xl text-white">Users</h1>
        <div className="text-sm text-slate-400">{users.length} shown · {adminCount} staff</div>
      </div>
      <p className="text-slate-400 text-sm mb-6">Everyone who created an account. Search by email or name, and grant or remove roles (incl. Admin / Owner).</p>

      <div className="relative max-w-md mb-6">
        <Search size={16} className="absolute left-3.5 top-3.5 text-slate-500" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} autoFocus
          placeholder="Search by email or name…" className="input pl-10" />
      </div>

      {sorted.length === 0 ? (
        <div className="card p-12 text-center text-slate-400">No users match “{search}”.</div>
      ) : (
        <div className="space-y-3">
          {sorted.map((u) => (
            <div key={u.id} className="card p-4 flex flex-col lg:flex-row lg:items-center gap-4">
              <div className="flex items-center gap-3 min-w-0 lg:w-72">
                {u.avatarUrl
                  ? <img src={u.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                  : <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 grid place-items-center text-white font-semibold shrink-0">
                      {(u.displayName || u.email || '?')[0].toUpperCase()}
                    </div>}
                <div className="min-w-0">
                  <div className="text-white text-sm flex items-center gap-1.5 truncate">
                    {u.displayName || u.email.split('@')[0]}
                    {u.roles.includes('owner') && <Crown size={13} className="text-amber-400 shrink-0" />}
                  </div>
                  <div className="text-slate-500 text-xs flex items-center gap-1 truncate">
                    <Mail size={11} /> {u.email}
                    {u.emailVerified && <BadgeCheck size={11} className="text-emerald-400" />}
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-500 lg:w-44">
                <div>Joined {u.createdAt ? date(u.createdAt) : '—'}</div>
                <div>Last seen {u.lastLoginAt ? date(u.lastLoginAt) : '—'}</div>
              </div>

              <div className="flex flex-wrap gap-1.5 lg:ml-auto items-center">
                {busyId === u.id && <Loader2 size={14} className="animate-spin text-slate-400" />}
                <button onClick={() => setCreditUser(u)} title="Manage store credit"
                  className="text-xs px-2.5 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 inline-flex items-center gap-1">
                  <Wallet size={11} /> Credit
                </button>
                <button onClick={() => grantPlus(u)} title="Grant Forge+ (30 days)"
                  className="text-xs px-2.5 py-1 rounded-md border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 inline-flex items-center gap-1">
                  <Gift size={11} /> Forge+
                </button>
                <button onClick={() => grantCoins(u)} title="Give Forge Coins"
                  className="text-xs px-2.5 py-1 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 inline-flex items-center gap-1">
                  🪙 Coins
                </button>
                {roles.map((r) => {
                  const active = u.roles.includes(r.id);
                  const selfOwnerLock = u.id === me.id && r.id === 'owner';
                  return (
                    <button key={r.id} onClick={() => toggleRole(u, r.id)}
                      disabled={selfOwnerLock || busyId === u.id}
                      title={selfOwnerLock ? "You can't remove your own Owner role" : `Toggle ${r.name}`}
                      className={`text-xs px-2.5 py-1 rounded-md border transition disabled:opacity-50 ${active
                        ? (ROLE_STYLE[r.id] || 'bg-primary/20 text-indigo-200 border-primary/30')
                        : 'bg-white/[0.03] text-slate-500 border-white/10 hover:text-white hover:border-white/20'}`}>
                      {r.id === 'owner' && <ShieldCheck size={11} className="inline mr-1 -mt-0.5" />}
                      {r.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreditModal user={creditUser} onClose={() => setCreditUser(null)} />
    </div>
  );
}

// Store-credit manager: balance, recent ledger, grant/deduct.
function CreditModal({ user, onClose }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!user) return;
    setData(null);
    api.get(`/api/admin/security/users/${user.id}/wallet`).then(setData).catch((e) => toast.error(e.message));
  }, [user, toast]);
  useEffect(() => { load(); }, [load]);

  if (!user) return null;

  const apply = async (sign) => {
    const euros = parseFloat(String(amount).replace(',', '.'));
    if (!euros || euros <= 0) { toast.error('Enter an amount.'); return; }
    const cents = Math.round(euros * 100) * sign;
    setBusy(true);
    try {
      await api.post(`/api/admin/security/users/${user.id}/credit`, { amount: cents, description: note.trim() || undefined });
      toast.success(`${sign > 0 ? 'Added' : 'Deducted'} ${money(Math.abs(cents), 'EUR')}.`);
      setAmount(''); setNote(''); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={!!user} onClose={onClose} title={`Store credit — ${user.displayName || user.email}`}>
      <div className="rounded-2xl p-5 mb-5 text-white" style={{ backgroundImage: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
        <div className="text-white/70 text-xs">Current balance</div>
        <div className="text-3xl font-display mt-0.5">{data ? money(data.balance || 0, 'EUR') : '…'}</div>
      </div>

      <div className="space-y-3 mb-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Amount (€)</label>
            <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5.00" inputMode="decimal" />
          </div>
          <div>
            <label className="label">Note (optional)</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Goodwill, payout…" />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => apply(1)} disabled={busy} className="btn-primary flex-1"><Plus size={15} /> Add credit</button>
          <button onClick={() => apply(-1)} disabled={busy} className="btn-ghost flex-1 text-red-300 hover:bg-red-500/10"><Minus size={15} /> Deduct</button>
        </div>
      </div>

      <div className="text-slate-400 text-xs uppercase tracking-wide mb-2">Recent transactions</div>
      {!data ? <p className="text-slate-500 text-sm">Loading…</p>
        : (data.transactions || []).length === 0 ? <p className="text-slate-500 text-sm">No transactions yet.</p>
        : (
          <div className="space-y-1.5 max-h-56 overflow-auto">
            {(data.transactions || []).map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm bg-space-black rounded-lg px-3 py-2">
                <span className="text-slate-300 truncate pr-2">{t.description || t.type}</span>
                <span className={`shrink-0 font-medium ${t.amount > 0 ? 'text-emerald-400' : 'text-slate-200'}`}>
                  {t.amount > 0 ? '+' : '−'}{money(Math.abs(t.amount), 'EUR')}
                </span>
              </div>
            ))}
          </div>
        )}
    </Modal>
  );
}
