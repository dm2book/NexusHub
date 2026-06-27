import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Zap, AtSign, ArrowRight, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

export default function Login() {
  const { login, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const dest = location.state?.from || '/account';

  const [providers, setProviders] = useState([]);
  const [step, setStep] = useState('id'); // id | code
  const [identifier, setIdentifier] = useState('');
  const [channel, setChannel] = useState('email');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) navigate(dest, { replace: true }); }, [user]);
  useEffect(() => { api.get('/api/auth/providers').then((r) => setProviders(r.providers)).catch(() => {}); }, []);

  // Step 1 — identifier → trusted-device instant login OR send code.
  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post('/api/auth/start', { identifier: identifier.trim() });
      if (r.loggedIn) { // trusted device — straight in, no OTP
        await login(r.accessToken);
        toast.success('Welcome back!');
        navigate(dest, { replace: true });
        return;
      }
      setChannel(r.channel);
      setStep('code');
      toast.success(r.channel === 'sms' ? 'We texted you a login code.' : 'We emailed you a login code.');
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  // Step 2 — verify code (+ remember this device).
  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const ref = localStorage.getItem('fm_ref') || undefined;
      const { accessToken } = await api.post('/api/auth/otp/verify', { identifier: identifier.trim(), code, remember, ref });
      localStorage.removeItem('fm_ref');
      await login(accessToken);
      navigate(dest, { replace: true });
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const idIsEmail = isEmail(identifier.trim());

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="card w-full max-w-md p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
               style={{ backgroundImage: 'linear-gradient(135deg,#6366f1,#a855f7)' }}>
            <Zap size={26} className="text-white" />
          </div>
          <h1 className="text-2xl text-white">Welcome to ForgeMarket</h1>
          <p className="text-slate-400 text-sm mt-1">Sign in or create an account</p>
        </div>

        {step === 'id' ? (
          <form onSubmit={start} className="space-y-4">
            <div>
              <label className="label">Email or phone</label>
              <div className="relative">
                <AtSign size={16} className="absolute left-3.5 top-3.5 text-slate-500" />
                <input required value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@example.com  ·  +31 6 1234 5678" className="input pl-10" autoComplete="username" />
              </div>
              <p className="text-slate-500 text-xs mt-1.5">
                {identifier.trim() === '' ? 'Use your email or phone number.'
                  : idIsEmail ? 'We’ll email you a one-time code.' : 'We’ll text you a one-time code.'}
              </p>
            </div>
            <button disabled={busy} className="btn-primary w-full">
              {busy ? <Loader2 size={18} className="animate-spin" /> : <>Continue <ArrowRight size={16} /></>}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <p className="text-sm text-slate-400">
              Enter the 6-digit code sent to <span className="text-white">{identifier}</span>
            </p>
            <input inputMode="numeric" maxLength={6} required value={code} autoFocus
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••" className="input text-center text-2xl tracking-[0.5em] font-mono" />
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Trust this device — skip the code next time (60 days)
            </label>
            <button disabled={busy} className="btn-primary w-full">
              {busy ? <Loader2 size={18} className="animate-spin" /> : 'Verify & Sign in'}
            </button>
            <button type="button" onClick={() => { setStep('id'); setCode(''); }}
              className="text-sm text-slate-400 hover:text-white w-full text-center">
              Use a different email or phone
            </button>
          </form>
        )}

        {providers.length > 0 && step === 'id' && (
          <>
            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-slate-500 uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
            <div className="space-y-3">
              {providers.includes('google') && (
                <a href={`${api.base}/api/auth/oauth/google/start`} className="btn-ghost w-full">Continue with Google</a>
              )}
              {providers.includes('discord') && (
                <a href={`${api.base}/api/auth/oauth/discord/start`} className="btn w-full text-white" style={{ background: '#5865F2' }}>
                  Continue with Discord
                </a>
              )}
            </div>
          </>
        )}
        <p className="text-xs text-slate-500 text-center mt-6">
          No password needed — we use secure one-time codes.
        </p>
      </div>
    </div>
  );
}
