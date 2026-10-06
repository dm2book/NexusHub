import { useState, useEffect, useCallback } from 'react';
import {
  Monitor, LogOut, ShieldCheck, Smartphone, Pencil, History, Check,
  User, Mail, Phone, BadgeCheck, Trash2, X, Volume2,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { getFeedbackPrefs, setFeedbackPref, feedback } from '../../lib/feedback.js';
import { useI18n } from '../../lib/i18n.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import DiscordCard from '../../components/account/DiscordCard.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import TwoFactor from '../../components/account/TwoFactor.jsx';

// Same output as format.js `date`, but in the shop's language rather than the browser's.
const when = (iso, locale) => (iso ? new Date(iso).toLocaleString(locale) : '—');

export default function Profile() {
  const { user } = useAuth();
  const { t } = useI18n();
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl text-white">{t('acc.profile.title', 'Profile & security')}</h1>
        <p className="text-slate-400 text-sm mt-1">{t('acc.profile.subtitle', 'Manage your identity, sign-in and trusted devices.')}</p>
      </div>
      <Identity />
      <DiscordCard />
      <PhoneSection />
      <Preferences />
      <FeedbackPrefs />
      <TwoFactor />
      <ActiveSessions />
      <TrustedDevices />
      <LoginHistory />
      <div className="card p-6">
        <h3 className="text-white mb-1">{t('acc.profile.role', 'Account role')}</h3>
        <p className="text-slate-400 text-sm capitalize">{user?.roles?.join(', ').replace(/_/g, ' ') || t('acc.profile.roleCustomer', 'customer')}</p>
      </div>
    </div>
  );
}

// ── Identity: username + email ───────────────────────────────────────────────
function Identity() {
  const { user, reload } = useAuth();
  const toast = useToast();
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!displayName.trim()) { toast.error(t('acc.profile.enterUsername', 'Enter a username.')); return; }
    setBusy(true);
    try { await api.patch('/api/account/profile', { displayName: displayName.trim() }); await reload(); toast.success(t('acc.profile.updated', 'Profile updated.')); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="card p-6">
      <h3 className="text-white flex items-center gap-2 mb-4"><User size={17} className="text-indigo-300" /> {t('acc.profile.identity', 'Identity')}</h3>
      <div className="space-y-4">
        <div>
          <label className="label">{t('acc.profile.username', 'Username')}</label>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t('acc.profile.usernamePlaceholder', 'Your display name')} />
        </div>
        <div>
          <label className="label flex items-center gap-2">{t('acc.profile.email', 'Email')} {user?.emailVerified && <span className="inline-flex items-center gap-1 text-emerald-400 text-xs"><BadgeCheck size={12} /> {t('acc.profile.verified', 'Verified')}</span>}</label>
          <div className="relative">
            <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className="input pl-9 opacity-70" value={user?.email || ''} disabled />
          </div>
        </div>
        <button onClick={save} disabled={busy} className="btn-primary">{busy ? t('acc.profile.saving', 'Saving…') : t('acc.profile.save', 'Save profile')}</button>
      </div>
    </div>
  );
}

