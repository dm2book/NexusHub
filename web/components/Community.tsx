import { MessageCircle, Gift, Ticket, Bell, Crown, Users } from 'lucide-react';
import Reveal from './Reveal';

const PERKS = [
  { icon: Bell, t: 'Instant drop alerts', d: 'Be first to know about restocks, sales and new packs.' },
  { icon: Gift, t: 'Exclusive giveaways', d: 'Members-only giveaways and discount codes every week.' },
  { icon: Ticket, t: 'Priority support', d: 'Open a ticket and get help from the team in minutes.' },
  { icon: Crown, t: 'Verified buyer roles', d: 'Link your account for trusted roles and perks.' },
];

export default function Community() {
  return (
    <section id="community" className="container-x py-20">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 p-8 sm:p-12"
        style={{ backgroundImage: 'linear-gradient(120deg, rgba(88,101,242,.28), rgba(168,85,247,.18))' }}>
        <div className="orb w-80 h-80 -top-28 left-10" style={{ background: 'rgba(88,101,242,.5)' }} />
        <div className="relative grid lg:grid-cols-2 gap-10 items-center">
          <Reveal>
            <span className="eyebrow">Community</span>
            <h2 className="text-3xl sm:text-5xl mt-4">Join 120,000+ gamers on Discord</h2>
            <p className="text-slate-300 mt-4 max-w-lg">
              ForgeMarket is more than a shop — it’s a community. Drops, giveaways, vouches
              and live support, all in one server. Link your account for verified roles.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-7">
              <a href="https://discord.gg/vNcfgDbVd" target="_blank" rel="noreferrer" className="btn-discord px-7 py-4 text-base"><MessageCircle size={18} /> Join the server</a>
              <span className="glass rounded-full px-4 py-2.5 text-sm text-emerald-300 flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-pulse-ring" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                </span>
                3,200 online now
              </span>
            </div>
            <div className="flex items-center gap-2 mt-6 text-slate-400 text-sm"><Users size={16} /> 120,482 members · free to join</div>
          </Reveal>

          <Reveal className="grid sm:grid-cols-2 gap-4" stagger={0.08}>
            {PERKS.map((p) => (
              <div key={p.t} className="glass rounded-2xl p-5">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center mb-3"><p.icon size={19} className="text-white" /></div>
                <h3 className="text-white text-base">{p.t}</h3>
                <p className="text-slate-300 text-sm mt-1">{p.d}</p>
              </div>
            ))}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
