import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Flame, Users, Sparkles, Lock, Info } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Account → Community: your level, XP, badges, achievements, referral level
 * and streaks. Every number is recomputed from your own completed orders,
 * verified reviews, friends who really ordered and your check-ins — there is
 * nothing to inflate and no ranking against other people.
 */
const fmtDate = (iso, locale) => (iso ? new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : null);
/* The server sends these names in Dutch; they are translated here by id. The
   English below is the fallback, Dutch/German/French live in the dictionaries. */
const LEVEL_EN = { 1: 'Newcomer', 2: 'Player', 3: 'Regular', 4: 'Grinder', 5: 'Veteran', 6: 'Elite', 7: 'Champion', 8: 'Master', 9: 'Grandmaster', 10: 'Legend' };
const REF_EN = { none: 'None yet', scout: 'Scout', recruiter: 'Recruiter', ambassador: 'Ambassador', legend: 'Legend' };
const XP_EN = {
  euro: 'per whole euro spent', order: 'per completed order', review: 'per verified review',
  referral: 'per friend who actually ordered', claim: 'per daily check-in', discord: 'one-time: Discord linked',
};
const GROUP_SLUG = { Bestellingen: 'orders', Community: 'community', Streaks: 'streaks', Badges: 'badges' };
const GROUP_EN = { orders: 'Orders', community: 'Community', streaks: 'Streaks', badges: 'Badges' };
const ACH_EN = {
  'first-order': ['First order', 'Your first completed order.'],
  regular: ['Regular', '5 completed orders.'],
  loyal: ['Loyal', '10 completed orders.'],
  collector: ['Collector', '25 completed orders.'],
  explorer: ['Explorer', 'Bought something in 3 different categories.'],
  'spend-100': ['€100 club', '€100 spent in total.'],
  'spend-500': ['€500 club', '€500 spent in total.'],
  'first-review': ['First review', 'Wrote a verified review.'],
  critic: ['Critic', '5 verified reviews.'],
  'first-referral': ['First friend', 'A friend who actually ordered through your link.'],
  recruiter: ['Recruiter', '3 friends who actually ordered.'],
  ambassador: ['Ambassador', '10 friends who actually ordered.'],
  'streak-7': ['Full week', 'Checked in 7 days in a row.'],
  'streak-30': ['Full month', 'Checked in 30 days in a row.'],
  'months-3': ['Three months', 'Ordered something 3 months in a row.'],
  discord: ['Discord', 'Discord linked to your account.'],
  'forge-plus': ['Forge+', 'Forge+ member (now or before).'],
  early: ['Early supporter', 'Ordered within the first 30 days after launch.'],
  'night-owl': ['Night owl', 'Ordered between midnight and 05:00.'],
};
const levelName = (t, n, server) => t(`acc.community.level.${n}`, LEVEL_EN[n] || server);
const refName = (t, id, server) => t(`acc.community.ref.${id}`, REF_EN[id] || server);
const groupName = (t, g) => (GROUP_SLUG[g] ? t(`acc.community.group.${GROUP_SLUG[g]}`, GROUP_EN[GROUP_SLUG[g]]) : g);

const prog = (p) => (p.money ? `${money(p.value, 'EUR')} / ${money(p.target, 'EUR')}` : `${p.value} / ${p.target}`);

function Award({ a }) {
  const { t, locale } = useI18n();
  const en = ACH_EN[a.id];
  const name = t(`acc.community.ach.${a.id}.name`, en ? en[0] : a.name);
  const desc = t(`acc.community.ach.${a.id}.desc`, en ? en[1] : a.desc);
  return (
    <div className={`rounded-xl border p-3 flex gap-3 ${a.earned ? 'bg-violet-500/10' : 'border-white/10'}`}
      data-testid={a.earned ? 'award-earned' : 'award-locked'}>
      <span className="text-2xl leading-none" style={a.earned ? undefined : { filter: 'grayscale(1)', opacity: 0.45 }}>{a.icon}</span>
      <div className="min-w-0">
        <div className={`text-sm font-semibold ${a.earned ? 'text-white' : 'text-slate-400'}`}>{name}</div>
        <div className="text-[12px] text-slate-500 leading-snug">{desc}</div>
        <div className="text-[11.5px] mt-1">
          {a.earned
            ? <span className="text-emerald-400">✓ {a.earnedAt ? t('acc.community.earnedOn', 'Earned on {date}', { date: fmtDate(a.earnedAt, locale) }) : t('acc.community.earned', 'Earned')}</span>
            : <span className="text-slate-500 inline-flex items-center gap-1"><Lock size={11} /> {prog(a.progress)}</span>}
        </div>
      </div>
    </div>
  );
}

