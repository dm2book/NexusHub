import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Zap, Mail, ArrowRight, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function Login() {
  const { login, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const dest = location.state?.from || '/account';

  const [providers, setProviders] = useState([]);
  const [step, setStep] = useState('email'); // email | code
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) navigate(dest, { replace: true }); }, [user]);
  useEffect(() => {
    api.get('/api/auth/providers').then((r) => setProviders(r.providers)).catch(() => {});
  }, []);

  const requestCode = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/auth/otp/request', { email });
      setStep('code');
      toast.success('We emailed you a login code.');
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const verifyCode = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const ref = localStorage.getItem('fm_ref') || undefined;
      const { accessToken } = await api.post('/api/auth/otp/verify', { email, code, ref });
      localStorage.removeItem('fm_ref');
      await login(accessToken);
      navigate(dest, { replace: true });
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

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

        {step === 'email' ? (
          <form onSubmit={requestCode} className="space-y-4">
            <div>
              <label className="label">Email address</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-3.5 text-slate-500" />
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com" className="input pl-10" />
              </div>
            </div>
            <button disabled={busy} className="btn-primary w-full">
              {busy ? <Loader2 size={18} className="animate-spin" /> : <>Continue <ArrowRight size={16} /></>}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="space-y-4">
            <p className="text-sm text-slate-400">
              Enter the 6-digit code sent to <span className="text-white">{email}</span>
            </p>
            <input inputMode="numeric" maxLength={6} required value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••" className="input text-center text-2xl tracking-[0.5em] font-mono" />
            <button disabled={busy} className="btn-primary w-full">
              {busy ? <Loader2 size={18} className="animate-spin" /> : 'Verify & Sign in'}
            </button>
            <button type="button" onClick={() => setStep('email')}
              className="text-sm text-slate-400 hover:text-white w-full text-center">
              Use a different email
            </button>
          </form>
        )}

        {providers.length > 0 && step === 'email' && (
          <>
            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-slate-500 uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
            <div className="space-y-3">
              {providers.includes('google') && (
                <a href={`${api.base}/api/auth/oauth/google/start`} className="btn-ghost w-full">
                  Continue with Google
                </a>
              )}
              {providers.includes('discord') && (
                <a href={`${api.base}/api/auth/oauth/discord/start`}
                   className="btn w-full text-white" style={{ background: '#5865F2' }}>
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
