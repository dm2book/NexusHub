import { useState, useEffect, useCallback, useMemo } from 'react';
import { KeyRound, Copy } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { api } from '../../lib/api.js';
import { useI18n } from '../../lib/i18n.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * TOTP two-factor authentication card. Setup shows a QR (rendered locally —
 * the secret never leaves the API response) + a manual key; the first valid
 * code from the authenticator app activates it. Once enabled, email/phone
 * logins additionally ask for the authenticator code.
 */
export default function TwoFactor() {
  const { user } = useAuth();
  const toast = useToast();
  const { t, locale } = useI18n();
  const isStaff = (user?.roles || []).some((r) => r !== 'customer');
  const [status, setStatus] = useState(null);   // { enabled, enabledAt }
  const [setup, setSetup] = useState(null);     // { secret, otpauthUrl }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/api/auth/totp').then(setStatus).catch(() => setStatus({ enabled: false }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const qrSvg = useMemo(() => {
    if (!setup?.otpauthUrl) return '';
    const qr = qrcode(0, 'M');
    qr.addData(setup.otpauthUrl);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  }, [setup?.otpauthUrl]);

  const begin = async () => {
    setBusy(true);
    try { setSetup(await api.post('/api/auth/totp/setup')); setCode(''); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const enable = async () => {
    setBusy(true);
    try {
      await api.post('/api/auth/totp/enable', { code: code.trim() });
      toast.success(t('acc.2fa.enabledToast', 'Two-factor authentication enabled. 🔐'));
      setSetup(null); setCode(''); load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const disable = async () => {
    const c = prompt(t('acc.2fa.disablePrompt', 'Enter the current 6-digit code from your authenticator app to disable 2FA:'));
    if (!c) return;
    setBusy(true);
    try { await api.post('/api/auth/totp/disable', { code: c.trim() }); toast.success(t('acc.2fa.disabledToast', 'Two-factor authentication disabled.')); load(); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const copySecret = () => {
    navigator.clipboard?.writeText(setup.secret).then(() => toast.success(t('acc.2fa.keyCopied', 'Setup key copied.')));
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-white flex items-center gap-2">
          <KeyRound size={17} className="text-amber-300" /> {t('acc.2fa.title', 'Two-factor authentication')}
        </h3>
        {status?.enabled && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">{t('acc.2fa.enabled', 'Enabled')}</span>
        )}
      </div>
      <p className="text-slate-500 text-sm mb-4">
        {t('acc.2fa.intro', 'Protect your account with a code from an authenticator app (Google Authenticator, Authy, 1Password…).')}
        {isStaff && !status?.enabled && (
          <span className="text-amber-300"> {t('acc.2fa.staffHint', 'As a staff member, we strongly recommend enabling this.')}</span>
        )}
      </p>

      {status === null ? (
        <p className="text-slate-500 text-sm">{t('acc.2fa.loading', 'Loading…')}</p>
      ) : status.enabled ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-300">
            {t('acc.2fa.activeSince', 'Logins require an authenticator code since {date}.', { date: status.enabledAt ? new Date(status.enabledAt).toLocaleString(locale) : '—' })}
          </p>
          <button onClick={disable} disabled={busy} className="btn-ghost text-xs text-red-300 hover:bg-red-500/10">{t('acc.2fa.disable', 'Disable')}</button>
        </div>
      ) : !setup ? (
        <button onClick={begin} disabled={busy} className="btn-primary">{t('acc.2fa.setup', 'Set up 2FA')}</button>
      ) : (
        <div className="space-y-4">
          <ol className="text-sm text-slate-300 list-decimal ml-4 space-y-1">
            <li>{t('acc.2fa.step1', 'Scan this QR code with your authenticator app (or enter the key manually).')}</li>
            <li>{t('acc.2fa.step2', 'Enter the 6-digit code the app shows to confirm.')}</li>
          </ol>
          <div className="flex flex-col sm:flex-row items-center gap-5">
            <div className="bg-white rounded-xl p-2 w-40 h-40 shrink-0"
              dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <div className="min-w-0 w-full">
              <div className="label">{t('acc.2fa.manualKey', 'Manual setup key')}</div>
              <div className="flex items-center gap-2">
                <code className="text-xs text-indigo-200 bg-space-black rounded-lg px-3 py-2 break-all flex-1">{setup.secret}</code>
                <button onClick={copySecret} className="p-2 text-slate-400 hover:text-white" title={t('acc.2fa.copy', 'Copy')}><Copy size={15} /></button>
              </div>
              <a href={setup.otpauthUrl} className="text-xs text-indigo-400 hover:text-indigo-300 mt-2 inline-block">
                {t('acc.2fa.openApp', 'On mobile? Tap to open your authenticator app →')}
              </a>
              <div className="flex gap-2 mt-3">
                <input className="input py-2 w-36 text-center font-mono tracking-widest" placeholder="123456"
                  inputMode="numeric" maxLength={6} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                <button onClick={enable} disabled={busy || code.length !== 6} className="btn-primary">{t('acc.2fa.confirm', 'Confirm')}</button>
                <button onClick={() => setSetup(null)} className="btn-ghost">{t('acc.2fa.cancel', 'Cancel')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