export default function Community() {
  const { t, locale } = useI18n();
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/api/account/community').then(setD).catch(() => setD(false)); }, []);
  if (d === null) return <PageLoader />;
  if (!d) return <div className="card p-8 text-slate-400">{t('acc.community.loadError', 'Couldn’t load your community profile.')}</div>;

  const groups = [...new Set(d.achievements.map((a) => a.group))];
  const earnedCount = [...d.achievements, ...d.badges].filter((a) => a.earned).length;

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl text-white">{t('acc.community.title', 'Community')}</h1>

      {/* Level + XP */}
      <div className="card p-6" data-testid="community-level">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[12px] uppercase tracking-wider text-violet-300 font-semibold">{t('acc.community.levelN', 'Level {n}', { n: d.level.level })}</div>
            <div className="text-2xl text-white font-bold">{levelName(t, d.level.level, d.level.name)}</div>
          </div>
          <div className="text-right">
            <div className="text-3xl text-white font-extrabold tabular-nums">{d.xp.total.toLocaleString(locale)}</div>
            <div className="text-[12px] text-slate-400">XP</div>
          </div>
        </div>
        <div className="h-2.5 rounded-full bg-white/10 overflow-hidden mt-4">
          <div className="h-full rounded-full" style={{ width: `${d.level.progress}%`, background: 'linear-gradient(90deg,#7c5cff,#a855f7)' }} />
        </div>
        <p className="text-slate-500 text-xs mt-2">
          {d.level.next ? <>{t('acc.community.toNextLevel', '{xp} XP to go until level {n}', { xp: d.level.next.remaining, n: d.level.next.level })} · <span className="text-slate-300">{levelName(t, d.level.next.level, d.level.next.name)}</span></> : t('acc.community.maxLevel', 'Highest level reached 🎉')}
        </p>
        {/* Where every XP point came from — the whole rulebook, nothing hidden. */}
        <div className="mt-5 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {d.xp.parts.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-[13px]">
              <span className="text-slate-400">{p.count}× {t(`acc.community.xp.${p.id}`, XP_EN[p.id] || p.label)}</span>
              <span className="text-slate-200 tabular-nums">+{p.xp}</span>
            </div>
          ))}
        </div>
        <p className="text-[11.5px] text-slate-500 mt-3 flex gap-1.5"><Info size={13} className="shrink-0" style={{ marginTop: 1 }} />
          {t('acc.community.xpInfo', 'XP only comes from completed, paid orders, verified reviews, friends who actually ordered and your check-ins. Refunded orders don’t count.')}</p>
      </div>

      {/* Streaks + referral level */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="text-slate-400 text-sm flex items-center gap-2"><Flame size={16} style={{ color: '#fb923c' }} /> {t('acc.community.checkinStreak', 'Check-in streak')}</div>
          <div className="text-2xl text-white font-bold mt-1">{d.streaks.daily.current === 1 ? t('acc.community.days.one', '{n} day', { n: d.streaks.daily.current }) : t('acc.community.days.other', '{n} days', { n: d.streaks.daily.current })}</div>
          <div className="text-[12px] text-slate-500">{t('acc.community.longest', 'Longest: {n}', { n: d.streaks.daily.longest })}</div>
          <Link to="/account" className="text-[12px] text-violet-300 hover:underline mt-2 inline-block">{t('acc.community.checkinToday', 'Check in today →')}</Link>
        </div>
        <div className="card p-5">
          <div className="text-slate-400 text-sm flex items-center gap-2"><Sparkles size={16} className="text-violet-300" /> {t('acc.community.monthStreak', 'Months ordered in a row')}</div>
          <div className="text-2xl text-white font-bold mt-1">{d.streaks.months.current}</div>
          <div className="text-[12px] text-slate-500">{t('acc.community.longest', 'Longest: {n}', { n: d.streaks.months.longest })}</div>
        </div>
        <div className="card p-5" data-testid="community-referral">
          <div className="text-slate-400 text-sm flex items-center gap-2"><Users size={16} className="text-emerald-400" /> {t('acc.community.referralLevel', 'Referral level')}</div>
          <div className="text-2xl text-white font-bold mt-1">{refName(t, d.referral.id, d.referral.name)}</div>
          <div className="text-[12px] text-slate-500">
            {d.referral.count === 1
              ? t('acc.community.friendsOrdered.one', '{n} friend ordered', { n: d.referral.count })
              : t('acc.community.friendsOrdered.other', '{n} friends ordered', { n: d.referral.count })}
            {d.referral.next ? ` · ${t('acc.community.toNextRef', '{n} more until {name}', { n: d.referral.next.remaining, name: refName(t, d.referral.next.id, d.referral.next.name) })}` : ''}
          </div>
          <Link to="/account/referrals" className="text-[12px] text-violet-300 hover:underline mt-2 inline-block">{t('acc.community.yourLink', 'Your link →')}</Link>
        </div>
      </div>

      {/* Badges */}
      <div className="card p-6">
        <h3 className="text-white flex items-center gap-2 mb-4"><Trophy size={17} className="text-amber-400" /> {t('acc.community.badges', 'Badges')}</h3>
        <div className="grid sm:grid-cols-2 gap-3">{d.badges.map((a) => <Award key={a.id} a={a} />)}</div>
      </div>

      {/* Achievements */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white flex items-center gap-2"><Sparkles size={17} className="text-violet-300" /> {t('acc.community.achievements', 'Achievements')}</h3>
          <span className="text-[12px] text-slate-400">{t('acc.community.earnedCount', '{n} of {total} earned', { n: earnedCount, total: d.achievements.length + d.badges.length })}</span>
        </div>
        {groups.map((g) => (
          <div key={g} className="mb-5">
            <div className="text-[12px] uppercase tracking-wider text-slate-500 font-semibold mb-2">{groupName(t, g)}</div>
            <div className="grid sm:grid-cols-2 gap-3">{d.achievements.filter((a) => a.group === g).map((a) => <Award key={a.id} a={a} />)}</div>
          </div>
        ))}
      </div>

      {/* The levels, so the next step is never a mystery */}
      <div className="card p-6">
        <h3 className="text-white mb-3">{t('acc.community.allLevels', 'All levels')}</h3>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {d.levels.map((l) => (
            <div key={l.level} className={`rounded-lg px-3 py-2 text-center ${l.level === d.level.level ? 'bg-violet-500/20 border border-violet-500/40' : 'border border-white/10'}`}>
              <div className="text-[11px] text-slate-500">{t('acc.community.levelN', 'Level {n}', { n: l.level })}</div>
              <div className="text-[13px] text-white font-semibold">{levelName(t, l.level, l.name)}</div>
              <div className="text-[11px] text-slate-500">{l.min.toLocaleString(locale)} XP</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
