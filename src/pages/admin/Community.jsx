import { useEffect, useState } from 'react';
import { Trophy, Users, Flame, Target, Info } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageLoader } from '../../components/ui.jsx';

/**
 * Admin → Community.
 *
 * Levels, referral levels, badges and achievements, streaks and community
 * milestones — counted from completed, paid orders (no test payments, no
 * refunds), verified reviews, friends who really ordered and check-ins.
 * Distributions only: how many people are where, never a ranking of names
 * by spend.
 */
function Bar({ value, max }) {
  const w = max ? Math.round((value / max) * 100) : 0;
  return <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${w}%`, background: 'linear-gradient(90deg,#7c5cff,#a855f7)' }} /></div>;
}

export default function AdminCommunity() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/api/admin/community').then(setD).catch(() => setD(false)); }, []);
  if (d === null) return <PageLoader />;
  if (!d) return <div className="card p-8 text-slate-400">Could not load the community overview.</div>;

  const maxLevel = Math.max(1, ...d.levels.map((l) => l.users));
  const maxRef = Math.max(1, ...d.referralLevels.map((l) => l.users));
  const groups = [...new Set(d.achievements.map((a) => a.groupEn))];
  const stats = [
    ['Accounts', d.users, Users], ['Taking part (did something)', d.participants, Users],
    ['Avg. XP per participant', d.avgXp, Trophy], ['Active check-in streaks', d.streaks.activeDaily, Flame],
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl text-white flex items-center gap-2"><Trophy size={22} className="text-amber-300" /> Community</h1>
        <p className="text-slate-400 text-sm mt-1 max-w-3xl">
          Everything counted from real data: completed, paid orders (no test payments or refunds), verified reviews,
          friends who really ordered and check-ins. Distributions only — no ranking of customers.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map(([label, value, Icon]) => (
          <div key={label} className="card p-4">
            <div className="text-slate-400 text-[12px] flex items-center gap-1.5"><Icon size={13} /> {label}</div>
            <div className="text-2xl text-white font-bold tabular-nums mt-1">{Number(value).toLocaleString('en-GB')}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5" data-testid="admin-levels">
          <h3 className="text-white mb-3">Levels</h3>
          <div className="space-y-2">
            {d.levels.map((l) => (
              <div key={l.level} className="grid items-center gap-3 text-[13px]" style={{ gridTemplateColumns: '150px 1fr 40px' }}>
                <span className="text-slate-300 truncate">{l.level}. {l.nameEn} <span className="text-slate-500">({l.min}+)</span></span>
                <Bar value={l.users} max={maxLevel} />
                <span className="text-slate-200 text-right tabular-nums">{l.users}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <h3 className="text-white mb-3">Referral levels</h3>
          <div className="space-y-2">
            {d.referralLevels.map((l) => (
              <div key={l.id} className="grid items-center gap-3 text-[13px]" style={{ gridTemplateColumns: '150px 1fr 40px' }}>
                <span className="text-slate-300">{l.nameEn} <span className="text-slate-500">({l.min}+)</span></span>
                <Bar value={l.users} max={maxRef} />
                <span className="text-slate-200 text-right tabular-nums">{l.users}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-white/5 text-[13px] text-slate-400 space-y-1">
            <div>Longest check-in streak: <span className="text-white">{d.streaks.longestDaily} days</span></div>
            <div>Customers who ordered 2+ months in a row: <span className="text-white">{d.streaks.monthStreakers}</span></div>
          </div>
        </div>
      </div>

      <div className="card p-5" data-testid="admin-milestones">
        <h3 className="text-white flex items-center gap-2 mb-1"><Target size={17} className="text-emerald-300" /> Community milestones</h3>
        <p className="text-[12px] text-slate-500 mb-3 flex gap-1.5"><Info size={13} className="shrink-0" style={{ marginTop: 1 }} /> Visitors see a milestone only once it has really been reached.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          {d.milestones.map((m) => (
            <div key={m.id}>
              <div className="flex items-center justify-between text-[13px] mb-1">
                <span className="text-slate-300">{m.count.toLocaleString('en-GB')} {m.labelEn}</span>
                <span className="text-slate-500">{m.next ? `next: ${m.next.toLocaleString('en-GB')}` : 'all reached'}</span>
              </div>
              <Bar value={m.count} max={m.next || m.count || 1} />
              <div className="text-[11.5px] mt-1">{m.reached
                ? <span className="text-emerald-400">✓ {m.reached.toLocaleString('en-GB')} reached · public</span>
                : <span className="text-slate-500">not public yet</span>}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-white mb-3">Badges and achievements — how many people really earned them</h3>
        {groups.map((g) => (
          <div key={g} className="mb-4">
            <div className="text-[12px] uppercase tracking-wider text-slate-500 font-semibold mb-2">{g}</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {d.achievements.filter((a) => a.groupEn === g).map((a) => (
                <div key={a.id} className="rounded-lg border border-white/10 px-3 py-2 flex items-center gap-3">
                  <span className="text-xl">{a.icon}</span>
                  <div className="min-w-0 flex-1"><div className="text-[13px] text-white truncate">{a.nameEn}</div><div className="text-[11.5px] text-slate-500 truncate">{a.descEn}</div></div>
                  <span className="text-white font-semibold tabular-nums">{a.earnedBy}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="text-white mb-3">Earned in the last 7 days</h3>
          {d.recent.length === 0 ? <p className="text-slate-500 text-sm">Nothing yet this week.</p> : (
            <ul className="space-y-1.5 text-[13px]">
              {d.recent.map((r, i) => (
                <li key={i} className="flex items-center justify-between"><span className="text-slate-200">{r.icon} {r.nameEn}</span>
                  <span className="text-slate-500">{new Date(r.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-5">
          <h3 className="text-white mb-3">XP rules (as customers see them)</h3>
          <ul className="space-y-1.5 text-[13px]">
            {d.xpRules.map((r) => <li key={r.id} className="flex justify-between"><span className="text-slate-400">{r.labelEn}</span><span className="text-white">+{r.xp} XP</span></li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
