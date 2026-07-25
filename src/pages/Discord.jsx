import { useEffect, useState } from 'react';
import {
  MessageCircle, Hash, Megaphone, ShoppingBag, Users, Star, Ticket,
  Crown, Shield, Wrench, Headphones, Tag, Sparkles, ArrowRight, Circle,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { SectionHeading } from '../components/ui.jsx';
import { usePageMeta } from '../lib/useMeta.js';

const CHANNELS = [
  { group: 'INFORMATION', icon: Megaphone, items: ['welcome', 'rules', 'announcements', 'faq'] },
  { group: 'SHOP', icon: ShoppingBag, items: ['products', 'robux', 'nitro', 'giftcards', 'orders'] },
  { group: 'COMMUNITY', icon: Users, items: ['general', 'gaming', 'screenshots', 'media'] },
  { group: 'REVIEWS', icon: Star, items: ['customer-reviews', 'vouches'] },
  { group: 'SUPPORT', icon: Ticket, items: ['create-ticket', 'support-chat'] },
];

const ROLES = [
  { name: 'Owner', icon: Crown, color: '#f59e0b', desc: 'Full control' },
  { name: 'Admin', icon: Shield, color: '#ef4444', desc: 'Management access' },
  { name: 'Moderator', icon: Wrench, color: '#3b82f6', desc: 'Community oversight' },
  { name: 'Support', icon: Headphones, color: '#10b981', desc: 'Ticket handling' },
  { name: 'VIP', icon: Sparkles, color: '#a855f7', desc: 'Premium perks' },
  { name: 'Customer', icon: Tag, color: '#64748b', desc: 'Verified buyer' },
];

const PERKS = [
  'Instant order notifications & drops',
  'Exclusive giveaways and discount codes',
  'Verified buyer roles linked to your account',
  'Direct support tickets with the team',
];

const STATUS_COLOR = { online: '#23a55a', idle: '#f0b232', dnd: '#f23f43', offline: '#80848e' };

export default function Discord() {
  usePageMeta('Join our Discord', 'Support, restock alerts, giveaways and community vouches.');
  const { user } = useAuth();
  const [server, setServer] = useState(null);

  useEffect(() => { api.get('/api/discord/server').then((r) => setServer(r.server)).catch(() => setServer({})); }, []);

  const invite = server?.inviteUrl || 'https://discord.gg/CrAfqENsSV';
  const JoinBtn = ({ className = '' }) => (
    invite
      ? <a href={invite} target="_blank" rel="noreferrer" className={`btn-primary ${className}`} style={{ background: 'linear-gradient(120deg,#5865F2,#a855f7)' }}><MessageCircle size={18} /> Join the server</a>
      : <span className={`btn-ghost cursor-default ${className}`} title="Invite link not configured yet"><MessageCircle size={18} /> Invite coming soon</span>
  );

  return (
    <div className="overflow-hidden">
      {/* Hero */}
      <section className="relative">
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="orb w-[480px] h-[480px] -top-32 left-1/4" style={{ background: 'rgba(88,101,242,.35)' }} />
        <div className="section relative pt-20 pb-16 text-center">
          <div className="w-20 h-20 rounded-3xl mx-auto flex items-center justify-center shadow-neon-lg mb-6"
               style={{ background: 'linear-gradient(135deg,#5865F2,#a855f7)' }}>
            <MessageCircle size={38} className="text-white" />
          </div>
          <span className="eyebrow">Community</span>
          <h1 className="text-4xl sm:text-6xl text-white mt-5">{server?.name || 'ForgeMarket Community'}</h1>
          <p className="text-slate-400 text-lg mt-4 max-w-2xl mx-auto">
            {server?.tagline || 'Drops, giveaways, support and vouches — all in one place.'}
          </p>

          {/* live stats */}
          <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
            {server?.online != null && (
              <span className="glass rounded-full px-4 py-2 text-sm text-emerald-300 flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-pulse-ring" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                </span>
                {server.online.toLocaleString()} online now
              </span>
            )}
            <span className="glass rounded-full px-4 py-2 text-sm text-slate-300">Free to join</span>
          </div>

          <div className="mt-8 flex items-center justify-center gap-4">
            <JoinBtn className="px-7 py-3.5 text-base" />
            {user && (
              <a href={`${api.base}/api/auth/oauth/discord/start`} className="btn-ghost px-7 py-3.5 text-base">Link my account</a>
            )}
          </div>

          {/* member avatars */}
          {server?.memberPreview?.length > 0 && (
            <div className="flex items-center justify-center -space-x-3 mt-10">
              {server.memberPreview.map((m, i) => (
                <img key={i} src={m.avatar} alt={m.name} title={m.name}
                  className="w-10 h-10 rounded-full border-2 border-space-black object-cover" />
              ))}
              <span className="pl-5 text-slate-500 text-sm">and many more…</span>
            </div>
          )}
        </div>
      </section>

      {/* Channels */}
      <section className="section py-14">
        <SectionHeading eyebrow="Inside the server" title="Channels for everything" center />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {CHANNELS.map(({ group, icon: Icon, items }) => (
            <div key={group} className="card p-5">
              <div className="flex items-center gap-2 text-indigo-300 font-rajdhani uppercase tracking-wider text-sm mb-3">
                <Icon size={16} /> {group}
              </div>
              <ul className="space-y-1.5">
                {items.map((c) => (
                  <li key={c} className="flex items-center gap-2 text-slate-400 text-sm hover:text-white transition">
                    <Hash size={14} className="text-slate-600" /> {c}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Roles */}
      <section className="section py-14">
        <SectionHeading eyebrow="Hierarchy" title="Roles & ranks" center />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ROLES.map(({ name, icon: Icon, color, desc }) => (
            <div key={name} className="card p-5 flex items-center gap-4 hover:border-primary/30 transition">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                   style={{ background: `${color}22`, border: `1px solid ${color}55` }}>
                <Icon size={20} style={{ color }} />
              </div>
              <div>
                <div className="font-medium" style={{ color }}>{name}</div>
                <div className="text-slate-500 text-sm">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Perks + CTA */}
      <section className="section py-14">
        <div className="grid lg:grid-cols-2 gap-6 items-stretch">
          <div className="card p-8">
            <h3 className="text-2xl text-white mb-5">Why join?</h3>
            <ul className="space-y-3">
              {PERKS.map((p) => (
                <li key={p} className="flex items-start gap-3 text-slate-300">
                  <Circle size={8} className="mt-2 text-indigo-400 fill-indigo-400 shrink-0" /> {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-white/10 p-8 flex flex-col justify-center"
               style={{ backgroundImage: 'linear-gradient(120deg, rgba(88,101,242,.3), rgba(168,85,247,.2))' }}>
            <div className="orb w-60 h-60 -top-20 right-0" style={{ background: 'rgba(88,101,242,.5)' }} />
            <div className="relative">
              <h3 className="text-3xl text-white">Ready to jump in?</h3>
              <p className="text-slate-300 mt-3">Join thousands of gamers. It’s free, and you can link your ForgeMarket account for verified roles.</p>
              <JoinBtn className="px-7 py-3.5 mt-7 inline-flex text-base" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
