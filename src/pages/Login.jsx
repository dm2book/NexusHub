import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Zap, AtSign, ArrowRight, Loader2, CheckCircle2, MailCheck, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { track } from '../lib/track.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useI18n } from '../lib/i18n.jsx';

const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const OTP_LEN = 6;
const CODE_TTL = 600; // 10 min, matches server OTP_TTL_MINUTES default

// Turn raw API errors into friendly, actionable copy.
function friendlyError(err) {
  if (err?.status === 0) return 'We couldn’t reach the server. Check your connection and try again.';
  if (err?.status === 429) return 'Too many attempts. Please wait a moment and try again.';
  const m = err?.message || 'Something went wrong. Please try again.';
  if (/incorrect/i.test(m)) return 'That code isn’t right. Check it and try again.';
  if (/expired/i.test(m)) return 'That code expired. Tap “Resend” for a new one.';
  return m;
}

export default function Login() {
  const { login, user } = useAuth();
  const toast = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const dest = location.state?.from || '/account';

  const [providers, setProviders] = useState([]);
  const [step, setStep] = useState('id');        // id | code | totp
  const [totpTicket, setTotpTicket] = useState(null); // 2FA challenge after a correct OTP
  const [identifier, setIdentifier] = useState('');
  const [channel, setChannel] = useState('email');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [codeExpiry, setCodeExpiry] = useState(0);   // seconds left until code expires
  const [resendIn, setResendIn] = useState(0);       // seconds left until resend allowed
  const [otpKey, setOtpKey] = useState(0);           // bump to reset the OTP boxes

  useEffect(() => { if (user) navigate(dest, { replace: true }); }, [user]);
  useEffect(() => { api.get('/api/auth/providers').then((r) => setProviders(r.providers)).catch(() => {}); }, []);

  // Single ticking timer drives both countdowns.
  useEffect(() => {
    if (step !== 'code') return;
    const t = setInterval(() => {
      setCodeExpiry((s) => (s > 0 ? s - 1 : 0));
      setResendIn((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [step]);

  const sendCode = useCallback(async (idValue) => {
    setError('');
    const id = idValue.trim();
    track('otp_requested', { channel: isEmail(id) ? 'email' : 'sms' });
    const r = await api.post('/api/auth/start', { identifier: id });
    if (r.loggedIn) {                       // trusted device → straight in, no OTP
      track('otp_verified', { method: 'trusted_device' });
      await login(r.accessToken);
      navigate(dest, { replace: true });
      return true;
    }
    setChannel(r.channel);
    setCodeExpiry(CODE_TTL);
    setResendIn(30);
    setOtpKey((k) => k + 1);
    setStep('code');
    track('otp_sent', { channel: r.channel });
    return false;
  }, [login, navigate, dest]);

  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await sendCode(identifier); }
    catch (err) { track('otp_failed', { phase: 'request', status: err?.status }); setError(friendlyError(err)); }
    finally { setBusy(false); }
  };

  const resend = async () => {
    if (resendIn > 0 || busy) return;
    setBusy(true);
    try { await sendCode(identifier); toast.success('New code sent.'); }
    catch (err) { setError(friendlyError(err)); }
    finally { setBusy(false); }
  };

  const verify = async (code) => {
    setBusy(true); setError('');
    try {
      const ref = localStorage.getItem('fm_ref') || undefined;
      const r = await api.post('/api/auth/otp/verify', { identifier: identifier.trim(), code, remember, ref });
      if (r.totpRequired) {
        // Account has an authenticator app — one more step.
        setTotpTicket(r.ticket);
        setOtpKey((k) => k + 1);
        setStep('totp');
        return;
      }
      localStorage.removeItem('fm_ref');
      track('otp_verified', { channel });
      await login(r.accessToken);
      navigate(dest, { replace: true });
    } catch (err) {
      track('otp_failed', { phase: 'verify', status: err?.status });
      setError(friendlyError(err));
      setOtpKey((k) => k + 1); // clear boxes for another try
    } finally { setBusy(false); }
  };

  // Final step for 2FA-protected accounts: the current authenticator code.
  const verifyTotp = async (code) => {
    setBusy(true); setError('');
    try {
      const { accessToken } = await api.post('/api/auth/totp/login', { ticket: totpTicket, code, remember });
      localStorage.removeItem('fm_ref');
      track('otp_verified', { channel: 'totp' });
      await login(accessToken);
      navigate(dest, { replace: true });
    } catch (err) {
      track('otp_failed', { phase: 'totp', status: err?.status });
      setError(err?.status === 401
        ? 'Your login expired — start over and try again.'
        : friendlyError(err));
      setOtpKey((k) => k + 1);
    } finally { setBusy(false); }
  };

  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const idIsEmail = isEmail(identifier.trim());

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-10">
      <div className="card w-full max-w-md p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
               style={{ backgroundImage: 'linear-gradient(135deg,#6366f1,#a855f7)' }}>
            <Zap size={26} className="text-white" />
          </div>
          <h1 className="text-2xl text-white">{t('login.title', 'Welcome to ForgeMarket')}</h1>
          <p className="text-slate-400 text-sm mt-1">{t('login.sub', 'Sign in or create an account')}</p>
        </div>

        {step === 'totp' ? (
          <div className="space-y-5">
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-full bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center mb-3">
                <ShieldCheck size={22} className="text-indigo-400" />
              </div>
              <div className="text-white font-medium">{t('login.totp', 'Two-factor authentication')}</div>
              <p className="text-sm text-slate-400 mt-1">
                {t('login.totpSub1', 'Enter the 6-digit code from your')} <span className="text-white font-medium">{t('login.totpApp', 'authenticator app')}</span>.
              </p>
            </div>

            <OtpInput key={otpKey} onComplete={verifyTotp} disabled={busy} />

            {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-center">{error}</p>}
            {busy && <div className="flex items-center justify-center gap-2 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Verifying…</div>}

            <button type="button" onClick={() => { setStep('id'); setTotpTicket(null); setError(''); }}
              className="text-sm text-slate-400 hover:text-white w-full text-center">
              {t('login.startOver', 'Start over')}
            </button>
          </div>
        ) : step === 'id' ? (
          <form onSubmit={start} className="space-y-4">
            <div>
              <label className="label">{t('login.idLabel', 'Email or phone')}</label>
              <div className="relative">
                <AtSign size={16} className="absolute left-3.5 top-3.5 text-slate-500" />
                <input required value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@example.com  ·  +31 6 12345678" className="input pl-10"
                  autoComplete="username" autoFocus />
              </div>
              <p className="text-slate-500 text-xs mt-1.5">
                {identifier.trim() === '' ? t('login.idHint', 'Use your email or phone number.')
                  : idIsEmail ? t('login.emailHint', 'We’ll email you a one-time code.') : t('login.smsHint', 'We’ll text you a one-time code.')}
              </p>
            </div>
            {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
            <button disabled={busy || !identifier.trim()} className="btn-primary w-full py-3">
              {busy ? <><Loader2 size={18} className="animate-spin" /> {t('login.sending', 'Sending code…')}</> : <>{t('login.continue', 'Continue')} <ArrowRight size={16} /></>}
            </button>
          </form>
        ) : (
          <div className="space-y-5">
            {/* Success confirmation */}
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-3">
                <MailCheck size={22} className="text-emerald-400" />
              </div>
              <div className="text-white font-medium flex items-center gap-1.5">
                <CheckCircle2 size={16} className="text-emerald-400" /> {t('login.codeSent', 'Verification code sent')}
              </div>
              <p className="text-sm text-slate-400 mt-1">
                {t('login.weSent', 'We sent a 6-digit code')} {channel === 'sms' ? t('login.bySms', 'by SMS') : t('login.byEmail', 'by email')} {t('login.to', 'to')}<br />
                <span className="text-white font-medium break-all">{identifier}</span>
              </p>
            </div>

            <OtpInput key={otpKey} onComplete={verify} disabled={busy} />

            {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-center">{error}</p>}

            <label className="flex items-center justify-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              {t('login.trust', 'Trust this device — skip the code next time')}
            </label>

            {busy && <div className="flex items-center justify-center gap-2 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> {t('login.verifying', 'Verifying…')}</div>}

            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{codeExpiry > 0 ? `${t('login.expiresIn', 'Code expires in')} ${fmt(codeExpiry)}` : t('login.expired', 'Code expired')}</span>
              <button type="button" onClick={resend} disabled={resendIn > 0 || busy}
                className={`font-medium ${resendIn > 0 ? 'text-slate-600 cursor-not-allowed' : 'text-indigo-400 hover:text-indigo-300'}`}>
                {resendIn > 0 ? `${t('login.resendIn', 'Resend in')} ${resendIn}s` : t('login.resend', 'Resend code')}
              </button>
            </div>

            <button type="button" onClick={() => { setStep('id'); setError(''); }}
              className="text-sm text-slate-400 hover:text-white w-full text-center">
              {t('login.different', 'Use a different email or phone')}
            </button>
          </div>
        )}

        {providers.length > 0 && step === 'id' && (
          <>
            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-slate-500 uppercase tracking-wider">{t('login.or', 'or')}</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
            <div className="space-y-3">
              {providers.includes('google') && (
                <a href={`${api.base}/api/auth/oauth/google/start`} className="btn-ghost w-full">{t('login.google', 'Continue with Google')}</a>
              )}
              {providers.includes('discord') && (
                <a href={`${api.base}/api/auth/oauth/discord/start`} className="btn w-full text-white" style={{ background: '#5865F2' }}>
                  {t('login.discord', 'Continue with Discord')}
                </a>
              )}
            </div>
          </>
        )}
        <p className="text-xs text-slate-500 text-center mt-6">
          {t('login.noPassword', 'No password needed — we use secure one-time codes.')}
        </p>
      </div>
    </div>
  );
}

/** 6 OTP boxes with auto-focus, auto-advance, backspace and full paste support. */
function OtpInput({ onComplete, disabled }) {
  const [vals, setVals] = useState(Array(OTP_LEN).fill(''));
  const refs = useRef([]);

  useEffect(() => { refs.current[0]?.focus(); }, []);

  const submitIfComplete = (next) => {
    const code = next.join('');
    if (code.length === OTP_LEN && next.every((c) => c !== '')) onComplete(code);
  };
  const setAt = (i, v) => { const next = [...vals]; next[i] = v; setVals(next); return next; };

  const onChange = (i, e) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) { setAt(i, ''); return; }
    if (raw.length > 1) return onPaste(raw);   // some keyboards deliver the full code
    const next = setAt(i, raw);
    if (i < OTP_LEN - 1) refs.current[i + 1]?.focus();
    submitIfComplete(next);
  };

  const onKeyDown = (i, e) => {
    if (e.key === 'Backspace') {
      if (vals[i]) { setAt(i, ''); return; }
      if (i > 0) { refs.current[i - 1]?.focus(); setAt(i - 1, ''); }
    } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < OTP_LEN - 1) refs.current[i + 1]?.focus();
  };

  const onPaste = (pastedRaw) => {
    const digits = String(pastedRaw).replace(/\D/g, '').slice(0, OTP_LEN);
    if (!digits) return;
    const next = Array(OTP_LEN).fill('');
    for (let k = 0; k < OTP_LEN; k++) next[k] = digits[k] || '';
    setVals(next);
    const last = Math.min(digits.length, OTP_LEN) - 1;
    refs.current[last >= 0 ? last : 0]?.focus();
    submitIfComplete(next);
  };

  return (
    <div className="flex justify-center gap-2"
      onPaste={(e) => { e.preventDefault(); onPaste(e.clipboardData.getData('text')); }}>
      {vals.map((v, i) => (
        <input key={i} ref={(el) => (refs.current[i] = el)}
          value={v} onChange={(e) => onChange(i, e)} onKeyDown={(e) => onKeyDown(i, e)}
          disabled={disabled} inputMode="numeric" autoComplete="one-time-code" maxLength={1}
          className="w-11 h-14 sm:w-12 rounded-xl bg-space-black/80 border border-white/10 text-white text-center text-2xl font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition disabled:opacity-50" />
      ))}
    </div>
  );
}
