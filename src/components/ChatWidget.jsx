import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, X, Send, Sparkles, Zap, Clock } from 'lucide-react';
import { api } from '../lib/api.js';
import { money } from '../lib/catalog.js';
import { useI18n } from '../lib/i18n.jsx';

/**
 * Forge — the storefront assistant.
 *
 * The answers come from the server (`/api/chat`), which reads the live catalog,
 * the real stock flags and the actual order-tracking data. This file is the
 * surface only: it must never invent an answer of its own.
 *
 * That split matters. The previous version was a keyword list in the browser
 * that spoke no Dutch on a Dutch shop, had never seen a real price, and told
 * visitors delivery was instant and checkout took cards — neither of which is
 * true. A wrong answer from a shop's own assistant is worse than no assistant.
 */

const COPY = {
  en: {
    title: 'Forge Assistant',
    status: 'Answers from live shop data',
    placeholder: 'Ask anything…',
    greeting: "Hey! I'm Forge ⚡ Ask me about prices, delivery, paying or your order — or paste an order number and I'll look it up.",
    offline: "I can't reach the shop right now, so I'd rather say nothing than guess. Try again in a moment, or ask us on Discord — a real person answers there.",
    browse: 'Browse all →',
    inStock: 'In stock',
    byHand: 'By hand, few hours',
    left: (n) => `${n} left`,
    actions: { shop: 'Open shop', track: 'Track order', discord: 'Ask on Discord', how: 'How it works', reviews: 'Read reviews' },
  },
  nl: {
    title: 'Forge Assistent',
    status: 'Antwoordt met echte winkelgegevens',
    placeholder: 'Stel je vraag…',
    greeting: 'Hoi! Ik ben Forge ⚡ Vraag me naar prijzen, levertijd, betalen of je bestelling — of plak je bestelnummer, dan zoek ik het op.',
    offline: 'Ik kan de winkel nu niet bereiken, en dan zeg ik liever niets dan iets verkeerds. Probeer het zo nog eens, of vraag het op Discord — daar antwoordt een mens.',
    browse: 'Bekijk alles →',
    inStock: 'Op voorraad',
    byHand: 'Met de hand, paar uur',
    left: (n) => `nog ${n}`,
    actions: { shop: 'Naar de shop', track: 'Bestelling volgen', discord: 'Vraag het op Discord', how: 'Hoe het werkt', reviews: 'Lees reviews' },
  },
};

const QUICK = {
  en: ['How long does delivery take?', 'How do I pay?', 'Is this legit?', 'Price of Robux'],
  nl: ['Hoe lang duurt levering?', 'Hoe betaal ik?', 'Is dit betrouwbaar?', 'Wat kost Robux?'],
};

const ACTION_TO = { shop: '/shop', track: '/track', discord: '/discord', how: '/how-it-works', reviews: '/reviews' };

/**
 * Open the assistant from anywhere on the page.
 *
 * The homepage had a ForgeBot card that looked like a chat — avatar, greeting
 * bubble, a green "Online" dot — and whose button was a link to the contact
 * page. Anyone who tapped it reasonably concluded the bot was broken. Now the
 * card opens this, the real one.
 */
// Moved to src/lib/forgeChat.js so callers can trigger the chat without
// importing this file, which is lazy-loaded. Re-exported for anything that
// still reaches for it here.
export { openForgeChat } from '../lib/forgeChat.js';

