/**
 * Daily login rewards, from the owner's side.
 *
 * ── WHY THE CURVE IS SHOWN, NOT JUST THE EXCEPTIONS ───────────────────────
 * Only the days an owner has actually edited exist as rows. A table of those
 * rows alone would show two lines on a fresh shop and answer none of the
 * question being asked, which is "what does thirty days of turning up cost
 * me?". So the whole month is listed, each row saying where its number came
 * from: `custom` is an owner's decision, `default` is one of the two shipped
 * milestones, `curve` is the formula. Edit any of them, clear one back.
 *
 * ── WHAT THE POINTS ARE ───────────────────────────────────────────────────
 * A score, not Forge Coins — stated on the screen because an owner about to
 * type 500 into a points box deserves to know it is not 500 coins of discount.
 * The money on this feature leaves through the milestone column, and nowhere
 * else; that column is the one to read twice.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Flame, Users, Trophy, Gift, ShieldAlert, RotateCcw, Check, X, Undo2,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { PageLoader } from '../ui.jsx';
import TimeSeriesPlot, { SERIES_COLOURS } from './TimeSeriesPlot.jsx';

const KINDS = [
  { id: '', label: 'Points only' },
  { id: 'boost', label: 'Giveaway boost' },
  { id: 'coupon', label: 'Discount code' },
];

/* What a flag means, in the owner's words rather than the constant's. A flag is
   `{ code, detail }` — the detail is the thing that was actually observed ("2
   other account(s) on this connection today"), so it is shown next to the
   label rather than dropped. An unrecognised code is shown as-is: a new signal
   should not disappear from a screen because this map was not updated. */
const FLAG_TEXT = {
  MULTI_ACCOUNT_IP: 'Many accounts on one address',
  SHARED_IP: 'Address shared with another account',
  NEW_ACCOUNT: 'New account',
  NO_ORDERS: 'Has never ordered',
};

