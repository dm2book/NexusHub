import { useEffect, useState, useCallback } from 'react';
import { Search, ShieldCheck, Mail, Crown, Loader2, BadgeCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';
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
    </div>
  );
}
