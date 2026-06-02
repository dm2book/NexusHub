import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScrollText, ShieldAlert, Users } from 'lucide-react';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

const TABS = [
  { id: 'audit', label: 'Audit logs', icon: ScrollText, perm: 'audit.read' },
  { id: 'fraud', label: 'Fraud review', icon: ShieldAlert, perm: 'security.manage' },
  { id: 'users', label: 'Users & roles', icon: Users, perm: 'users.read' },
];

export default function Security() {
  const { hasPermission } = useAuth();
  const tabs = TABS.filter((t) => hasPermission(t.perm));
  const [tab, setTab] = useState(tabs[0]?.id || 'audit');

  return (
    <div>
      <h1 className="text-2xl text-white mb-6">Security</h1>
      <div className="flex gap-2 mb-6">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 ${tab === id
              ? 'bg-primary text-white' : 'bg-white/5 text-slate-400 hover:text-white'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {tab === 'audit' && <AuditLogs />}
      {tab === 'fraud' && <FraudReview />}
      {tab === 'users' && <UsersRoles />}
    </div>
  );
}

function AuditLogs() {
  const [logs, setLogs] = useState(null);
  useEffect(() => { api.get('/api/admin/security/audit').then((r) => setLogs(r.logs)).catch(() => setLogs([])); }, []);
  if (!logs) return <PageLoader />;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm min-w-[700px]">
        <thead className="text-left text-slate-400 border-b border-white/5">
          <tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Actor</th>
            <th className="px-4 py-3">Action</th><th className="px-4 py-3">Target</th><th className="px-4 py-3">IP</th></tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {logs.map((l) => (
            <tr key={l.id}>
              <td className="px-4 py-3 text-slate-400">{date(l.created_at)}</td>
              <td className="px-4 py-3 text-slate-300">{l.actor_email || 'system'}</td>
              <td className="px-4 py-3"><code className="text-indigo-300">{l.action}</code></td>
              <td className="px-4 py-3 text-slate-400 font-mono text-xs">{l.target_type}/{l.target_id?.slice(0, 12)}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">{l.ip}</td>
            </tr>
          ))}
          {logs.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No audit entries.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function FraudReview() {
  const [flagged, setFlagged] = useState(null);
  useEffect(() => { api.get('/api/admin/security/fraud').then((r) => setFlagged(r.flagged)).catch(() => setFlagged([])); }, []);
  if (!flagged) return <PageLoader />;
  return (
    <div className="card divide-y divide-white/5">
      {flagged.length === 0 && <div className="px-5 py-8 text-center text-slate-500">No flagged orders.</div>}
      {flagged.map((o) => (
        <div key={o.id} className="px-5 py-4 flex items-center justify-between">
          <div>
            <Link to={`/admin/orders/${o.id}`} className="text-indigo-400 font-mono text-sm">{o.number}</Link>
            <div className="text-slate-500 text-xs">{o.email} · score {o.fraud_score_latest}</div>
            <div className="text-amber-300/80 text-xs mt-1">
              {JSON.parse(o.signals || '[]').map((s) => s.detail).join(' · ')}
            </div>
          </div>
          <span className={`text-xs px-2 py-1 rounded-md ${o.fraud_status === 'blocked'
            ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>{o.fraud_status}</span>
        </div>
      ))}
    </div>
  );
}

function UsersRoles() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [roles, setRoles] = useState([]);

  const load = () => api.get('/api/admin/security/users').then((r) => setUsers(r.users)).catch(() => setUsers([]));
  useEffect(() => {
    load();
    api.get('/api/admin/security/roles').then((r) => setRoles(r.roles)).catch(() => {});
  }, []);
  if (!users) return <PageLoader />;

  const toggleRole = async (u, roleId) => {
    const has = u.roles.includes(roleId);
    const next = has ? u.roles.filter((r) => r !== roleId) : [...u.roles, roleId];
    if (next.length === 0) return toast.error('A user needs at least one role.');
    try { await api.put(`/api/admin/security/users/${u.id}/roles`, { roles: next }); load(); toast.success('Roles updated.'); }
    catch (err) { toast.error(err.message); }
  };

  return (
    <div className="space-y-3">
      {users.map((u) => (
        <div key={u.id} className="card p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-white text-sm">{u.displayName || u.email}</div>
            <div className="text-slate-500 text-xs">{u.email}</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {roles.map((r) => {
              const active = u.roles.includes(r.id);
              return (
                <button key={r.id} onClick={() => toggleRole(u, r.id)}
                  disabled={u.id === me.id && r.id === 'owner'}
                  className={`text-xs px-2.5 py-1 rounded-md transition ${active
                    ? 'bg-primary text-white' : 'bg-white/5 text-slate-400 hover:text-white'}`}>
                  {r.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