export default function DailyRewards({ toast }) {
  const [rules, setRules] = useState(null);
  const [stats, setStats] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/api/admin/daily/rules?days=30').then((r) => setRules(r.rules || []))
      .catch((e) => { setRules([]); toast.error(e.message); });
    api.get('/api/admin/daily/stats?days=30').then(setStats)
      .catch((e) => { setStats(null); toast.error(e.message); });
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const save = async (day, body) => {
    setBusy(true);
    try {
      await api.put(`/api/admin/daily/rules/${day}`, body);
      toast.success(`Day ${day} updated.`);
      setEditing(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const clear = async (day) => {
    setBusy(true);
    try {
      await api.del(`/api/admin/daily/rules/${day}`);
      toast.success(`Day ${day} back to the built-in reward.`);
      setEditing(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  /* A reset takes a streak away from a named member, so it asks for a reason
     and the reason is what ends up in the audit row. */
  const reset = async (userId, email) => {
    const reason = window.prompt(`Reset the streak for ${email}?\n\nWhy (this is written to the audit log):`);
    if (reason == null) return;
    if (reason.trim().length < 3) { toast.error('A reason of at least 3 characters is required.'); return; }
    setBusy(true);
    try {
      await api.post(`/api/admin/daily/streak/${userId}/reset`, { reason: reason.trim() });
      toast.success('Streak reset. The claim history was kept.');
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (!rules || !stats) return <PageLoader />;

  return (
    <div className="space-y-6">
      <Stats stats={stats} />
      <ClaimsChart byDay={stats.byDay} days={stats.days} />
      <div className="grid xl:grid-cols-2 gap-5 items-start">
        <Leaderboard top={stats.top} onReset={reset} busy={busy} />
        <Flagged rows={stats.flagged} onReset={reset} busy={busy} />
      </div>
      <RuleTable rules={rules} editing={editing} setEditing={setEditing}
        onSave={save} onClear={clear} busy={busy} />
    </div>
  );
}

// ── The numbers ──────────────────────────────────────────────────────────────
function Stats({ stats }) {
  const cards = [
    { icon: Check, label: `Claims (last ${stats.days} days)`, value: stats.claims,
      sub: `${stats.members} member${stats.members === 1 ? '' : 's'}`,
      tone: 'text-emerald-300 bg-emerald-500/10' },
    { icon: Flame, label: 'Streaks running now', value: stats.activeStreaks,
      sub: stats.averageActiveStreak ? `${stats.averageActiveStreak} days on average` : 'none yet',
      tone: 'text-orange-300 bg-orange-500/10' },
    { icon: Trophy, label: 'Longest streak ever', value: `${stats.longestEver} days`,
      tone: 'text-amber-300 bg-amber-500/10' },
    { icon: Gift, label: 'Milestones handed out', value: stats.milestonesHit,
      sub: `${stats.pointsAwarded.toLocaleString()} points awarded`,
      tone: 'text-violet-300 bg-violet-500/10' },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="card p-4">
          <span className={`w-9 h-9 rounded-xl grid place-items-center mb-3 ${c.tone}`}><c.icon size={17} /></span>
          <div className="text-xl font-display text-white leading-none">{c.value}</div>
          <div className="text-slate-400 text-sm mt-1.5">{c.label}</div>
          {c.sub && <div className="text-slate-500 text-xs mt-0.5">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Claims per day ───────────────────────────────────────────────────────────
function ClaimsChart({ byDay, days }) {
  /* The plot wants an instant; a claim has a calendar day. Midday keeps the
     point inside its own day in every timezone the browser might be in. */
  const series = useMemo(() => [{
    name: 'Claims', points: (byDay || []).map((d) => ({ at: `${d.day}T12:00:00Z`, claims: d.claims })),
  }], [byDay]);

  return (
    <div className="card p-5">
      <h3 className="text-white text-sm mb-1">Claims per day</h3>
      <p className="text-slate-500 text-xs mb-3">One point per calendar day in the shop timezone, last {days} days.</p>
      <TimeSeriesPlot series={series} colours={[SERIES_COLOURS[0]]} label="Claims" zeroFloor
        value={(p) => p.claims} format={(v) => String(Math.round(v))}
        emptyNote="Not enough history to draw a line yet — it needs claims on two different days." />
    </div>
  );
}

// ── Who is actually on a streak ──────────────────────────────────────────────
function Leaderboard({ top, onReset, busy }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-white/5 flex items-center gap-2">
        <Users size={15} className="text-slate-400" />
        <h3 className="text-white text-sm">Longest streaks running</h3>
      </div>
      {top.length === 0 ? (
        <div className="p-8 text-center text-slate-400 text-sm">Nobody has claimed yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-slate-400 text-xs">
            <tr className="border-b border-white/5">
              <th className="text-left px-5 py-2 font-normal">Member</th>
              <th className="text-right px-3 py-2 font-normal">Now</th>
              <th className="text-right px-3 py-2 font-normal">Best</th>
              <th className="text-right px-3 py-2 font-normal">Points</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {top.map((m) => (
              <tr key={m.userId} className="hover:bg-white/5">
                <td className="px-5 py-2.5 text-slate-200 truncate max-w-[220px]">{m.email}</td>
                <td className="px-3 py-2.5 text-right text-orange-300">{m.currentStreak}</td>
                <td className="px-3 py-2.5 text-right text-slate-400">{m.longestStreak}</td>
                <td className="px-3 py-2.5 text-right text-slate-300">{m.totalPoints.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right">
                  <button title="Reset this streak" disabled={busy}
                    onClick={() => onReset(m.userId, m.email)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-white/10 disabled:opacity-40">
                    <RotateCcw size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Claims that noticed something ────────────────────────────────────────────
/* Which signals are about the connection rather than the account. Measured on a
   seeded month: 28 of 28 claims carried a flag and only 4 carried one of these.
   "Has never ordered" is true of most members on most days and is not a reason
   to look at anybody, so the list opens on the address signals and the rest are
   one click away rather than drowning them. */
const ADDRESS_FLAGS = ['MULTI_ACCOUNT_IP', 'SHARED_IP'];
const isAddressFlag = (r) => r.flags.some((f) => ADDRESS_FLAGS.includes(f.code));

function Flagged({ rows, onReset, busy }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.filter(isAddressFlag);

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-white/5 flex items-center gap-2">
        <ShieldAlert size={15} className="text-amber-300" />
        <h3 className="text-white text-sm flex-1">Flagged claims</h3>
        <button onClick={() => setAll((v) => !v)}
          className="text-xs text-slate-400 hover:text-white">
          {all ? 'Address signals only' : `Show all ${rows.length}`}
        </button>
      </div>
      <p className="px-5 pt-3 text-slate-500 text-xs">
        {all
          ? 'Every claim that carried any signal. Most carry "has never ordered", which is true of most members.'
          : `${shown.length} of ${rows.length} flagged claims came from an address that is running more than one account.`}
        {' '}These were paid out — a flag is a thing that was observed, not a verdict. Only a single
        address running more than three accounts is refused outright.
      </p>
      {shown.length === 0 ? (
        <div className="p-8 text-center text-slate-400 text-sm">
          {all ? 'Nothing flagged.' : 'No claim came from a shared address.'}
        </div>
      ) : (
        <div className="divide-y divide-white/5 mt-3 max-h-80 overflow-auto">
          {shown.map((r) => (
            <div key={r.id} className="px-5 py-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-slate-200 text-sm truncate">{r.email}</div>
                <div className="text-slate-500 text-xs mt-0.5">
                  {r.day} · day {r.streakDay} · +{r.points} points{r.ip ? ` · ${r.ip}` : ''}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {r.flags.map((f) => (
                    <span key={f.code || f} title={f.detail || ''}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                      {FLAG_TEXT[f.code] || f.code || String(f)}
                      {f.detail ? <span className="text-amber-300/60"> · {f.detail}</span> : null}
                    </span>
                  ))}
                </div>
              </div>
              <button title="Reset this streak" disabled={busy}
                onClick={() => onReset(r.userId, r.email)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-white/10 disabled:opacity-40 shrink-0">
                <RotateCcw size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── The curve ────────────────────────────────────────────────────────────────
/**
 * Which days are worth a row.
 *
 * Measured on a shop with nothing edited: twenty of the thirty rows read "100 ·
 * — · curve", identical to each other, and they pushed the two rows that decide
 * what this feature costs — day 7 and day 30 — a screen apart. So the flat
 * stretches collapse into one line that says what they are, and anything an
 * owner would act on stays: the first week, every day that carries a reward,
 * every day somebody has edited, and the last day of the table. The collapsed
 * line opens, so no day becomes unreachable.
 */
function interesting(rules, last) {
  return rules.filter((r) => r.day <= 7 || r.kind || r.source === 'custom' || r.day === last);
}

function RuleTable({ rules, editing, setEditing, onSave, onClear, busy }) {
  const [showAll, setShowAll] = useState(false);
  const last = rules.length ? rules[rules.length - 1].day : 0;
  const visible = showAll ? rules : interesting(rules, last);

  /* A gap line per stretch that was left out, naming the days and what they pay
     — a hidden row must still be accounted for. */
  const withGaps = [];
  let prev = 0;
  for (const r of visible) {
    if (r.day > prev + 1) {
      const gap = rules.filter((x) => x.day > prev && x.day < r.day);
      const lo = Math.min(...gap.map((x) => x.points));
      const hi = Math.max(...gap.map((x) => x.points));
      withGaps.push({ gap: true, from: prev + 1, to: r.day - 1, lo, hi, key: `g${prev}` });
    }
    withGaps.push({ rule: r, key: `d${r.day}` });
    prev = r.day;
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-white/5 flex items-start gap-3">
        <div className="flex-1">
          <h3 className="text-white text-sm">Rewards, day 1 to {last}</h3>
          <p className="text-slate-500 text-xs mt-1">
            Points are a score, not Forge Coins — they buy nothing on their own. The money
            leaves through the reward column: a boost costs nothing real, a discount code costs its value.
          </p>
        </div>
        <button onClick={() => setShowAll((v) => !v)}
          className="text-xs text-slate-400 hover:text-white shrink-0 mt-0.5">
          {showAll ? 'Collapse' : `Show all ${rules.length} days`}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-slate-400 text-xs">
            <tr className="border-b border-white/5">
              <th className="text-left px-5 py-2 font-normal">Day</th>
              <th className="text-right px-3 py-2 font-normal">Points</th>
              <th className="text-left px-3 py-2 font-normal">Reward</th>
              <th className="text-left px-3 py-2 font-normal">Source</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {withGaps.map((row) => (row.gap ? (
              <tr key={row.key} className="text-slate-500">
                <td colSpan={5} className="px-5 py-2 text-xs">
                  <button onClick={() => setShowAll(true)} className="hover:text-slate-300">
                    Days {row.from}–{row.to} · {row.lo === row.hi ? `${row.lo} points` : `${row.lo}–${row.hi} points`},
                    no extra reward — show
                  </button>
                </td>
              </tr>
            ) : (
              <RuleRow key={row.key} rule={row.rule} editing={editing} setEditing={setEditing}
                onSave={onSave} onClear={onClear} busy={busy} />
            )))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RuleRow({ rule: r, editing, setEditing, onSave, onClear, busy }) {
  if (editing === r.day) {
    return <RuleEditor rule={r} busy={busy}
      onCancel={() => setEditing(null)} onSave={onSave} onClear={onClear} />;
  }
  return (
    <tr key={r.day} className={`hover:bg-white/5 ${r.kind ? 'bg-violet-500/[0.06]' : ''}`}>
      <td className="px-5 py-2.5 text-white">{r.day}</td>
      <td className="px-3 py-2.5 text-right text-slate-300">{r.points}</td>
      <td className="px-3 py-2.5">
        {r.kind ? (
          <span className="text-violet-300">
            {r.label || (r.kind === 'coupon' ? 'Discount code' : 'Giveaway boost')}
            {/* The amount matters, but an owner who wrote it into the label
                already said it once: "€2.50 welcome code · €2.50" reads as a
                mistake. */}
            {r.kind === 'coupon' && r.value && !(r.label || '').includes(money(r.value))
              ? ` · ${money(r.value)}` : ''}
            {r.kind === 'boost' && r.value > 1 ? ` · ${r.value}×` : ''}
          </span>
        ) : <span className="text-slate-600">—</span>}
      </td>
      <td className="px-3 py-2.5">
        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
          r.source === 'custom' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
            : r.source === 'default' ? 'bg-white/5 text-slate-300 border-white/10'
              : 'bg-transparent text-slate-500 border-white/5'}`}>
          {r.source === 'custom' ? 'edited' : r.source === 'default' ? 'built-in' : 'curve'}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <button onClick={() => setEditing(r.day)} disabled={busy}
          className="text-xs text-slate-400 hover:text-white disabled:opacity-40">Edit</button>
      </td>
    </tr>
  );
}

function RuleEditor({ rule, onCancel, onSave, onClear, busy }) {
  const [points, setPoints] = useState(String(rule.points));
  const [kind, setKind] = useState(rule.kind || '');
  const [value, setValue] = useState(rule.value == null ? '' : String(rule.value));
  const [label, setLabel] = useState(rule.label || '');

  const submit = () => onSave(rule.day, {
    points: Number(points) || 0,
    kind: kind || null,
    value: kind ? Number(value) || 0 : null,
    label: label.trim() || null,
  });

  return (
    <tr className="bg-white/5">
      <td className="px-5 py-3 text-white align-top">{rule.day}</td>
      <td className="px-3 py-3 align-top">
        <input className="input !py-1.5 text-right w-24" type="number" min="0" value={points}
          onChange={(e) => setPoints(e.target.value)} />
      </td>
      <td className="px-3 py-3" colSpan={2}>
        <div className="flex flex-wrap gap-2">
          <select className="input !py-1.5 w-40" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
          {kind && (
            <input className="input !py-1.5 w-36" type="number" min="0" value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === 'coupon' ? 'value in cents' : 'how many boosts'} />
          )}
          {kind && (
            <input className="input !py-1.5 flex-1 min-w-[160px]" value={label}
              onChange={(e) => setLabel(e.target.value)} placeholder="What the member is told they won" />
          )}
        </div>
        {kind === 'coupon' && (
          <p className="text-slate-500 text-xs mt-1.5">
            {Number(value) > 0 ? `${money(Number(value))} off, every time a member reaches day ${rule.day}.`
              : 'A discount code needs a value in cents.'}
          </p>
        )}
      </td>
      <td className="px-3 py-3 text-right align-top whitespace-nowrap">
        <button onClick={submit} disabled={busy} title="Save"
          className="p-1.5 rounded-lg text-emerald-400 hover:bg-white/10 disabled:opacity-40"><Check size={15} /></button>
        {rule.source === 'custom' && (
          <button onClick={() => onClear(rule.day)} disabled={busy} title="Back to the built-in reward"
            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-white/10 disabled:opacity-40"><Undo2 size={15} /></button>
        )}
        <button onClick={onCancel} disabled={busy} title="Cancel"
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-40"><X size={15} /></button>
      </td>
    </tr>
  );
}
