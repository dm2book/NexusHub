import { useState, useEffect, useCallback } from 'react';
import {
  Monitor, LogOut, ShieldCheck, Smartphone, Pencil, History, Check,
  User, Mail, Phone, BadgeCheck, Trash2, X,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

export default function Profile() {
  const { user } = useAuth();
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl text-white">Profile & security</h1>
        <p className="text-slate-400 text-sm mt-1">Manage your identity, sign-in and trusted devices.</p>
      </div>
      <Identity />
      <PhoneSection />
      <Preferences />
      <ActiveSessions />
      <TrustedDevices />
      <LoginHistory />
      <div className="card p-6">
        <h3 className="text-white mb-1">Account role</h3>
        <p className="text-slate-400 text-sm capitalize">{user?.roles?.join(', ').replace(/_/g, ' ') || 'customer'}</p>
      </div>
    </div>
  );
}

// ── Identity: username + email ───────────────────────────────────────────────
function Identity() {
  const { user, reload } = useAuth();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!displayName.trim()) { toast.error('Enter a username.'); return; }
    setBusy(true);
    try { await api.patch('/api/account/profile', { displayName: displayName.trim() }); await reload(); toast.success('Profile updated.'); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="card p-6">
      <h3 className="text-white flex items-center gap-2 mb-4"><User size={17} className="text-indigo-300" /> Identity</h3>
      <div className="space-y-4">
        <div>
          <label className="label">Username</label>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your display name" />
        </div>
        <div>
          <label className="label flex items-center gap-2">Email {user?.emailVerified && <span className="inline-flex items-center gap-1 text-emerald-400 text-xs"><BadgeCheck size={12} /> Verified</span>}</label>
          <div className="relative">
            <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className="input pl-9 opacity-70" value={user?.email || ''} disabled />
          </div>
        </div>
        <button onClick={save} disabled={busy} className="btn-primary">{busy ? 'Saving…' : 'Save profile'}</button>
      </div>
    </div>
  );
}

