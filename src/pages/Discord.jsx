import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import {
  MessageCircle, Hash, Megaphone, ShoppingBag, Users, Star, Ticket,
  Crown, Shield, Wrench, Headphones, Tag, Sparkles, ArrowRight, Circle,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { SectionHeading } from '../components/ui.jsx';
import { usePageMeta } from '../lib/useMeta.js';

/**
 * The channels this page promises. Every name here must exist in
 * `discord/src/config.js` — that file is what the bot actually creates, and it
 * is the source of truth.
 *
 * This list had drifted badly in both directions. It advertised #robux, #nitro,
 * #giftcards, #orders, #gaming, #screenshots, #customer-reviews, #create-ticket
 * and #support-chat, none of which the bot builds — so the one page whose job is
 * to turn a visitor into a member described a different server, and the first
 * thing a new arrival did was fail to find the channel they came for.
 *
 * It also left out the channels that sell the place hardest: #proof-of-delivery,
 * #restocks, #deals, #price-list and #ask-the-bot. server/test/discord-page.test.mjs
 * now fails if either half drifts again.
 */
const CHANNELS = [
  { group: 'INFORMATION', icon: Megaphone, items: ['welcome', 'start-here', 'rules', 'links'] },
  { group: 'ANNOUNCEMENTS', icon: Megaphone, items: ['announcements', 'restocks', 'status'] },
  { group: 'MARKETPLACE', icon: ShoppingBag, items: ['products', 'price-list', 'how-to-buy', 'deals', 'ask-the-bot'] },
  { group: 'REVIEWS & TRUST', icon: Star, items: ['reviews', 'vouches', 'proof-of-delivery', 'discount-codes'] },
  { group: 'SUPPORT', icon: Ticket, items: ['open-a-ticket', 'faq', 'support-info', 'report-a-scam'] },
  { group: 'COMMUNITY', icon: Users, items: ['general', 'media', 'suggestions', 'starboard', 'giveaways'] },
];

const roles = (t) => [
  { name: 'Owner', icon: Crown, color: '#f59e0b', desc: t('discord.rOwner', 'Full control') },
  { name: 'Admin', icon: Shield, color: '#ef4444', desc: t('discord.rAdmin', 'Management access') },
  { name: 'Moderator', icon: Wrench, color: '#3b82f6', desc: t('discord.rMod', 'Keeps the server in order') },
  { name: 'Support', icon: Headphones, color: '#10b981', desc: t('discord.rSupport', 'Handles your tickets') },
  { name: 'VIP', icon: Sparkles, color: '#a855f7', desc: t('discord.rVip', 'Perks for regulars') },
  { name: 'Customer', icon: Tag, color: '#64748b', desc: t('discord.rCustomer', 'Verified buyer') },
];

const perks = (t) => [
  // Was "Instant order notifications" — the notification is instant, the
  // delivery is not, and the two read as the same promise.
  t('discord.p1', 'Order updates and restock alerts'),
  t('discord.p2', 'Exclusive giveaways and discount codes'),
  t('discord.p3', 'Verified buyer roles linked to your account'),
  t('discord.p4', 'Direct support tickets with the team'),
];

const STATUS_COLOR = { online: '#23a55a', idle: '#f0b232', dnd: '#f23f43', offline: '#80848e' };

export default function Discord() {
  const { t } = useI18n();
  usePageMeta('ForgeMarket Support on Discord', 'Get help with an order, follow restocks and giveaways, and read buyer vouches.');
  const { user } = useAuth();
  const [server, setServer] = useState(null);
  // Offering "link my account" when Discord login isn't configured sends the
  // buyer straight into a failed redirect. Only show it when the server says
  // the provider is actually live.
  const [canLink, setCanLink] = useState(false);

  useEffect(() => { api.get('/api/discord/server').then((r) => setServer(r.server)).catch(() => setServer({})); }, []);
  useEffect(() => {
    api.get('/api/auth/providers')
      .then((r) => setCanLink((r.providers || []).includes('discord')))
      .catch(() => setCanLink(false));
  }, []);

  const invite = server?.inviteUrl || 'https://discord.gg/CrAfqENsSV';
  const JoinBtn = ({ className = '' }) => (
    invite
      ? <a href={invite} target="_blank" rel="noreferrer" className={`btn-primary ${className}`} style={{ background: 'linear-gradient(120deg,#5865F2,#a855f7)' }}><MessageCircle size={18} /> {t('discord.join', 'Join ForgeMarket Support')}</a>
      : <span className={`btn-ghost cursor-default ${className}`} title="Invite link not configured yet"><MessageCircle size={18} /> {t('discord.soon', 'Invite coming soon')}</span>
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
          <span className="eyebrow">{t('discord.eyebrow', 'Support')}</span>
          <h1 className="text-4xl sm:text-6xl text-white mt-5">{server?.name || 'ForgeMarket Support'}</h1>
          <p className="text-slate-400 text-lg mt-4 max-w-2xl mx-auto">
            {server?.tagline || t('discord.tagline', 'Order help, delivery updates, drops and giveaways — all in one place.')}
          </p>

          {/* live stats */}
          <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
            {server?.online != null && (
              <span className="glass rounded-full px-4 py-2 text-sm text-emerald-300 flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-pulse-ring" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                </span>
                {server.online.toLocaleString()} {t('discord.onlineNow', 'online now')}
              </span>
            )}
            <span className="glass rounded-full px-4 py-2 text-sm text-slate-300">{t('discord.free', 'Free to join')}</span>
          </div>

          <div className="mt-8 flex items-center justify-center gap-4">
            <JoinBtn className="px-7 py-3.5 text-base" />
            {user && canLink && (
              <a href={`${api.base}/api/auth/oauth/discord/start`} className="btn-ghost px-7 py-3.5 text-base">
                {t('discord.link', 'Link my account')}
              </a>
            )}
          </div>

          {/* member avatars */}
          {server?.memberPreview?.length > 0 && (
            <div className="flex items-center justify-center -space-x-3 mt-10">
              {server.memberPreview.map((m, i) => (
                <img key={i} src={m.avatar} alt={m.name} title={m.name}
                  className="w-10 h-10 rounded-full border-2 border-space-black object-cover" />
              ))}
              <span className="pl-5 text-slate-500 text-sm">{t('discord.andMore', 'and many more…')}</span>
            </div>
          )}
        </div>
      </section>

      {/* Channels */}
      <section className="section py-14">
        <SectionHeading eyebrow={t('discord.inside', 'Inside the server')} title={t('discord.channels', 'A channel for everything')} center />
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
        <SectionHeading eyebrow={t('discord.hierarchy', 'Who’s who')} title={t('discord.rolesTitle', 'Roles & ranks')} center />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* The role colour lives in the swatch, not in the words.
              These are Discord's own role colours, and they are chosen to sit on
              Discord's dark chrome. Painted onto the white card this page uses in
              light mode they measured 2.15:1 (Owner) to 3.96:1 (VIP) against a
              4.5:1 floor — the role names were the least readable text on the
              page. The swatch is decoration and carries no contrast requirement;
              the name it labels is written out beside it, so nothing is conveyed
              by colour alone. */}
          {roles(t).map(({ name, icon: Icon, color, desc }) => (
            <div key={name} className="card p-5 flex items-center gap-4 hover:border-primary/30 transition">
              <div aria-hidden className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                   style={{ background: color, boxShadow: `0 6px 18px -8px ${color}` }}>
                {/* Inline, not `text-white`: the light theme remaps that class to
                    slate-900 for the whole scope, which turned these into dark
                    glyphs on a saturated tile. */}
                <Icon size={20} style={{ color: '#fff' }} strokeWidth={2.4} />
              </div>
              <div>
                <div className="font-medium text-white">{name}</div>
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
            <h3 className="text-2xl text-white mb-5">{t('discord.why', 'Why join?')}</h3>
            <ul className="space-y-3">
              {perks(t).map((p) => (
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
              <h3 className="text-3xl text-white">{t('discord.ready', 'Need a hand?')}</h3>
              <p className="text-slate-300 mt-3">{canLink
                ? t('discord.joinSub', 'Free to join, and you can link your ForgeMarket account for verified roles.')
                : t('discord.joinSubPlain', 'Free to join — ask a question, catch a drop, or leave a vouch after your order.')}</p>
              <JoinBtn className="px-7 py-3.5 mt-7 inline-flex text-base" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
