import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Zap, ShieldCheck, Headphones, RefreshCw, ArrowRight, Star,
  MessageCircle, Wallet, PackageCheck, Sparkles, ChevronDown,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useCart } from '../context/CartContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { categoryVisual } from '../lib/catalog.js';
import { withFallback } from '../lib/sampleCatalog.js';
import ProductCard from '../components/ProductCard.jsx';
import { SectionHeading, Skeleton } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';
import { usePageMeta } from '../lib/useMeta.js';

const FEATURES = [
  { icon: Zap, title: 'Instant Delivery', text: 'Automated fulfillment delivers your codes in seconds, 24/7.' },
  { icon: ShieldCheck, title: 'Secure & Trusted', text: 'Fraud screening, encrypted sessions and audited operations.' },
  { icon: RefreshCw, title: 'Multi-Supplier', text: 'Resilient sourcing across API, CSV and manual suppliers.' },
  { icon: Headphones, title: '24/7 Support', text: 'Open a ticket and track resolution from your dashboard.' },
];

const STEPS = [
  { icon: Wallet, title: 'Pick your item', text: 'Browse game currency, gift cards and subscriptions.' },
  { icon: ShieldCheck, title: 'Checkout securely', text: 'Pay safely — every order is fraud-screened.' },
  { icon: PackageCheck, title: 'Get it instantly', text: 'Codes appear in your dashboard, ready to use.' },
];

const STATS = [
  { value: '50k+', label: 'Orders delivered' },
  { value: '< 30s', label: 'Avg. delivery' },
  { value: '4.9/5', label: 'Customer rating' },
  { value: '24/7', label: 'Live support' },
];

const REVIEWS = [
  { name: 'Liam', text: 'Code arrived in seconds. Cleanest store I’ve used.', tag: 'Steam Wallet' },
  { name: 'Noa', text: 'Tracked my order live and got instant Nitro. 10/10.', tag: 'Discord Nitro' },
  { name: 'Sam', text: 'Support replied in minutes. Will buy again.', tag: 'Gift Card' },
];

const FAQS = [
  ['How fast is delivery?', 'Most digital goods are delivered automatically within seconds of payment. You can watch the status update live on your order page.'],
  ['Is it safe?', 'Yes — we use passwordless sign-in, encrypted sessions, automated fraud screening and full audit logging.'],
  ['What if something goes wrong?', 'Open a support ticket or request a refund right from your dashboard. Our team is available 24/7.'],
  ['Do I need an account?', 'You can track orders by number without one, but an account unlocks your dashboard, downloads and order history.'],
];

