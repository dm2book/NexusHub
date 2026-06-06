import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, X, Send, Sparkles } from 'lucide-react';
import { api } from '../lib/api.js';
import { withFallback } from '../lib/sampleCatalog.js';
import { money } from '../lib/catalog.js';

/**
 * Forge — a live, product-aware assistant available on every page.
 *
 * Answers common questions, recommends real products from the live catalog and
 * points users to the shop, order tracking and Discord. Runs fully client-side
 * (instant, always-on); if a server AI endpoint is added later it can be wired in
 * here without touching the UI.
 */
const FAQ = [
  { k: ['delivery', 'fast', 'long', 'instant', 'receive', 'how soon'],
    a: 'Delivery is instant ⚡ — most codes arrive within seconds of payment, in your dashboard and by email.' },
  { k: ['safe', 'legit', 'scam', 'trust', 'secure'],
    a: 'Totally safe 🔒 — encrypted checkout, fraud screening, buyer protection and verified reviews. We never DM you first.' },
  { k: ['pay', 'payment', 'card', 'method', 'paypal', 'ideal'],
    a: 'You pay securely by card at checkout. Your order is fraud-screened automatically.' },
  { k: ['refund', 'money back', 'wrong', 'didn', 'not received', 'missing'],
    a: 'No worries — open a ticket in our Discord or your dashboard with your order number. Eligible orders are money-back guaranteed.' },
  { k: ['track', 'status', 'order'],
    a: 'You can track any order live on the Track Order page using your order number.' },
  { k: ['account', 'login', 'sign', 'code', 'otp'],
    a: 'Sign-in is passwordless — enter your email and we send a 6-digit code. No password to remember.' },
  { k: ['discord', 'community', 'giveaway'],
    a: 'Join our Discord for drops, giveaways, support and vouches — there’s a Join button on the Discord page.' },
];

const QUICK = ['How fast is delivery?', 'Is it safe?', 'Recommend Robux', 'How do refunds work?'];

