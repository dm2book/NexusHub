import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScrollText, ShieldAlert, Users } from 'lucide-react';
import { api } from '../../lib/api.js';
import { date, money } from '../../lib/format.js';
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

/**
 * The suspicious-order queue.
 *
 * Held orders sit at the top because those are the ones where a delivery is
 * actually stopped and a real customer may be waiting. Every row states the
 * signals that caught it — a score on its own is something people learn to
 * click past, and both answers here have a cost: approving hands over a code
 * that cannot be recalled, rejecting turns away a paying customer.
 */
function FraudReview() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');

  const load = () => api.get('/api/admin/security/fraud').then(setData).catch(() => setData({ flagged: [] }));
  useEffect(() => { load(); }, []);

  const act = async (id, action) => {
    if (action === 'reject'
      && !window.confirm('Refund this order and keep it held? The money goes back through the payment provider.')) return;
    setBusy(id);
    try {
      const r = await api.post(`/api/admin/security/fraud/${id}/${action}`, {});
      toast.success(action === 'approve'
        ? (r.delivered ? 'Released and delivered.' : 'Released — it will deliver on the normal path.')
        : 'Rejected and refunded.');
      load();
    } catch (e) { toast.error(e.message || 'That did not work.'); }
    finally { setBusy(''); }
  };

  if (!data) return <PageLoader />;
  const flagged = data.flagged || [];
  const cb = data.chargebackSummary || {};

  return (
    <div className="space-y-6">
      {/* What the automatic limits currently are. Stated rather than hidden in
          env vars: they turn real customers away, so whoever runs the shop
          should be able to see the ceilings they are enforcing. */}
      <div className="grid sm:grid-cols-4 gap-3">
        <Stat label="Held right now" value={data.held ?? 0} tone={data.held ? 'amber' : 'plain'} />
        <Stat label="Chargebacks (all time)" value={cb.count ?? 0} tone={cb.count ? 'red' : 'plain'} />
        <Stat label="Cost of them" value={money(cb.totalCents || 0)} tone={cb.totalCents ? 'red' : 'plain'} />
        <Stat label="Max single order" value={money(data.limits?.maxOrderValue || 0)} />
      </div>

      <div className="card divide-y divide-white/5">
        <div className="px-5 py-3 text-white font-medium">Flagged orders</div>
        {flagged.length === 0 && (
          <div className="px-5 py-8 text-center text-slate-500">Nothing flagged. Every order has gone straight through.</div>
        )}
        {flagged.map((o) => {
          const signals = (() => { try { return JSON.parse(o.signals || '[]'); } catch { return []; } })();
          return (
            <div key={o.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link to={`/admin/orders/${o.id}`} className="text-indigo-400 font-mono text-sm">{o.number}</Link>
                    {o.fraud_hold
                      ? <span className="text-xs px-2 py-0.5 rounded-md bg-red-500/15 text-red-300">delivery held</span>
                      : <span className="text-xs px-2 py-0.5 rounded-md bg-slate-500/15 text-slate-300">reviewed</span>}
                    <span className="text-xs px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300">score {o.fraud_score ?? '—'}</span>
                  </div>
                  <div className="text-slate-500 text-xs mt-1">
                    {o.email} · {money(o.total, o.currency)} · {date(o.created_at)} · {o.status}
                  </div>
                  {signals.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {signals.map((sig) => (
                        <li key={sig.rule} className="text-amber-300/85 text-xs">
                          • {sig.detail} <span className="text-slate-600">(+{sig.weight})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {o.fraud_reviewed_at && (
                    <div className="text-slate-600 text-[11px] mt-1.5">
                      Reviewed {date(o.fraud_reviewed_at)} by {o.fraud_reviewed_by || 'staff'}
                    </div>
                  )}
                </div>
                {o.fraud_hold === 1 && (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => act(o.id, 'approve')} disabled={busy === o.id}
                      className="btn-primary text-sm py-2">Approve &amp; deliver</button>
                    <button onClick={() => act(o.id, 'reject')} disabled={busy === o.id}
                      className="btn-ghost text-sm py-2">Reject &amp; refund</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ChargebackLog rows={data.chargebacks || []} onAdded={load} />
    </div>
  );
}

function Stat({ label, value, tone = 'plain' }) {
  const colour = { amber: 'text-amber-300', red: 'text-red-300', plain: 'text-white' }[tone];
  return (
    <div className="card px-4 py-3">
      <div className="text-slate-500 text-[11px] uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-semibold mt-0.5 ${colour}`}>{value}</div>
    </div>
  );
}

/**
 * Chargebacks, and a way to record the ones that never touch the PSP.
 *
 * Mollie reports what it sees, but plenty of disputes reach a small shop as an
 * email or a bank letter instead. Those still have to land in the ledger, or the
 * next order from the same buyer is scored as if nothing ever happened.
 */
function ChargebackLog({ rows, onAdded }) {
  const toast = useToast();
  const [orderNumber, setOrderNumber] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!orderNumber.trim()) return;
    setBusy(true);
    try {
      await api.post('/api/admin/security/chargebacks', {
        orderNumber: orderNumber.trim(), reason: reason.trim() || undefined,
      });
      toast.success('Recorded. Future orders from this customer are scored against it.');
      setOrderNumber(''); setReason(''); onAdded?.();
    } catch (e) { toast.error(e.message || 'Could not record that.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="card">
      <div className="px-5 py-3 text-white font-medium border-b border-white/5">Chargebacks</div>
      <div className="px-5 py-4 flex flex-wrap gap-2 items-end border-b border-white/5">
        <div className="flex-1 min-w-[160px]">
          <label className="label" htmlFor="cb-order">Order number</label>
          <input id="cb-order" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value.toUpperCase())}
            className="input py-2" placeholder="FM-2026-XXXXXXXX" />
        </div>
        <div className="flex-[2] min-w-[200px]">
          <label className="label" htmlFor="cb-reason">Reason (optional)</label>
          <input id="cb-reason" value={reason} onChange={(e) => setReason(e.target.value)}
            className="input py-2" placeholder="e.g. bank letter — cardholder disputes" />
        </div>
        <button onClick={add} disabled={busy || !orderNumber.trim()} className="btn-primary text-sm py-2.5">
          Record
        </button>
      </div>
      {rows.length === 0
        ? <div className="px-5 py-8 text-center text-slate-500">No chargebacks. Long may it last.</div>
        : (
          <div className="divide-y divide-white/5">
            {rows.map((c) => (
              <div key={c.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-mono text-sm text-slate-200">{c.orderNumber || '—'}</span>
                  <span className="text-slate-500 text-xs ml-2">{c.email}</span>
                  {c.reason && <div className="text-slate-600 text-xs mt-0.5">{c.reason}</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-red-300 text-sm">−{money(c.amount, c.currency)}</div>
                  <div className="text-slate-600 text-[11px]">{c.source} · {date(c.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
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
