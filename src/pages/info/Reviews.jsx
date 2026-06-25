import { Link } from 'react-router-dom';
import { Star, BadgeCheck } from 'lucide-react';
import InfoShell from '../../components/InfoShell.jsx';

const REVIEWS = [
  ['Liam', 'Steam Wallet', 'Code arrived in seconds. Cleanest store I’ve used — instant and legit.'],
  ['Noa', 'Discord Nitro', 'Tracked my order live and got my Nitro instantly. 10/10 service.'],
  ['Sam', 'Robux', 'Support replied in minutes when I had a question. Will buy again.'],
  ['Emma', 'V-Bucks', 'Best prices I found and the V-Bucks were on my account right away.'],
  ['Luca', 'Valorant Points', 'Paid with Tikkie, super easy, points within a minute. Recommended.'],
  ['Yara', 'PlayStation', 'Smooth checkout, instant code, and a friendly Discord community.'],
];

export default function Reviews() {
  return (
    <InfoShell eyebrow="Loved by gamers" title="Customer reviews"
      subtitle="Real feedback from real buyers. Every review is tied to a completed order." narrow={false}>
      <div className="flex flex-wrap items-center justify-center gap-6 mb-10">
        <div className="text-center">
          <div className="text-4xl font-display gradient-text">4.9/5</div>
          <div className="flex gap-0.5 justify-center text-amber-400 mt-1">{Array.from({ length: 5 }).map((_, i) => <Star key={i} size={16} fill="currentColor" />)}</div>
          <div className="text-slate-500 text-sm mt-1">Based on 2,345 reviews</div>
        </div>
        <div className="h-12 w-px bg-white/10 hidden sm:block" />
        <div className="grid grid-cols-3 gap-6 text-center">
          {[['10k+', 'Orders'], ['99.9%', 'Success'], ['< 30s', 'Avg. delivery']].map(([n, l]) => (
            <div key={l}><div className="text-2xl font-display text-white">{n}</div><div className="text-slate-500 text-xs">{l}</div></div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
        {REVIEWS.map(([name, tag, text]) => (
          <div key={name + tag} className="card p-6">
            <div className="flex gap-0.5 mb-3 text-amber-400">{Array.from({ length: 5 }).map((_, i) => <Star key={i} size={14} fill="currentColor" />)}</div>
            <p className="text-slate-200">“{text}”</p>
            <div className="flex items-center gap-3 mt-5">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center text-white text-sm font-semibold">{name[0]}</div>
              <div>
                <div className="text-white text-sm flex items-center gap-1">{name} <BadgeCheck size={13} className="text-emerald-400" /></div>
                <div className="text-slate-500 text-xs">Verified · {tag}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="text-center mt-10"><Link to="/shop" className="btn-primary px-7 py-3.5">Shop with confidence</Link></div>
    </InfoShell>
  );
}
