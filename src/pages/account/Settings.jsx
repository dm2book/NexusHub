import { useState, useEffect, useCallback } from 'react';
import { Monitor, LogOut, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

export default function Settings() {
  const { user, reload } = useAuth();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const prefs = user?.preferences || {};
  const [emailOrderUpdates, setOrderUpdates] = useState(prefs.emailOrderUpdates !== false);
  const [emailMarketing, setMarketing] = useState(!!prefs.emailMarketing);

  const saveProfile = async () => {
    try { await api.patch('/api/account/profile', { displayName }); await reload(); toast.success('Profile updated.'); }
    catch (err) { toast.error(err.message); }
  };
  const savePrefs = async () => {
    try { await api.patch('/api/account/preferences', { emailOrderUpdates, emailMarketing });
      await reload(); toast.success('Preferences saved.'); }
    catch (err) { toast.error(err.message); }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl text-white">Profile settings</h1>

      <div className="card p-6">
        <h3 className="text-white mb-4">Profile</h3>
        <div className="space-y-4">
          <div><label className="label">Email</label>
            <input className="input opacity-60" value={user?.email} disabled /></div>
          <div><label className="label">Display name</label>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
          <button onClick={saveProfile} className="btn-primary">Save profile</button>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-white mb-4">Notifications</h3>
        <div className="space-y-3">
          <Toggle label="Order status emails" checked={emailOrderUpdates} onChange={setOrderUpdates} />
          <Toggle label="Product news & offers" checked={emailMarketing} onChange={setMarketing} />
          <button onClick={savePrefs} className="btn-primary mt-2">Save preferences</button>
        </div>
      </div>

      <ActiveSessions />

      <div className="card p-6">
        <h3 className="text-white mb-1">Roles</h3>
        <p className="text-slate-400 text-sm">{user?.roles?.join(', ') || 'customer'}</p>
      </div>
    </div>
  );
}

function ActiveSessions() {
  const toast = useToast();
  const [sessions, setSessions] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/api/auth/sessions').then((r) => setSessions(r.sessions)).catch(() => setSessions([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const revoke = async (id) => {
    setBusy(true);
    try { await api.del(`/api/auth/sessions/${id}`); toast.success('Signed out that device.'); load(); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const revokeOthers = async () => {
    setBusy(true);
    try { await api.post('/api/auth/sessions/revoke-others'); toast.success('Signed out all other devices.'); load(); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-white flex items-center gap-2"><ShieldCheck size={17} className="text-emerald-400" /> Active sessions</h3>
        {sessions?.length > 1 && (
          <button onClick={revokeOthers} disabled={busy} className="btn-ghost text-xs">
            <LogOut size={14} /> Sign out others
          </button>
        )}
      </div>
      <p className="text-slate-500 text-sm mb-4">Devices currently signed in to your account. Revoke any you don't recognise.</p>
      {sessions === null ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-slate-500 text-sm">No active sessions.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 bg-space-black rounded-xl px-4 py-3">
              <Monitor size={18} className="text-slate-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-white text-sm flex items-center gap-2">
                  {s.device}
                  {s.current && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">This device</span>}
                </div>
                <div className="text-slate-500 text-xs">{s.ip || 'unknown IP'} · active {date(s.lastUsedAt)}</div>
              </div>
              {!s.current && (
                <button onClick={() => revoke(s.id)} disabled={busy} className="text-xs text-slate-400 hover:text-red-400">Revoke</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-slate-300 text-sm">{label}</span>
      <button type="button" onClick={() => onChange(!checked)}
        className={`w-11 h-6 rounded-full transition relative ${checked ? 'bg-primary' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${checked ? 'left-5' : 'left-0.5'}`} />
      </button>
    </label>
  );
}