export default function ChatWidget() {
  const { lang } = useI18n();
  const L = COPY[lang === 'nl' ? 'nl' : 'en'];
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);

  // The greeting follows the language switch until the visitor says something.
  useEffect(() => {
    setMessages((m) => (m.length <= 1 ? [{ from: 'bot', text: L.greeting }] : m));
  }, [L.greeting]);

  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    if (open) inputRef.current?.focus();
  }, [messages, typing, open]);

  // Anything on the page can open the assistant, optionally with a question
  // already asked — used by the homepage card and the quick-question chips.
  useEffect(() => {
    const onOpen = (e) => {
      setOpen(true);
      const q = e.detail?.message;
      if (q) setTimeout(() => sendRef.current?.(q), 150);
    };
    window.addEventListener('forge:chat:open', onOpen);
    return () => window.removeEventListener('forge:chat:open', onOpen);
  }, []);

  const sendRef = useRef(null);
  const send = async (text) => {
    const msg = text.trim();
    if (!msg || typing) return;
    setMessages((m) => [...m, { from: 'user', text: msg }]);
    setInput('');
    setTyping(true);
    try {
      const r = await api.post('/api/chat', { message: msg.slice(0, 500), lang });
      setMessages((m) => [...m, { from: 'bot', ...r }]);
    } catch {
      // Never fall back to guessing: the whole point is that answers are real.
      setMessages((m) => [...m, { from: 'bot', text: L.offline, actions: ['discord'] }]);
    } finally {
      setTyping(false);
    }
  };
  sendRef.current = send;

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close chat assistant' : 'Open chat assistant'}
        className={`fixed right-5 z-50 w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg transition-transform hover:scale-110 active:scale-95 fm-fab`}
        style={{ backgroundImage: 'linear-gradient(135deg,#6366f1,#a855f7,#ec4899)', boxShadow: '0 8px 30px rgba(139,92,246,.5)' }}
      >
        {open ? <X size={24} /> : <MessageCircle size={24} />}
      </button>

      {open && (
        <div className={`fixed right-5 z-50 w-[min(92vw,380px)] h-[min(70vh,560px)] flex flex-col rounded-3xl overflow-hidden border border-white/10 bg-elevated/95 backdrop-blur-xl shadow-2xl animate-fade-up fm-fab-panel`}>
          <div className="px-5 py-4 flex items-center gap-3 border-b border-white/10"
               style={{ backgroundImage: 'linear-gradient(120deg, rgba(99,102,241,.25), rgba(168,85,247,.2))' }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                 style={{ backgroundImage: 'linear-gradient(135deg,#6366f1,#a855f7)' }}>
              <Sparkles size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-white font-semibold leading-tight">{L.title}</div>
              {/* Not "online · replies instantly": this is software, and saying
                  what it actually does sets the right expectation. */}
              <div className="text-slate-400 text-xs">{L.status}</div>
            </div>
          </div>

          <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((m, i) => <Bubble key={i} m={m} L={L} />)}
            {typing && (
              <div className="flex gap-1.5 items-center px-3.5 py-2.5 rounded-2xl bg-white/[0.06] w-fit">
                {[0, 1, 2].map((d) => (
                  <span key={d} className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${d * 0.15}s` }} />
                ))}
              </div>
            )}
            {messages.length <= 1 && !typing && (
              <div className="flex flex-wrap gap-2 pt-1">
                {(QUICK[lang === 'nl' ? 'nl' : 'en']).map((q) => (
                  <button key={q} onClick={() => send(q)} className="chip text-xs hover:border-primary/40 hover:text-white">{q}</button>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(input); }}
                className="p-3 border-t border-white/10 flex items-center gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={500}
              placeholder={L.placeholder}
              className="input py-2.5 text-base"
            />
            <button type="submit" disabled={!input.trim() || typing}
                    className="btn-primary w-11 h-11 shrink-0 !px-0 rounded-xl disabled:opacity-40" aria-label="Send">
              <Send size={17} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

/** Markdown-lite: the server writes **bold** around the parts that matter. */
function renderText(text) {
  return String(text || '').split(/(\*\*[^*]+\*\*)/g).map((part, i) => (
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="text-white">{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
  ));
}

function Bubble({ m, L }) {
  const isBot = m.from === 'bot';
  return (
    <div className={`flex ${isBot ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[85%] ${isBot ? 'bg-white/[0.06] text-slate-100' : 'text-white'} rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed`}
           style={!isBot ? { backgroundImage: 'linear-gradient(120deg,#6366f1,#a855f7)' } : undefined}>
        <p className="whitespace-pre-line">{renderText(m.text)}</p>

        {m.order && (
          <Link to={`/track?number=${encodeURIComponent(m.order.number)}`}
                className="mt-2.5 block rounded-xl bg-black/30 border border-white/10 p-2.5 hover:border-primary/40 transition">
            <div className="text-white text-xs font-mono">{m.order.number}</div>
            {m.order.total && <div className="text-indigo-300 text-xs mt-0.5">{m.order.total}</div>}
          </Link>
        )}

        {m.products && (
          <div className="mt-2.5 space-y-2">
            {m.products.map((p) => (
              <Link key={p.id} to={`/product/${p.id}`}
                    className="flex items-center gap-2.5 rounded-xl bg-black/30 border border-white/10 p-2 hover:border-primary/40 transition">
                <div className="w-9 h-9 rounded-lg bg-white/5 overflow-hidden shrink-0 flex items-center justify-center">
                  {/* contain, not cover: every artboard is 7:6 and this box is square, so
                      cover cropped 14% off both sides of the artwork — the number the
                      tile exists to show. The one cropping thumbnail in the shop. */}
                  {p.image ? <img src={p.image} alt="" className="w-full h-full object-contain" /> : <Sparkles size={16} className="text-indigo-300" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-white text-xs font-medium truncate">{p.name}</div>
                  <div className="flex items-center gap-2">
                    <span className="text-indigo-300 text-xs">{money(p.price, p.currency)}</span>
                    {/* Straight from the shop's own availability flag — the same
                        one the product page uses, so they cannot disagree. */}
                    <span className={`inline-flex items-center gap-1 text-[10px] ${p.instant ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {p.instant ? <Zap size={10} /> : <Clock size={10} />}
                      {p.instant ? L.inStock : L.byHand}
                      {p.instant && p.stockLeft ? ` · ${L.left(p.stockLeft)}` : ''}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
            <Link to="/shop" className="block text-center text-xs text-indigo-300 hover:text-white pt-0.5">{L.browse}</Link>
          </div>
        )}

        {m.actions?.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {m.actions.filter((a) => ACTION_TO[a]).map((a) => (
              <Link key={a} to={ACTION_TO[a]} className="chip text-xs hover:border-primary/40 hover:text-white">
                {L.actions[a]}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