const GREETING = {
  from: 'bot',
  text: "Hey! I’m Forge ⚡ your ForgeMarket assistant. Ask me about products, delivery, payments or refunds — or tell me a game and budget and I’ll recommend a pack.",
};

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    api.get('/api/products').then((r) => setProducts(withFallback(r.products))).catch(() => setProducts(withFallback([])));
  }, []);

  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, typing, open]);

  const reply = (text) => {
    const t = text.toLowerCase();

    // Product recommendation by category/game keyword.
    const byCat = products.filter((p) =>
      t.includes((p.category || '').toLowerCase()) ||
      (p.name || '').toLowerCase().split(' ').some((w) => w.length > 3 && t.includes(w)));
    const wantsRec = /recommend|suggest|cheap|best|which|buy|need|want|price|how much/.test(t);

    if (byCat.length && (wantsRec || byCat.length <= 6)) {
      const picks = byCat.slice(0, 3);
      return {
        text: `Here are some great picks${picks[0]?.category ? ` for ${picks[0].category}` : ''}:`,
        products: picks,
      };
    }

    const hit = FAQ.find((f) => f.k.some((kw) => t.includes(kw)));
    if (hit) return { text: hit.a };

    if (/hi|hello|hey|yo|hallo/.test(t)) return { text: 'Hey! 👋 What can I help you find today? You can browse the shop or ask me to recommend a pack.' };
    if (/thank|thx|bedankt/.test(t)) return { text: 'Anytime! 💜 Happy gaming.' };

    return {
      text: "I can help with products, delivery, payments, refunds and orders. Try naming a game (e.g. “Robux” or “V-Bucks”), or browse the full shop.",
      cta: true,
    };
  };

  const send = (text) => {
    const msg = text.trim();
    if (!msg) return;
    setMessages((m) => [...m, { from: 'user', text: msg }]);
    setInput('');
    setTyping(true);
    setTimeout(() => {
      const r = reply(msg);
      setTyping(false);
      setMessages((m) => [...m, { from: 'bot', ...r }]);
    }, 450 + Math.random() * 350);
  };

  return (
    <>
      {/* Launcher */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Open chat assistant"
        className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg transition-transform hover:scale-110 active:scale-95"
        style={{ backgroundImage: 'linear-gradient(135deg,#6366f1,#a855f7,#ec4899)', boxShadow: '0 8px 30px rgba(139,92,246,.5)' }}
      >
        {open ? <X size={24} /> : <MessageCircle size={24} />}
        {!open && <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-space-black animate-pulse" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-24 right-5 z-50 w-[min(92vw,380px)] h-[min(70vh,560px)] flex flex-col rounded-3xl overflow-hidden border border-white/10 bg-elevated/95 backdrop-blur-xl shadow-2xl animate-fade-up">
          {/* Header */}
          <div className="px-5 py-4 flex items-center gap-3 border-b border-white/10"
               style={{ backgroundImage: 'linear-gradient(120deg, rgba(99,102,241,.25), rgba(168,85,247,.2))' }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                 style={{ backgroundImage: 'linear-gradient(135deg,#6366f1,#a855f7)' }}>
              <Sparkles size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-white font-semibold leading-tight">Forge Assistant</div>
              <div className="text-emerald-300 text-xs flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Online · replies instantly
              </div>
            </div>
          </div>

          {/* Messages */}
          <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((m, i) => <Bubble key={i} m={m} />)}
            {typing && (
              <div className="flex gap-1.5 items-center px-3.5 py-2.5 rounded-2xl bg-white/[0.06] w-fit">
                {[0, 1, 2].map((d) => (
                  <span key={d} className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${d * 0.15}s` }} />
                ))}
              </div>
            )}

            {messages.length <= 1 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {QUICK.map((q) => (
                  <button key={q} onClick={() => send(q)} className="chip text-xs hover:border-primary/40 hover:text-white">{q}</button>
                ))}
              </div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={(e) => { e.preventDefault(); send(input); }}
                className="p-3 border-t border-white/10 flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything…"
              className="input py-2.5 text-sm"
            />
            <button type="submit" disabled={!input.trim()}
                    className="btn-primary w-11 h-11 shrink-0 !px-0 rounded-xl" aria-label="Send">
              <Send size={17} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function Bubble({ m }) {
  const isBot = m.from === 'bot';
  return (
    <div className={`flex ${isBot ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[85%] ${isBot ? 'bg-white/[0.06] text-slate-100' : 'text-white'} rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed`}
           style={!isBot ? { backgroundImage: 'linear-gradient(120deg,#6366f1,#a855f7)' } : undefined}>
        <p>{m.text}</p>

        {m.products && (
          <div className="mt-2.5 space-y-2">
            {m.products.map((p) => (
              <Link key={p.id} to={`/product/${p.id}`}
                    className="flex items-center gap-2.5 rounded-xl bg-black/30 border border-white/10 p-2 hover:border-primary/40 transition">
                <div className="w-9 h-9 rounded-lg bg-white/5 overflow-hidden shrink-0 flex items-center justify-center">
                  {p.image ? <img src={p.image} alt="" className="w-full h-full object-cover" /> : <Sparkles size={16} className="text-indigo-300" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-white text-xs font-medium truncate">{p.name}</div>
                  <div className="text-indigo-300 text-xs">{money(p.price, p.currency)}</div>
                </div>
              </Link>
            ))}
            <Link to="/shop" className="block text-center text-xs text-indigo-300 hover:text-white pt-0.5">Browse all →</Link>
          </div>
        )}

        {m.cta && (
          <div className="mt-2.5 flex gap-2">
            <Link to="/shop" className="chip text-xs hover:border-primary/40 hover:text-white">Open shop</Link>
            <Link to="/track" className="chip text-xs hover:border-primary/40 hover:text-white">Track order</Link>
          </div>
        )}
      </div>
    </div>
  );
}