// ── Phone: add + verify via SMS OTP ──────────────────────────────────────────
function PhoneSection() {
  const { user, reload } = useAuth();
  const toast = useToast();
  const [step, setStep] = useState('idle');          // idle | enter | code
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const hasPhone = !!user?.phone;

  const request = async () => {
    if (phone.trim().length < 6) { toast.error('Enter a valid phone number.'); return; }
    setBusy(true);
    try { await api.post('/api/account/phone/request', { phone: phone.trim() }); setStep('code'); toast.success('Code sent by SMS.'); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true);
    try { await api.post('/api/account/phone/verify', { phone: phone.trim(), code: code.trim() }); await reload(); setStep('idle'); setPhone(''); setCode(''); toast.success('Phone verified.'); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirm('Remove your phone number? You can re-add it later.')) return;
    try { await api.del('/api/account/phone'); await reload(); toast.success('Phone removed.'); }
    catch (err) { toast.error(err.message); }
  };

  return (
    <div className="card p-6">
      <h3 className="text-white flex items-center gap-2 mb-1"><Phone size={17} className="text-indigo-300" /> Phone number</h3>
      <p className="text-slate-500 text-sm mb-4">Add a phone for SMS login and security alerts.</p>

      {hasPhone ? (
        <div className="flex items-center gap-3 bg-space-black rounded-xl px-4 py-3">
          <Smartphone size={18} className="text-slate-400" />
          <div className="flex-1">
            <div className="text-white text-sm flex items-center gap-2">{user.phone}
              {user.phoneVerified && <span className="inline-flex items-center gap-1 text-emerald-400 text-xs"><BadgeCheck size={12} /> Verified</span>}</div>
          </div>
          <button onClick={remove} className="text-slate-400 hover:text-red-400 text-xs flex items-center gap-1"><Trash2 size={13} /> Remove</button>
        </div>
      ) : step === 'idle' ? (
        <button onClick={() => setStep('enter')} className="btn-ghost text-sm"><Phone size={15} /> Add phone number</button>
      ) : (
        <div className="space-y-3">
          {step === 'enter' ? (
            <>
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+31 6 12345678" autoFocus />
              <div className="flex gap-2">
                <button onClick={request} disabled={busy} className="btn-primary text-sm">{busy ? 'Sending…' : 'Send code'}</button>
                <button onClick={() => setStep('idle')} className="btn-ghost text-sm"><X size={14} /> Cancel</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-slate-400 text-sm">Enter the 6-digit code sent to <span className="text-white">{phone}</span>.</p>
              <input className="input tracking-[0.4em] font-mono text-center" value={code} maxLength={6}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••••" autoFocus />
              <div className="flex gap-2">
                <button onClick={verify} disabled={busy} className="btn-primary text-sm">{busy ? 'Verifying…' : 'Verify'}</button>
                <button onClick={() => setStep('enter')} className="btn-ghost text-sm">Back</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Email notification preferences ───────────────────────────────────────────
function Preferences() {
  const { user, reload } = useAuth();
  const toast = useToast();
  const prefs = user?.preferences || {};
  const [emailOrderUpdates, setOrderUpdates] = useState(prefs.emailOrderUpdates !== false);
  const [emailMarketing, setMarketing] = useState(!!prefs.emailMarketing);

  const save = async () => {
    try { await api.patch('/api/account/preferences', { emailOrderUpdates, emailMarketing }); await reload(); toast.success('Preferences saved.'); }
    catch (err) { toast.error(err.message); }
  };
  return (
    <div className="card p-6">
      <h3 className="text-white mb-4">Email notifications</h3>
      <div className="space-y-3">
        <Toggle label="Order & delivery emails" checked={emailOrderUpdates} onChange={setOrderUpdates} />
        <Toggle label="Product news & offers" checked={emailMarketing} onChange={setMarketing} />
        <button onClick={save} className="btn-primary mt-2">Save preferences</button>
      </div>
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

// ── Active sessions ──────────────────────────────────────────────────────────
function ActiveSessions() {
  const toast = useToast();
  const [sessions, setSessions] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.get('/api/auth/sessions').then((r) => setSessions(r.sessions)).catch(() => setSessions([])); }, []);
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
        {sessions?.length > 1 && <button onClick={revokeOthers} disabled={busy} className="btn-ghost text-xs"><LogOut size={14} /> Sign out others</button>}
      </div>
      <p className="text-slate-500 text-sm mb-4">Devices currently signed in. Revoke any you don’t recognise.</p>
      {sessions === null ? <p className="text-slate-500 text-sm">Loading…</p>
        : sessions.length === 0 ? <p className="text-slate-500 text-sm">No active sessions.</p>
        : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-3 bg-space-black rounded-xl px-4 py-3">
                <Monitor size={18} className="text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm flex items-center gap-2">{s.device}
                    {s.current && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">This device</span>}</div>
                  <div className="text-slate-500 text-xs">{s.ip || 'unknown IP'} · active {date(s.lastUsedAt)}</div>
                </div>
                {!s.current && <button onClick={() => revoke(s.id)} disabled={busy} className="text-xs text-slate-400 hover:text-red-400">Revoke</button>}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ── Trusted devices ──────────────────────────────────────────────────────────
function TrustedDevices() {
  const toast = useToast();
  const [devices, setDevices] = useState(null);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const load = useCallback(() => { api.get('/api/auth/devices').then((r) => setDevices(r.devices)).catch(() => setDevices([])); }, []);
  useEffect(() => { load(); }, [load]);

  const rename = async (id) => {
    try { await api.patch(`/api/auth/devices/${id}`, { name }); toast.success('Renamed.'); setEditing(null); load(); }
    catch (err) { toast.error(err.message); }
  };
  const revoke = async (id) => {
    try { await api.del(`/api/auth/devices/${id}`); toast.success('Device removed — it’ll need a code next time.'); load(); }
    catch (err) { toast.error(err.message); }
  };
  const logoutAll = async () => {
    try { await api.post('/api/auth/logout-all'); toast.success('Signed out everywhere.'); window.location.href = '/login'; }
    catch (err) { toast.error(err.message); }
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-white flex items-center gap-2"><Smartphone size={17} className="text-indigo-300" /> Trusted devices</h3>
        <button onClick={logoutAll} className="btn-ghost text-xs text-red-300 hover:bg-red-500/10"><LogOut size={14} /> Sign out everywhere</button>
      </div>
      <p className="text-slate-500 text-sm mb-4">Devices that skip the login code. Remove any you don’t recognise.</p>
      {devices === null ? <p className="text-slate-500 text-sm">Loading…</p>
        : devices.length === 0 ? <p className="text-slate-500 text-sm">No trusted devices yet. Tick “Trust this device” at login.</p>
        : (
          <div className="space-y-2">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center gap-3 bg-space-black rounded-xl px-4 py-3">
                <Monitor size={18} className="text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  {editing === d.id ? (
                    <div className="flex gap-2">
                      <input className="input py-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                      <button onClick={() => rename(d.id)} className="btn-primary px-3 py-1 text-xs"><Check size={13} /></button>
                    </div>
                  ) : (
                    <>
                      <div className="text-white text-sm">{d.name || 'Device'}</div>
                      <div className="text-slate-500 text-xs">{d.ip || 'unknown IP'} · last used {date(d.lastUsedAt)}</div>
                    </>
                  )}
                </div>
                {editing !== d.id && <button onClick={() => { setEditing(d.id); setName(d.name || ''); }} className="p-1.5 text-slate-400 hover:text-white"><Pencil size={14} /></button>}
                <button onClick={() => revoke(d.id)} className="text-xs text-slate-400 hover:text-red-400">Remove</button>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ── Login history ────────────────────────────────────────────────────────────
function LoginHistory() {
  const [history, setHistory] = useState(null);
  useEffect(() => { api.get('/api/auth/login-history').then((r) => setHistory(r.history)).catch(() => setHistory([])); }, []);
  return (
    <div className="card p-6">
      <h3 className="text-white flex items-center gap-2 mb-4"><History size={17} className="text-slate-400" /> Login history</h3>
      {history === null ? <p className="text-slate-500 text-sm">Loading…</p>
        : history.length === 0 ? <p className="text-slate-500 text-sm">No login history yet.</p>
        : (
          <div className="space-y-1.5 max-h-64 overflow-auto">
            {history.map((h, i) => (
              <div key={i} className="flex items-center justify-between text-sm bg-space-black rounded-lg px-3 py-2">
                <span className="text-slate-300">{h.success ? '✅' : '❌'} {h.channel?.replace('_', ' ')}
                  {h.suspicious ? <span className="text-amber-300 text-xs ml-1">· new device</span> : ''}</span>
                <span className="text-slate-500 text-xs">{h.ip || '—'} · {date(h.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
