import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Link2, Unlink, RefreshCw, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useI18n } from '../../lib/i18n.jsx';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * Connect a Discord account, and see what it gets you.
 *
 * The roles are listed from OUR records rather than from Discord, deliberately.
 * They are what the account has earned, which stays true whether or not the bot
 * is reachable and whether or not the person has joined the server yet — and the
 * card says plainly when a role is earned but not yet applied, instead of
 * showing an empty list that looks like a bug.
 */
const ROLE_HINT = {
  customer: 'Every paid order',
  vip: 'Lifetime spend above the VIP threshold',
  review: 'Leaving a review, here or with /vouch',
};

export default function DiscordCard() {
  const { t } = useI18n();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState('');

  const load = () => api.get('/api/account/discord').then(setState).catch(() => setState({ linked: false }));
  useEffect(() => { load(); }, []);

  // The OAuth redirect comes back with the outcome in the URL. Read it once,
  // then strip it, so a refresh does not re-announce a connection.
  useEffect(() => {
    const outcome = params.get('discord');
    if (!outcome) return;
    if (outcome === 'linked') toast.success(t('discord.linked', 'Discord connected. Your roles are on the way.'));
    else toast.error(params.get('reason') || t('discord.linkFailed', 'Could not connect Discord.'));
    params.delete('discord'); params.delete('reason');
    setParams(params, { replace: true });
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = () => {
    // A full-page redirect, not fetch: this is an OAuth consent flow.
    window.location.href = `${api.base}/api/auth/oauth/discord/link/start`;
  };

  const disconnect = async () => {
    if (!window.confirm(t('discord.unlinkConfirm',
      'Disconnect Discord? Your roles in the server are removed with it.'))) return;
    setBusy('unlink');
    try {
      const r = await api.del('/api/account/discord');
      toast.success(r.rolesRemoved?.length
        ? t('discord.unlinkedRoles', 'Disconnected. {n} role(s) removed.', { n: r.rolesRemoved.length })
        : t('discord.unlinked', 'Disconnected.'));
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(''); }
  };

  const resync = async () => {
    setBusy('sync');
    try {
      const r = await api.post('/api/account/discord/sync', {});
      if (r.added?.length) toast.success(t('discord.synced', 'Updated: {roles}', { roles: r.added.join(', ') }));
      else if (r.note) toast.info(r.note);
      else toast.success(t('discord.upToDate', 'Already up to date.'));
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(''); }
  };

  if (!state) {
    return <div className="card p-6 flex items-center gap-2 text-slate-400"><Loader2 size={16} className="animate-spin" /> …</div>;
  }
  if (!state.available) return null; // Discord OAuth is not configured on this deploy

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-11 h-11 rounded-xl grid place-items-center shrink-0" style={{ background: '#5865F2' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="white" aria-hidden>
              <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.24.5c1.6.38 2.93 1.05 4.17 1.94A16.6 16.6 0 0 0 12 4.1c-2.6 0-4.9.5-7.33 1.34 1.24-.9 2.57-1.56 4.17-1.94L8.6 3a19.8 19.8 0 0 0-4.9 1.4C1.2 8.1.5 11.7.85 15.24A19.9 19.9 0 0 0 6.9 18.3l.78-1.1c-1.05-.4-2-.9-2.86-1.55l.7-.52a14.2 14.2 0 0 0 12.96 0l.7.52c-.86.65-1.8 1.16-2.86 1.55l.78 1.1a19.9 19.9 0 0 0 6.05-3.06c.42-4.1-.7-7.67-2.85-10.84ZM8.4 13.4c-1.16 0-2.11-1.06-2.11-2.36 0-1.3.93-2.36 2.11-2.36 1.19 0 2.14 1.07 2.12 2.36 0 1.3-.93 2.36-2.12 2.36Zm7.2 0c-1.16 0-2.11-1.06-2.11-2.36 0-1.3.93-2.36 2.11-2.36 1.19 0 2.14 1.07 2.12 2.36 0 1.3-.93 2.36-2.12 2.36Z" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="text-white font-medium">Discord</div>
            {state.linked ? (
              <div className="text-slate-400 text-sm truncate">
                {t('discord.connectedTo', 'Connected as')} <span className="text-slate-200">{state.displayName || state.uid}</span>
              </div>
            ) : (
              <div className="text-slate-400 text-sm">
                {t('discord.notConnected', 'Not connected — link it to get your roles in the server.')}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          {state.linked ? (
            <>
              <button onClick={resync} disabled={!!busy} className="btn-ghost text-sm min-h-[44px]">
                {busy === 'sync' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                {t('discord.resync', 'Refresh roles')}
              </button>
              <button onClick={disconnect} disabled={!!busy} className="btn-ghost text-sm min-h-[44px] hover:text-red-300">
                <Unlink size={15} /> {t('discord.disconnect', 'Disconnect')}
              </button>
            </>
          ) : (
            <button onClick={connect} className="btn-primary text-sm min-h-[44px]">
              <Link2 size={15} /> {t('discord.connect', 'Connect Discord')}
            </button>
          )}
        </div>
      </div>

      {/* What the account has earned. Shown whether or not it is connected —
          before linking it is the reason TO link, after it is confirmation. */}
      <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-slate-300 text-sm font-medium mb-2">
          {t('discord.yourRoles', 'Your roles')}
        </div>
        {state.roles?.length ? (
          <>
            <div className="flex flex-wrap gap-2">
              {state.roles.map((r) => (
                <span key={r} className="text-xs px-2.5 py-1 rounded-lg bg-indigo-500/15 text-indigo-200 border border-indigo-400/25">
                  {r}
                </span>
              ))}
            </div>
            {state.reasons?.length > 0 && (
              <ul className="mt-2.5 space-y-0.5">
                {state.reasons.map((why) => (
                  <li key={why} className="text-slate-500 text-xs flex items-center gap-1.5">
                    <CheckCircle2 size={11} className="text-emerald-400 shrink-0" /> {why}
                  </li>
                ))}
              </ul>
            )}
            {!state.linked && (
              <p className="text-amber-300/90 text-xs mt-3 flex items-start gap-1.5">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                {t('discord.earnedNotApplied',
                  'You have earned these already — connect Discord and join the server to receive them.')}
              </p>
            )}
          </>
        ) : (
          <p className="text-slate-500 text-sm">
            {t('discord.noRolesYet', 'None yet. Your first order earns the customer role, and a review earns another.')}
          </p>
        )}

        <ul className="mt-3 pt-3 border-t border-white/5 space-y-1">
          {Object.entries(ROLE_HINT).map(([k, hint]) => (
            <li key={k} className="text-slate-500 text-xs">
              · {t(`discord.hint.${k}`, hint)}
            </li>
          ))}
        </ul>
      </div>

      {state.linked && state.inviteUrl && (
        <a href={state.inviteUrl} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 mt-4 text-sm text-indigo-300 hover:underline">
          <ExternalLink size={14} /> {t('discord.openServer', 'Open {name}', { name: state.serverName || 'the server' })}
        </a>
      )}
    </div>
  );
}