// ── Phone: add + verify via SMS OTP ──────────────────────────────────────────
function PhoneSection() {
  const { user, reload } = useAuth();
  const toast = useToast();
  const { t } = useI18n();
  const [step, setStep] = useState('idle');          // idle | enter | code
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [smsOk, setSmsOk] = useState(false);

  const hasPhone = !!user?.phone;

  useEffect(() => {
    api.get('/api/auth/providers')
      .then((r) => setSmsOk((r.channels || ['email']).includes('sms')))
      .catch(() => setSmsOk(false));
  }, []);

  // Nothing to offer: adding a number buys SMS login and SMS alerts, and
  // without a provider it buys neither. Someone who already stored one still
  // sees it below, so they can take it off.
  if (!smsOk && !hasPhone) return null;

  const request = async () => {
    if (phone.trim().length < 6) { toast.error(t('acc.profile.phoneInvalid', 'Enter a valid phone number.')); return; }
    setBusy(true);
    try { await api.post('/api/account/phone/request', { phone: phone.trim() }); setStep('code'); toast.success(t('acc.profile.codeSent', 'Code sent by SMS.')); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true);
    try { await api.post('/api/account/phone/verify', { phone: phone.trim(), code: code.trim() }); await reload(); setStep('idle'); setPhone(''); setCode(''); toast.success(t('acc.profile.phoneVerified', 'Phone verified.')); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(t('acc.profile.phoneRemoveConfirm', 'Remove your phone number? You can re-add it later.'))) return;
    try { await api.del('/api/account/phone'); await reload(); toast.success(t('acc.profile.phoneRemoved', 'Phone removed.')); }
    catch (err) { toast.error(err.message); }
  };

  // The number is styled on its own, so the sentence is split around it.
  const [sentPre, sentPost = ''] = t('acc.profile.codeSentTo', 'Enter the 6-digit code sent to {phone}.').split('{phone}');

  return (
    <div className="card p-6">
      <h3 className="text-white flex items-center gap-2 mb-1"><Phone size={17} className="text-indigo-300" /> {t('acc.profile.phoneTitle', 'Phone number')}</h3>
      <p className="text-slate-500 text-sm mb-4">{smsOk
        ? t('acc.profile.phoneIntro', 'Add a phone for SMS login and security alerts.')
        : t('acc.profile.phoneSmsOff', 'SMS codes are switched off, so this number isn’t used for login right now.')}</p>

      {hasPhone ? (
        <div className="flex items-center gap-3 bg-space-black rounded-xl px-4 py-3">
          <Smartphone size={18} className="text-slate-400" />
          <div className="flex-1">
            <div className="text-white text-sm flex items-center gap-2">{user.phone}
              {user.phoneVerified && <span className="inline-flex items-center gap-1 text-emerald-400 text-xs"><BadgeCheck size={12} /> {t('acc.profile.verified', 'Verified')}</span>}</div>
          </div>
          <button onClick={remove} className="text-slate-400 hover:text-red-400 text-xs flex items-center gap-1"><Trash2 size={13} /> {t('acc.profile.remove', 'Remove')}</button>
        </div>
      ) : !smsOk ? null : step === 'idle' ? (
        <button onClick={() => setStep('enter')} className="btn-ghost text-sm"><Phone size={15} /> {t('acc.profile.phoneAdd', 'Add phone number')}</button>
      ) : (
        <div className="space-y-3">
          {step === 'enter' ? (
            <>
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+31 6 12345678" autoFocus />
              <div className="flex gap-2">
                <button onClick={request} disabled={busy} className="btn-primary text-sm">{busy ? t('acc.profile.sending', 'Sending…') : t('acc.profile.sendCode', 'Send code')}</button>
                <button onClick={() => setStep('idle')} className="btn-ghost text-sm"><X size={14} /> {t('acc.profile.cancel', 'Cancel')}</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-slate-400 text-sm">{sentPre}<span className="text-white">{phone}</span>{sentPost}</p>
              <input className="input tracking-[0.4em] font-mono text-center" value={code} maxLength={6}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••••" autoFocus />
              <div className="flex gap-2">
                <button onClick={verify} disabled={busy} className="btn-primary text-sm">{busy ? t('acc.profile.verifying', 'Verifying…') : t('acc.profile.verify', 'Verify')}</button>
                <button onClick={() => setStep('enter')} className="btn-ghost text-sm">{t('acc.profile.back', 'Back')}</button>
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
  const { t } = useI18n();
  const prefs = user?.preferences || {};
  const [emailOrderUpdates, setOrderUpdates] = useState(prefs.emailOrderUpdates !== false);
  const [emailMarketing, setMarketing] = useState(!!prefs.emailMarketing);

  const save = async () => {
    try { await api.patch('/api/account/preferences', { emailOrderUpdates, emailMarketing }); await reload(); toast.success(t('acc.profile.prefsSaved', 'Preferences saved.')); }
    catch (err) { toast.error(err.message); }
  };
  return (
    <div className="card p-6">
      <h3 className="text-white mb-4">{t('acc.profile.emailNotifications', 'Email notifications')}</h3>
      <div className="space-y-3">
        <Toggle label={t('acc.profile.orderEmails', 'Order & delivery emails')} checked={emailOrderUpdates} onChange={setOrderUpdates} />
        <Toggle label={t('acc.profile.marketingEmails', 'Product news & offers')} checked={emailMarketing} onChange={setMarketing} />
        <button onClick={save} className="btn-primary mt-2">{t('acc.profile.savePrefs', 'Save preferences')}</button>
      </div>
    </div>
  );
}

// ── Sound & haptics ──────────────────────────────────────────────────────────
function FeedbackPrefs() {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState(() => getFeedbackPrefs());
  const set = (kind, on) => {
    setFeedbackPref(kind, on);
    const next = { ...prefs, [kind]: on };
    setPrefs(next);
    if (on) feedback(kind === 'sound' ? 'success' : 'light'); // sample the cue
  };
  return (
    <div className="card p-6">
      <h3 className="text-white flex items-center gap-2 mb-1"><Volume2 size={17} className="text-indigo-300" /> {t('acc.profile.feedbackTitle', 'Sound & haptics')}</h3>
      <p className="text-slate-500 text-sm mb-4">{t('acc.profile.feedbackIntro', 'Subtle feedback on actions. Haptics work on supported phones; sound is off by default.')}</p>
      <div className="space-y-3">
        <Toggle label={t('acc.profile.haptics', 'Haptic feedback (vibration)')} checked={prefs.haptics} onChange={(v) => set('haptics', v)} />
        <Toggle label={t('acc.profile.sounds', 'Interface sounds')} checked={prefs.sound} onChange={(v) => set('sound', v)} />
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
  const { t, locale } = useI18n();
  const [sessions, setSessions] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.get('/api/auth/sessions').then((r) => setSessions(r.sessions)).catch(() => setSessions([])); }, []);
  useEffect(() => { load(); }, [load]);

  const revoke = async (id) => {
    setBusy(true);
    try { await api.del(`/api/auth/sessions/${id}`); toast.success(t('acc.profile.sessionRevoked', 'Signed out that device.')); load(); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const revokeOthers = async () => {
    setBusy(true);
    try { await api.post('/api/auth/sessions/revoke-others'); toast.success(t('acc.profile.othersRevoked', 'Signed out all other devices.')); load(); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-white flex items-center gap-2"><ShieldCheck size={17} className="text-emerald-400" /> {t('acc.profile.sessionsTitle', 'Active sessions')}</h3>
        {sessions?.length > 1 && <button onClick={revokeOthers} disabled={busy} className="btn-ghost text-xs"><LogOut size={14} /> {t('acc.profile.signOutOthers', 'Sign out others')}</button>}
      </div>
      <p className="text-slate-500 text-sm mb-4">{t('acc.profile.sessionsIntro', 'Devices currently signed in. Revoke any you don’t recognise.')}</p>
      {sessions === null ? <p className="text-slate-500 text-sm">{t('acc.profile.loading', 'Loading…')}</p>
        : sessions.length === 0 ? <p className="text-slate-500 text-sm">{t('acc.profile.noSessions', 'No active sessions.')}</p>
        : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-3 bg-space-black rounded-xl px-4 py-3">
                <Monitor size={18} className="text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm flex items-center gap-2">{s.device}
                    {s.current && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">{t('acc.profile.thisDevice', 'This device')}</span>}</div>
                  <div className="text-slate-500 text-xs">{s.ip || t('acc.profile.unknownIp', 'unknown IP')} · {t('acc.profile.activeAt', 'active {when}', { when: when(s.lastUsedAt, locale) })}</div>
                </div>
                {!s.current && <button onClick={() => revoke(s.id)} disabled={busy} className="text-xs text-slate-400 hover:text-red-400">{t('acc.profile.revoke', 'Revoke')}</button>}
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
  const { t, locale } = useI18n();
  const [devices, setDevices] = useState(null);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const load = useCallback(() => { api.get('/api/auth/devices').then((r) => setDevices(r.devices)).catch(() => setDevices([])); }, []);
  useEffect(() => { load(); }, [load]);

  const rename = async (id) => {
    try { await api.patch(`/api/auth/devices/${id}`, { name }); toast.success(t('acc.profile.renamed', 'Renamed.')); setEditing(null); load(); }
    catch (err) { toast.error(err.message); }
  };
  const revoke = async (id) => {
    try { await api.del(`/api/auth/devices/${id}`); toast.success(t('acc.profile.deviceRemoved', 'Device removed — it’ll need a code next time.')); load(); }
    catch (err) { toast.error(err.message); }
  };
  const logoutAll = async () => {
    try { await api.post('/api/auth/logout-all'); toast.success(t('acc.profile.signedOutEverywhere', 'Signed out everywhere.')); window.location.href = '/login'; }
    catch (err) { toast.error(err.message); }
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-white flex items-center gap-2"><Smartphone size={17} className="text-indigo-300" /> {t('acc.profile.devicesTitle', 'Trusted devices')}</h3>
        <button onClick={logoutAll} className="btn-ghost text-xs text-red-300 hover:bg-red-500/10"><LogOut size={14} /> {t('acc.profile.signOutEverywhere', 'Sign out everywhere')}</button>
      </div>
      <p className="text-slate-500 text-sm mb-4">{t('acc.profile.devicesIntro', 'Devices that skip the login code. Remove any you don’t recognise.')}</p>
      {devices === null ? <p className="text-slate-500 text-sm">{t('acc.profile.loading', 'Loading…')}</p>
        : devices.length === 0 ? <p className="text-slate-500 text-sm">{t('acc.profile.noDevices', 'No trusted devices yet. Tick “Trust this device” at login.')}</p>
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
                      <div className="text-white text-sm">{d.name || t('acc.profile.device', 'Device')}</div>
                      <div className="text-slate-500 text-xs">{d.ip || t('acc.profile.unknownIp', 'unknown IP')} · {t('acc.profile.lastUsedAt', 'last used {when}', { when: when(d.lastUsedAt, locale) })}</div>
                    </>
                  )}
                </div>
                {editing !== d.id && <button onClick={() => { setEditing(d.id); setName(d.name || ''); }} className="p-1.5 text-slate-400 hover:text-white"><Pencil size={14} /></button>}
                <button onClick={() => revoke(d.id)} className="text-xs text-slate-400 hover:text-red-400">{t('acc.profile.remove', 'Remove')}</button>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ── Login history ────────────────────────────────────────────────────────────
function LoginHistory() {
  const { t, locale } = useI18n();
  const [history, setHistory] = useState(null);
  useEffect(() => { api.get('/api/auth/login-history').then((r) => setHistory(r.history)).catch(() => setHistory([])); }, []);
  const channels = {
    email: t('acc.profile.channel.email', 'email'),
    sms: t('acc.profile.channel.sms', 'sms'),
    totp: t('acc.profile.channel.totp', 'totp'),
    trusted_device: t('acc.profile.channel.trustedDevice', 'trusted device'),
  };
  return (
    <div className="card p-6">
      <h3 className="text-white flex items-center gap-2 mb-4"><History size={17} className="text-slate-400" /> {t('acc.profile.historyTitle', 'Login history')}</h3>
      {history === null ? <p className="text-slate-500 text-sm">{t('acc.profile.loading', 'Loading…')}</p>
        : history.length === 0 ? <p className="text-slate-500 text-sm">{t('acc.profile.noHistory', 'No login history yet.')}</p>
        : (
          <div className="space-y-1.5 max-h-64 overflow-auto">
            {history.map((h, i) => (
              <div key={i} className="flex items-center justify-between text-sm bg-space-black rounded-lg px-3 py-2">
                <span className="text-slate-300">{h.success ? '✅' : '❌'} {channels[h.channel] || h.channel?.replace('_', ' ')}
                  {h.suspicious ? <span className="text-amber-300 text-xs ml-1">· {t('acc.profile.newDevice', 'new device')}</span> : ''}</span>
                <span className="text-slate-500 text-xs">{h.ip || '—'} · {when(h.createdAt, locale)}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
