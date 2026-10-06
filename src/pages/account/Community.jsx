import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Flame, Users, Sparkles, Lock, Info } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';

/**
 * Account → Community: your level, XP, badges, achievements, referral level
 * and streaks. Every number is recomputed from your own completed orders,
 * verified reviews, friends who really ordered and your check-ins — there is
 * nothing to inflate and no ranking against other people.
 */
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : null);
const prog = (p) => (p.money ? `${money(p.value, 'EUR')} / ${money(p.target, 'EUR')}` : `${p.value} / ${p.target}`);

function Award({ a }) {
  return (
    <div className={`rounded-xl border p-3 flex gap-3 ${a.earned ? 'border-violet-400/40 bg-violet-500/10' : 'border-white/10 bg-white/[.03]'}`}
      data-testid={a.earned ? 'award-earned' : 'award-locked'}>
      <span className="text-2xl leading-none" style={a.earned ? undefined : { filter: 'grayscale(1)', opacity: 0.45 }}>{a.icon}</span>
      <div className="min-w-0">
        <div className={`text-sm font-semibold ${a.earned ? 'text-white' : 'text-slate-400'}`}>{a.name}</div>
        <div className="text-[12px] text-slate-500 leading-snug">{a.desc}</div>
        <div className="text-[11.5px] mt-1">
          {a.earned
            ? <span className="text-emerald-400">✓ Behaald{a.earnedAt ? ` op ${fmtDate(a.earnedAt)}` : ''}</span>
            : <span className="text-slate-500 inline-flex items-center gap-1"><Lock size={11} /> {prog(a.progress)}</span>}
        </div>
      </div>
    </div>
  );
}

export default function Community() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/api/account/community').then(setD).catch(() => setD(false)); }, []);
  if (d === null) return <PageLoader />;
  if (!d) return <div className="card p-8 text-slate-400">Kon je community-profiel niet laden.</div>;

  const groups = [...new Set(d.achievements.map((a) => a.group))];
  const earnedCount = [...d.achievements, ...d.badges].filter((a) => a.earned).length;

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl text-white">Community</h1>

      {/* Level + XP */}
      <div className="card p-6" data-testid="community-level">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[12px] uppercase tracking-wider text-violet-300 font-semibold">Level {d.level.level}</div>
            <div className="text-2xl text-white font-bold">{d.level.name}</div>
          </div>
          <div className="text-right">
            <div className="text-3xl text-white font-extrabold tabular-nums">{d.xp.total.toLocaleString('nl-NL')}</div>
            <div className="text-[12px] text-slate-400">XP</div>
          </div>
        </div>
        <div className="h-2.5 rounded-full bg-white/10 overflow-hidden mt-4">
          <div className="h-full rounded-full" style={{ width: `${d.level.progress}%`, background: 'linear-gradient(90deg,#7c5cff,#a855f7)' }} />
        </div>
        <p className="text-slate-500 text-xs mt-2">
          {d.level.next ? <>Nog {d.level.next.remaining} XP tot level {d.level.next.level} · <span className="text-slate-300">{d.level.next.name}</span></> : 'Hoogste level bereikt 🎉'}
        </p>
        {/* Where every XP point came from — the whole rulebook, nothing hidden. */}
        <div className="mt-5 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {d.xp.parts.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-[13px]">
              <span className="text-slate-400">{p.count}× {p.label}</span>
              <span className="text-slate-200 tabular-nums">+{p.xp}</span>
            </div>
          ))}
        </div>
        <p className="text-[11.5px] text-slate-500 mt-3 flex gap-1.5"><Info size={13} className="shrink-0 mt-px" />
          XP komt alleen uit afgeronde, betaalde bestellingen, geverifieerde reviews, vrienden die echt bestelden en je check-ins. Terugbetaalde bestellingen tellen niet mee.</p>
      </div>

      {/* Streaks + referral level */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="text-slate-400 text-sm flex items-center gap-2"><Flame size={16} className="text-orange-400" /> Check-in streak</div>
          <div className="text-2xl text-white font-bold mt-1">{d.streaks.daily.current} {d.streaks.daily.current === 1 ? 'dag' : 'dagen'}</div>
          <div className="text-[12px] text-slate-500">Langste: {d.streaks.daily.longest}</div>
          <Link to="/account" className="text-[12px] text-violet-300 hover:underline mt-2 inline-block">Vandaag inchecken →</Link>
        </div>
        <div className="card p-5">
          <div className="text-slate-400 text-sm flex items-center gap-2"><Sparkles size={16} className="text-violet-300" /> Maanden op rij besteld</div>
          <div className="text-2xl text-white font-bold mt-1">{d.streaks.months.current}</div>
          <div className="text-[12px] text-slate-500">Langste: {d.streaks.months.longest}</div>
        </div>
        <div className="card p-5" data-testid="community-referral">
          <div className="text-slate-400 text-sm flex items-center gap-2"><Users size={16} className="text-emerald-400" /> Referral-level</div>
          <div className="text-2xl text-white font-bold mt-1">{d.referral.name}</div>
          <div className="text-[12px] text-slate-500">
            {d.referral.count} {d.referral.count === 1 ? 'vriend bestelde' : 'vrienden bestelden'}
            {d.referral.next ? ` · nog ${d.referral.next.remaining} tot ${d.referral.next.name}` : ''}
          </div>
          <Link to="/account/referrals" className="text-[12px] text-violet-300 hover:underline mt-2 inline-block">Jouw link →</Link>
        </div>
      </div>

      {/* Badges */}
      <div className="card p-6">
        <h3 className="text-white flex items-center gap-2 mb-4"><Trophy size={17} className="text-amber-400" /> Badges</h3>
        <div className="grid sm:grid-cols-2 gap-3">{d.badges.map((a) => <Award key={a.id} a={a} />)}</div>
      </div>

      {/* Achievements */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white flex items-center gap-2"><Sparkles size={17} className="text-violet-300" /> Achievements</h3>
          <span className="text-[12px] text-slate-400">{earnedCount} van {d.achievements.length + d.badges.length} behaald</span>
        </div>
        {groups.map((g) => (
          <div key={g} className="mb-5 last:mb-0">
            <div className="text-[12px] uppercase tracking-wider text-slate-500 font-semibold mb-2">{g}</div>
            <div className="grid sm:grid-cols-2 gap-3">{d.achievements.filter((a) => a.group === g).map((a) => <Award key={a.id} a={a} />)}</div>
          </div>
        ))}
      </div>

      {/* The levels, so the next step is never a mystery */}
      <div className="card p-6">
        <h3 className="text-white mb-3">Alle levels</h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {d.levels.map((l) => (
            <div key={l.level} className={`rounded-lg px-3 py-2 text-center ${l.level === d.level.level ? 'bg-violet-500/20 border border-violet-400/40' : 'bg-white/[.03] border border-white/10'}`}>
              <div className="text-[11px] text-slate-500">Level {l.level}</div>
              <div className="text-[13px] text-white font-semibold">{l.name}</div>
              <div className="text-[11px] text-slate-500">{l.min.toLocaleString('nl-NL')} XP</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
