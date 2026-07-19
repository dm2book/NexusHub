import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Bell, Tag } from 'lucide-react';
import InfoShell from '../../components/InfoShell.jsx';
import { api } from '../../lib/api.js';
import { useI18n } from '../../lib/i18n.jsx';

export default function Drops() {
  const { t, lang } = useI18n();
  const [drops, setDrops] = useState(null);
  const [invite, setInvite] = useState(null); // live (never-expiring) invite from the API

  useEffect(() => { api.get('/api/drops').then((r) => setDrops(r.drops || [])).catch(() => setDrops([])); }, []);
  useEffect(() => { api.get('/api/discord/server').then((r) => setInvite(r.server?.inviteUrl || null)).catch(() => {}); }, []);

  const fmt = (iso) => {
    const d = new Date(iso);
    return {
      day: d.toLocaleDateString(lang === 'nl' ? 'nl-NL' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      time: d.toLocaleTimeString(lang === 'nl' ? 'nl-NL' : 'en-GB', { hour: '2-digit', minute: '2-digit' }),
      soon: d - Date.now() < 48 * 3600_000 && d - Date.now() > -24 * 3600_000,
    };
  };

  return (
    <InfoShell eyebrow={t('drops.eyebrow', 'What’s coming')} title={t('drops.title', 'Drop calendar')}
      subtitle={t('drops.sub', 'Scheduled restocks, new products and flash sales — never miss one.')} narrow={false}>
      <div className="max-w-2xl mx-auto">
        {drops === null ? (
          <p className="text-slate-500 text-center py-10">Loading…</p>
        ) : drops.length === 0 ? (
          <div className="text-center py-12">
            <CalendarDays size={40} className="text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">{t('drops.empty', 'No drops scheduled right now — check back soon, or turn on alerts in our Discord.')}</p>
            <a href={invite || 'https://discord.gg/vNcfgDbVd'} target="_blank" rel="noreferrer"
              className="btn-primary inline-flex mt-5"><Bell size={16} /> {t('drops.notify', 'Get drop alerts on Discord')}</a>
          </div>
        ) : (
          <div className="space-y-3">
            {drops.map((d) => {
              const f = fmt(d.startsAt);
              return (
                <div key={d.id} className="card p-4 flex items-center gap-4 fm-lift">
                  <div className="text-center shrink-0 w-16">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-violet-400">{f.day}</div>
                    <div className="text-lg font-extrabold text-white">{f.time}</div>
                  </div>
                  <div className="w-px h-10 bg-white/10" />
                  <div className="min-w-0 flex-1">
                    <div className="text-white font-semibold flex items-center gap-2">
                      {d.title}
                      {f.soon && <span className="text-[10px] font-bold uppercase bg-rose-500/20 text-rose-300 rounded-full px-2 py-0.5">{t('drops.soon', 'Soon')}</span>}
                    </div>
                    {d.note && <div className="text-slate-400 text-sm mt-0.5">{d.note}</div>}
                    {d.category && <div className="inline-flex items-center gap-1 text-[11px] text-slate-500 mt-1"><Tag size={11} /> {d.category}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-center text-slate-500 text-sm mt-8">
          {t('drops.tip', 'Tip: add products to your')} <Link to="/wishlist" className="text-violet-400 hover:underline">wishlist</Link> {t('drops.tip2', 'so you’re ready when they drop.')}
        </p>
      </div>
    </InfoShell>
  );
}
