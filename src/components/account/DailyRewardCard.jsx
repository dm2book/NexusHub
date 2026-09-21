/**
 * The daily claim, on the page a returning member lands on.
 *
 * ── WHAT THE POINTS ARE ───────────────────────────────────────────────────
 * A score, deliberately — not Forge Coins. A coin buys 33–38 cents of discount,
 * so ten a day would hand over more than the margin on six orders in a week.
 * The value sits in the milestones, which the calendar bounds: day 30 comes
 * round once every thirty days, and only for somebody who turned up thirty
 * times. The card says which day is worth something so the number is not
 * mistaken for money.
 *
 * ── THE STREAK IS SHOWN AS A WEEK, NOT A NUMBER ───────────────────────────
 * "Day 5" is a fact; seven dots with five filled is a reason to come back
 * tomorrow. Both are here, because the number is what a member checks and the
 * dots are what makes the gap visible.
 */
import { useEffect, useState } from 'react';
import { Flame, Gift, Check, Sparkles, Ticket } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';

const KIND_ICON = { boost: Sparkles, coupon: Ticket };

export default function DailyRewardCard() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [trading, setTrading] = useState(false);

  const load = () => api.get('/api/account/daily').then(setD).catch(() => setD(false));
  useEffect(() => { load(); }, []);

  const copy = (code) => {
    navigator.clipboard?.writeText(code);
    toast.success(`${code} copied.`);
  };

  /* One entry per click, deliberately. A quantity box on a strip this size
     would be four more controls to explain the first time somebody reads it,
     and clicking twice costs nothing. */
  const trade = async () => {
    setTrading(true);
    try {
      const out = await api.post('/api/account/daily/redeem', { boosts: 1 });
      toast.success(`Traded ${out.pointsSpent} points for an extra giveaway entry 🎟️`);
      await load();
    } catch (e) { toast.error(e.message || 'Could not trade your points.'); }
    finally { setTrading(false); }
  };

  const claim = async () => {
    setBusy(true);
    try {
      const out = await api.post('/api/account/daily/claim', {});
      const code = out.reward?.granted?.code;
      /* A milestone that is not a code was being claimed in silence: day 7 paid
         a giveaway boost and the member was told "+70 points". */
      toast.success(code
        ? `Day ${out.streakDay} claimed — your code is ${code}`
        : out.reward
          ? `Day ${out.streakDay} claimed — +${out.points} points and ${out.reward.label} 🎉`
          : `Day ${out.streakDay} claimed — +${out.points} points 🔥`);
      await load();
    } catch (e) { toast.error(e.message || 'Could not claim today.'); }
    finally { setBusy(false); }
  };

  /* A card that failed to load says nothing rather than showing a claim button
     that cannot work. */
  if (!d) return null;

  const week = Math.max(1, Math.ceil((d.claimedToday ? d.currentStreak : d.nextClaimDay) / 7));
  const weekStart = (week - 1) * 7;
  const doneInWeek = Math.min(7, Math.max(0, d.currentStreak - weekStart));
  const MilestoneIcon = KIND_ICON[d.nextMilestone?.kind] || Gift;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10
      bg-gradient-to-br from-elevated/80 to-space-black/60 p-5 mb-6">
      <div className="orb w-64 h-64 bg-amber-500/10 -top-24 -right-16 pointer-events-none" />

      <div className="relative flex flex-col lg:flex-row lg:items-center gap-5">
        <div className="flex items-center gap-4 min-w-0">
          <span className={`w-14 h-14 rounded-2xl grid place-items-center shrink-0 transition
            ${d.currentStreak > 0
              ? 'bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/30'
              : 'bg-white/5 text-slate-500 ring-1 ring-white/10'}`}>
            <Flame size={26} />
          </span>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold">
              Daily streak
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-white tabular-nums">{d.currentStreak}</span>
              <span className="text-slate-400 text-sm">
                {d.currentStreak === 1 ? 'day' : 'days'}
                {d.longestStreak > d.currentStreak && (
                  <span className="text-slate-500"> · best {d.longestStreak}</span>
                )}
              </span>
            </div>
            {/* Stated rather than left to be worked out from two dates. */}
            {d.streakLapsed && (
              <div className="text-[12px] text-slate-500 mt-0.5">
                Your run ended — today starts a new one.
              </div>
            )}
          </div>
        </div>

        {/* Seven dots. The gap is the point. */}
        <div className="flex items-center gap-1.5 lg:mx-2" aria-hidden="true">
          {Array.from({ length: 7 }).map((_, k) => {
            const done = k < doneInWeek;
            const isToday = k === doneInWeek && !d.claimedToday;
            return (
              <span key={k}
                className={`w-7 h-7 rounded-lg grid place-items-center text-[11px] font-bold transition
                  ${done ? 'bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/30'
                    : isToday ? 'bg-white/5 text-slate-300 ring-1 ring-white/20'
                      : 'bg-white/[0.03] text-slate-600'}`}>
                {done ? <Check size={13} /> : weekStart + k + 1}
              </span>
            );
          })}
        </div>

        <div className="lg:ml-auto flex flex-wrap items-center gap-5">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Points</div>
            {/* The balance, not the lifetime total: the number next to a button
                that spends points has to be the number that gets spent. */}
            <div className="text-slate-200 font-semibold tabular-nums">
              {d.wallet ? d.wallet.balance : d.totalPoints}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">
              {d.claimedToday ? 'Tomorrow' : 'Today'}
            </div>
            <div className="text-slate-200 font-semibold">
              Day {d.nextClaimDay} · +{d.nextReward.points}
              {d.nextReward.kind && (
                <span className="text-amber-300"> + {d.nextReward.label}</span>
              )}
            </div>
          </div>

          <button onClick={claim} disabled={!d.canClaim || busy}
            className={`text-sm font-semibold rounded-xl px-5 py-2.5 transition whitespace-nowrap
              ${d.canClaim ? 'btn-primary' : 'bg-white/5 text-slate-500 cursor-not-allowed'}`}>
            {busy ? '…' : d.canClaim ? 'Claim today' : 'Claimed ✓'}
          </button>
        </div>
      </div>

      {/* What is actually worth coming back for. */}
      {d.nextMilestone && (
        <div className="relative mt-4 flex items-center gap-2.5 rounded-xl bg-space-black/40
          px-4 py-2.5 text-[13px]">
          <MilestoneIcon size={15} className="text-amber-300 shrink-0" />
          <span className="text-slate-300">
            <b className="text-slate-100">{d.nextMilestone.label}</b> on day {d.nextMilestone.day}
            <span className="text-slate-500">
              {' — '}{d.nextMilestone.daysAway} {d.nextMilestone.daysAway === 1 ? 'day' : 'days'} away
              {d.nextMilestone.kind === 'coupon' && d.nextMilestone.value
                ? ` · worth ${money(d.nextMilestone.value)}` : ''}
            </span>
          </span>
        </div>
      )}

      {/* Points buy giveaway entries, and the strip says so whether or not one is
          affordable yet — an exchange rate nobody can see is not an offer.
          It also says "one per draw", because the giveaway consumes a single
          boost per member per draw: holding four is four boosted giveaways, not
          four tickets in one. Saying "you can trade for 4" without that reads
          as a promise the draw does not keep. */}
      {d.wallet && (
        <div className="relative mt-2.5 flex flex-wrap items-center gap-3 rounded-xl
          bg-space-black/40 px-4 py-2.5 text-[13px]">
          <Ticket size={15} className="text-violet-300 shrink-0" />
          <span className="text-slate-300">
            <b className="text-slate-100">{d.wallet.perBoost} points</b> = one extra giveaway entry
            <span className="text-slate-500">
              {' — one is used per draw'}
              {d.wallet.affordable > 0
                ? `, and you can trade for ${d.wallet.affordable}`
                : `. ${d.wallet.toNextBoost} points more for your first`}
            </span>
          </span>
          {d.boosts > 0 && (
            <span className="text-[12px] text-violet-300">
              holding {d.boosts} — {d.boosts === 1 ? 'your next draw' : `your next ${d.boosts} draws`}
            </span>
          )}
          <button onClick={trade} disabled={d.wallet.affordable < 1 || trading}
            className={`ml-auto text-[12.5px] font-semibold rounded-lg px-3 py-1.5 transition
              ${d.wallet.affordable > 0
                ? 'bg-violet-500/20 text-violet-200 hover:bg-violet-500/30'
                : 'bg-white/5 text-slate-600 cursor-not-allowed'}`}>
            {trading ? '…' : 'Trade for an entry'}
          </button>
        </div>
      )}

      {/* What has already been won. A toast is not a place to keep a €5 code. */}
      {d.earned?.length > 0 && (
        <div className="relative mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 px-1 text-[12.5px]">
          <span className="text-slate-500">Won so far:</span>
          {d.earned.map((e) => (
            <span key={`${e.day}-${e.streakDay}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1 text-slate-300">
              {e.kind === 'coupon' ? <Ticket size={12} className="text-amber-300" />
                : <Sparkles size={12} className="text-amber-300" />}
              Day {e.streakDay}
              {e.code ? (
                <button onClick={() => copy(e.code)} title="Copy this code"
                  className="font-mono text-amber-300 hover:text-amber-200">{e.code}</button>
              ) : <span className="text-slate-400">giveaway boost</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