export default function Home() {
  const { add } = useCart();
  const toast = useToast();
  const [products, setProducts] = useState(null);
  usePageMeta('Digital goods, delivered instantly',
    'Buy Robux, V-Bucks, game currency, gift cards and subscriptions — instant, automated delivery with secure payments.');

  useEffect(() => {
    api.get('/api/products')
      .then((r) => setProducts(withFallback(r.products)))
      .catch(() => setProducts(withFallback([])));
  }, []);

  const popular = (products || []).filter((p) => p.featured).concat((products || []).filter((p) => !p.featured)).slice(0, 8);
  const categories = [...new Set((products || []).map((p) => p.category).filter(Boolean))];

  const onAdd = (p) => { add(p); toast.success(`${p.name} added to cart`); };

  return (
    <div className="overflow-hidden">
      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="relative">
        <div className="absolute inset-0 bg-grid opacity-40" />
        <div className="orb w-[520px] h-[520px] bg-primary/30 -top-40 -left-20 animate-float-slow" />
        <div className="orb w-[480px] h-[480px] bg-accent-purple/25 top-10 right-0 animate-float" />
        <div className="section relative pt-24 pb-24 text-center">
          <span className="eyebrow animate-fade-in">⚡ Digital goods · delivered instantly</span>
          <h1 className="text-4xl sm:text-6xl lg:text-7xl text-white mt-6 leading-[1.05] animate-fade-up">
            Your marketplace for<br />
            <span className="gradient-text">digital goods</span>
          </h1>
          <p className="text-slate-400 text-lg sm:text-xl mt-6 max-w-2xl mx-auto animate-fade-up">
            Game currency, gift cards, subscriptions and more — automatically fulfilled,
            tracked in real time, backed by a full account dashboard.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 mt-10 animate-fade-up">
            <Link to="/shop" className="btn-primary px-7 py-3.5 text-base">Browse Shop <ArrowRight size={18} /></Link>
            <Link to="/discord" className="btn-ghost px-7 py-3.5 text-base"><MessageCircle size={18} /> Join Discord</Link>
          </div>

          {/* stats strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-16 max-w-3xl mx-auto">
            {STATS.map((s) => (
              <div key={s.label} className="glass rounded-2xl py-5">
                <div className="text-2xl sm:text-3xl font-display gradient-text">{s.value}</div>
                <div className="text-slate-400 text-xs sm:text-sm mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Categories ─────────────────────────────────────── */}
      {categories.length > 0 && (
        <section className="section py-6">
          <div className="flex flex-wrap justify-center gap-3">
            {categories.map((c) => {
              const v = categoryVisual(c);
              const Icon = v.icon;
              return (
                <Link key={c} to={`/shop?category=${encodeURIComponent(c)}`}
                  className="chip hover:border-primary/40 hover:text-white">
                  <Icon size={15} /> {v.label}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Popular products ───────────────────────────────── */}
      <section className="section py-16">
        <div className="flex items-end justify-between mb-10">
          <div>
            <span className="eyebrow">Trending now</span>
            <h2 className="text-3xl sm:text-4xl text-white mt-4">Popular products</h2>
          </div>
          <Link to="/shop" className="hidden sm:inline-flex btn-ghost text-sm">View all <ArrowRight size={16} /></Link>
        </div>

        {products === null ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72" />)}
          </div>
        ) : popular.length === 0 ? (
          <div className="card p-12 text-center">
            <Sparkles className="mx-auto text-slate-600 mb-4" size={36} />
            <p className="text-slate-300 font-medium">The shelves are being stocked</p>
            <p className="text-slate-500 text-sm mt-1">Products added by the team or synced from suppliers appear here.</p>
            <Link to="/shop" className="btn-primary mt-6 inline-flex">Go to shop</Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {popular.map((p) => <ProductCard key={p.id} product={p} onAdd={onAdd} />)}
          </div>
        )}
      </section>

      {/* ── Features ───────────────────────────────────────── */}
      <section className="section py-16">
        <SectionHeading eyebrow="Why ForgeMarket" title="Built for serious buyers"
          subtitle="A premium storefront powered by real fulfillment, security and support infrastructure." />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map(({ icon: Icon, title, text }, i) => (
            <Reveal key={title} delay={i * 80}>
              <div className="card lift p-6 hover:border-primary/40 transition group h-full">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/20 border border-white/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Icon size={22} className="text-indigo-300" />
                </div>
                <h3 className="text-white text-base mb-1.5">{title}</h3>
                <p className="text-slate-400 text-sm">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────── */}
      <section className="section py-16">
        <SectionHeading eyebrow="How it works" title="Three steps to delivery" />
        <div className="grid md:grid-cols-3 gap-5">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <Reveal key={title} delay={i * 100}>
              <div className="relative card lift p-7 h-full">
                <span className="absolute top-5 right-6 font-display text-5xl text-white/5">{i + 1}</span>
                <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center mb-4">
                  <Icon size={22} className="text-primary" />
                </div>
                <h3 className="text-white text-lg mb-1.5">{title}</h3>
                <p className="text-slate-400 text-sm">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Reviews ────────────────────────────────────────── */}
      <section className="section py-16">
        <SectionHeading eyebrow="Loved by gamers" title="What customers say" />
        <div className="grid md:grid-cols-3 gap-5">
          {REVIEWS.map((r, i) => (
            <Reveal key={r.name} delay={i * 90} className="card lift p-6">
              <div className="flex gap-0.5 mb-3 text-amber-400">
                {Array.from({ length: 5 }).map((_, i) => <Star key={i} size={15} fill="currentColor" />)}
              </div>
              <p className="text-slate-200">“{r.text}”</p>
              <div className="flex items-center gap-3 mt-5">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center text-white text-sm font-semibold">
                  {r.name[0]}
                </div>
                <div>
                  <div className="text-white text-sm">{r.name}</div>
                  <div className="text-slate-500 text-xs">{r.tag}</div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Discord CTA ────────────────────────────────────── */}
      <section className="section py-16">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 p-10 sm:p-14 text-center"
             style={{ backgroundImage: 'linear-gradient(120deg, rgba(88,101,242,.25), rgba(168,85,247,.2))' }}>
          <div className="orb w-72 h-72 bg-[#5865F2]/40 -top-24 left-10" />
          <div className="relative">
            <MessageCircle className="mx-auto text-white mb-4" size={40} />
            <h2 className="text-3xl sm:text-4xl text-white">Join the community</h2>
            <p className="text-slate-300 mt-3 max-w-xl mx-auto">
              Drops, giveaways, support and vouches — all in our Discord. Link your account and get verified roles.
            </p>
            <Link to="/discord" className="btn-primary px-7 py-3.5 mt-7 inline-flex text-base">
              <MessageCircle size={18} /> Explore Discord
            </Link>
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────── */}
      <section className="section py-16 max-w-3xl">
        <SectionHeading eyebrow="FAQ" title="Questions, answered" />
        <div className="space-y-3">
          {FAQS.map(([q, a]) => <Faq key={q} q={q} a={a} />)}
        </div>
      </section>
    </div>
  );
}

function Faq({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <button onClick={() => setOpen((v) => !v)} className="w-full text-left card p-5 hover:border-primary/30 transition">
      <div className="flex items-center justify-between gap-4">
        <span className="text-white font-medium">{q}</span>
        <ChevronDown size={18} className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>
      {open && <p className="text-slate-400 text-sm mt-3 leading-relaxed">{a}</p>}
    </button>
  );
}
