import { Link } from 'react-router-dom';
import {
  ShieldCheck, Zap, Clock, Star, RotateCcw, Lock, MessageCircle, BadgeCheck,
  Users, CheckCircle2, ArrowRight,
} from 'lucide-react';
import { useStats } from '../lib/useStats.js';
import { useReviews } from '../lib/useReviews.js';
import { usePageMeta } from '../lib/useMeta.js';
import LiveActivity from '../components/store/LiveActivity.jsx';

const GUARANTEES = [
  { icon: Zap, title: 'Instant, automated delivery', text: 'Most orders are delivered in seconds straight to your email and dashboard — fully automated, 24/7.' },
  { icon: Lock, title: 'Secure by design', text: 'Passwordless login, encrypted sessions with one-time-use refresh tokens, and continuous fraud screening on every order.' },
  { icon: RotateCcw, title: 'Money-back guarantee', text: "If we can't deliver your order, you get a full refund — no questions asked. Eligible orders are buyer-protected." },
  { icon: BadgeCheck, title: 'Verified reviews only', text: 'Every review is tied to a real, completed purchase and auto-published from our Discord community vouches.' },
];

const FAQ = [
  ['How fast is delivery?', 'Most digital goods are delivered automatically within seconds of your payment being confirmed. You can watch the status live on your order page.'],
  ['How do I pay?', 'Securely via Tikkie, Revolut or PayPal. You submit your transaction reference and we confirm it — usually within minutes during open hours.'],
  ['What if something goes wrong?', 'Open a ticket in our Discord or from your dashboard. Eligible orders are money-back guaranteed, so you are never at risk.'],
  ['Are the reviews real?', 'Yes. Reviews are published automatically from verified community vouches in our Discord — each tied to a real purchase.'],
];

function Stat({ icon: Icon, value, label, color }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-6 text-center fm-lift">
      <span className={`w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3 ${color}`}><Icon size={22} /></span>
      <div className="text-3xl font-extrabold text-slate-900">{value}</div>
      <div className="text-slate-500 text-sm mt-1">{label}</div>
    </div>
  );
}

export default function Trust() {
  const stats = useStats();
  const reviews = useReviews();
  usePageMeta('Trust Center — ForgeMarket', 'Delivery, review and refund statistics, security guarantees and proof you can trust ForgeMarket.');
  const avgDelivery = stats.avgDeliverySeconds < 60 ? `< ${Math.max(5, Math.round(stats.avgDeliverySeconds))}s` : `${Math.round(stats.avgDeliverySeconds / 60)}m`;

  return (
    <div className="max-w-[1100px] mx-auto px-4 lg:px-8 py-10">
      {/* Hero */}
      <div className="text-center mb-10">
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-violet-700 bg-violet-100 rounded-full px-3 py-1.5">
          <ShieldCheck size={14} /> Trust Center
        </span>
        <h1 className="text-4xl font-extrabold text-slate-900 mt-4">Why thousands buy with confidence</h1>
        <p className="text-slate-500 mt-3 max-w-xl mx-auto">Real numbers, real guarantees. Here's exactly how we keep every order safe, fast and protected.</p>
      </div>

      {/* Live stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
        <Stat icon={CheckCircle2} value={`${stats.delivered.toLocaleString('en-US')}+`} label="Orders delivered" color="text-violet-600 bg-violet-100" />
        <Stat icon={Clock} value={avgDelivery} label="Average delivery" color="text-emerald-600 bg-emerald-100" />
        <Stat icon={Star} value={`${stats.rating}/5`} label={`${stats.reviews.toLocaleString('en-US')} reviews`} color="text-amber-600 bg-amber-100" />
        <Stat icon={Users} value={stats.discordMembers.toLocaleString('en-US')} label="Discord members" color="text-blue-600 bg-blue-100" />
      </div>

      {/* Live, database-backed activity (hides itself until there's real data) */}
      <LiveActivity />

      {/* Guarantees */}
      <h2 className="text-2xl font-extrabold text-slate-900 mb-5">Our guarantees</h2>
      <div className="grid sm:grid-cols-2 gap-4 mb-12">
        {GUARANTEES.map((g) => (
          <div key={g.title} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-6 flex gap-4 fm-lift">
            <span className="w-11 h-11 rounded-xl grid place-items-center bg-violet-100 text-violet-600 shrink-0"><g.icon size={20} /></span>
            <div>
              <h3 className="font-bold text-slate-900">{g.title}</h3>
              <p className="text-slate-500 text-sm mt-1 leading-relaxed">{g.text}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Discord proof */}
      <div className="rounded-2xl p-7 mb-12 text-white shadow-lg shadow-indigo-500/20 flex flex-col sm:flex-row sm:items-center gap-5"
        style={{ backgroundImage: 'linear-gradient(150deg,#6366f1,#8b5cf6)' }}>
        <span className="w-14 h-14 rounded-2xl bg-white/15 grid place-items-center shrink-0"><MessageCircle size={26} /></span>
        <div className="flex-1">
          <h3 className="text-xl font-extrabold">{stats.discordMembers.toLocaleString('en-US')} members can vouch for us</h3>
          <p className="text-white/85 text-sm mt-1">Public reviews, proof-of-delivery and a 24/7 community. See for yourself before you buy.</p>
        </div>
        <Link to="/discord" className="inline-flex items-center justify-center gap-2 bg-white text-indigo-600 font-semibold text-sm rounded-xl h-11 px-6 hover:bg-indigo-50 transition shrink-0">
          Join Discord <ArrowRight size={16} />
        </Link>
      </div>

      {/* Recent verified reviews */}
      <h2 className="text-2xl font-extrabold text-slate-900 mb-5">Verified customer reviews</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
        {reviews.slice(0, 6).map((r) => (
          <div key={r.id} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5 fm-lift">
            <div className="flex text-amber-400 mb-2">{Array.from({ length: r.stars || 5 }).map((_, i) => <Star key={i} size={14} fill="currentColor" />)}</div>
            <p className="text-slate-600 text-sm">"{r.body}"</p>
            <div className="flex items-center gap-2 mt-3 text-xs text-slate-400">
              <BadgeCheck size={13} className="text-emerald-500" /> {r.author}{r.product ? ` · ${r.product}` : ''}
              {r.verified ? <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">· Verified buyer</span> : ' · Verified'}
            </div>
          </div>
        ))}
      </div>

      {/* FAQ */}
      <h2 className="text-2xl font-extrabold text-slate-900 mb-5">Questions, answered</h2>
      <div className="space-y-3 mb-10">
        {FAQ.map(([q, a]) => (
          <div key={q} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5">
            <h3 className="font-semibold text-slate-900">{q}</h3>
            <p className="text-slate-500 text-sm mt-1.5 leading-relaxed">{a}</p>
          </div>
        ))}
      </div>

      <div className="text-center">
        <Link to="/shop" className="inline-flex items-center gap-2 text-white font-semibold rounded-xl px-7 h-12 shadow-lg shadow-violet-500/30 hover:brightness-105 transition"
          style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
          Shop with confidence <ArrowRight size={18} />
        </Link>
      </div>
    </div>
  );
}
