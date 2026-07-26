/**
 * Forge — the storefront assistant, server-side.
 *
 * The old widget was a keyword list living in the browser. It only understood
 * English (on a Dutch shop), it could not see a single real price, and two of
 * its seven canned answers were claims the rest of the product had already
 * stopped making: "delivery is instant" and "you pay securely by card".
 *
 * This replaces it with an engine that answers from live data:
 *   · prices, stock and availability straight from the catalog
 *   · order status from the real tracking endpoint, by order number
 *   · redeem steps per product category
 *   · the actual payment flow, which is manual and reference-based
 *
 * Deterministic on purpose. An LLM per visitor message costs money on a shop
 * that has not sold anything yet, and a model with no data invents prices —
 * which is worse than a short honest answer. Every reply here is derived from
 * something real, and the whole thing is testable without a network call.
 */
import { config } from '../config/env.js';

/** Both site languages. A Dutch buyer typing "hoe lang duurt het" got nothing. */
const NL = 'nl';
const EN = 'en';

/**
 * Language detection from the message itself, so the answer matches how the
 * question was asked even if the UI is in the other language.
 */
export function detectLang(text, fallback = EN) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const dutch = [' hoe ', ' wat ', ' waar ', ' wanneer ', ' kan ik ', ' ik ', ' mijn ', ' niet ', ' geld ',
    ' betaal', ' bestell', ' levering', ' duurt', ' snel', ' veilig', ' terug', ' hallo', ' hoi', ' doei',
    ' bedankt', ' dank', ' waarom', ' welke', ' goedkoop', ' krijg', ' heb ', ' met ', ' voor ', ' euro'];
  const english = [' how ', ' what ', ' where ', ' when ', ' can i ', ' my ', ' the ', ' is it ', ' does ',
    ' delivery', ' payment', ' refund', ' order', ' safe', ' thanks', ' hello', ' cheap', ' price'];
  const score = (list) => list.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  const nl = score(dutch);
  const en = score(english);
  if (nl > en) return NL;
  if (en > nl) return EN;
  return fallback;
}

/** An order number, in the shape the store issues them. */
export const ORDER_RE = /\bFM-\d{4}-[A-Z0-9]{4,}\b/i;

/**
 * How each category is redeemed. Mirrors the delivery email exactly — a buyer
 * must never get two different answers to "how do I use this?".
 */
const REDEEM = {
  robux: { nl: 'Robux wissel je in op **roblox.com/redeem**: inloggen, code plakken, klaar. Ze komen op het account waarmee je bent ingelogd — check dus dat dat de juiste is.',
    en: 'Redeem Robux at **roblox.com/redeem**: sign in, paste the code, done. They land on the account you are signed in to — double-check it is the right one.' },
  'v-bucks': { nl: 'V-Bucks wissel je in op **fortnite.com/vbuckscard** met je Epic-account. Ze werken daarna op elk platform van dat account.',
    en: 'Redeem V-Bucks at **fortnite.com/vbuckscard** with your Epic account. They then work on every platform on that account.' },
  valorant: { nl: 'Valorant Points wissel je in in de game: open de **Store** en kies **Redeem code**.',
    en: 'Redeem Valorant Points in-game: open the **Store** and choose **Redeem code**.' },
  'discord-nitro': { nl: 'Nitro activeer je op **discord.com/billing/promotions** terwijl je ingelogd bent.',
    en: 'Activate Nitro at **discord.com/billing/promotions** while signed in.' },
  giftcard: { nl: 'Een gift card wissel je in bij de winkel zelf (Steam, PlayStation, Xbox): inloggen, **Code inwisselen** of **Tegoed toevoegen**, code plakken. Het saldo blijft daarna op dat account.',
    en: 'Redeem a gift card at the store it belongs to (Steam, PlayStation, Xbox): sign in, find **Redeem code** / **Add funds**, paste it. The balance stays on that account.' },
  gamepass: { nl: 'Game Pass activeer je op **redeem.microsoft.com** met je Microsoft-account.',
    en: 'Activate Game Pass at **redeem.microsoft.com** with your Microsoft account.' },
  spotify: { nl: 'Spotify-codes wissel je in op **spotify.com/redeem**.',
    en: 'Redeem Spotify codes at **spotify.com/redeem**.' },
  minecraft: { nl: 'Minecraft-codes wissel je in op **minecraft.net/redeem**.',
    en: 'Redeem Minecraft codes at **minecraft.net/redeem**.' },
};

const T = {
  delivery: {
    nl: 'Zit het op voorraad, dan gaat je code **automatisch** de deur uit zodra we je betaling bevestigen. Staat het niet op voorraad, dan kopen we het voor je in en leveren we met de hand — meestal binnen een paar uur overdag. Je code komt altijd binnen op het mailadres dat je bij het bestellen opgeeft.',
    en: 'If it is in stock your code goes out **automatically** as soon as we confirm your payment. If it is not, we buy it in for you and deliver by hand — usually within a few hours during the day. Either way the code arrives at the email you used at checkout.',
  },
  payment: {
    nl: 'Je plaatst eerst je bestelling. Daarna zie je het bedrag en een **referentie** (je bestelnummer). Betaal met die referentie erbij — zo koppelen we jouw betaling aan jouw bestelling. Wij bevestigen elke betaling met de hand, meestal binnen een paar minuten overdag. Geen creditcard-checkout dus, en geen verborgen kosten.',
    en: 'You place the order first. Then you see the amount and a **reference** (your order number). Pay with that reference in the description — that is how we match your payment to your order. We confirm every payment by hand, usually within minutes during the day. No card checkout, and no hidden fees.',
  },
  refund: {
    nl: 'Komt je bestelling niet aan, dan krijg je je geld terug. Open een ticket in onze Discord met je bestelnummer, of mail terug op je bestelbevestiging. Een terugbetaling staat meestal binnen 1–3 werkdagen op de rekening waarmee je betaalde.',
    en: 'If your order never arrives you get your money back. Open a ticket in our Discord with your order number, or reply to your order confirmation email. A refund is usually back within 1–3 working days, on the account you paid from.',
  },
  safety: {
    nl: 'Eerlijk antwoord: we zijn een kleine Nederlandse winkel, geen groot bedrijf. Wat we je wél geven: je geld terug als er niets aankomt, reviews die aan echte bestellingen hangen, en een mens dat antwoordt op Discord. Let op: wij **DM\'en je nooit als eerste** en vragen nooit om je wachtwoord.',
    en: 'Honest answer: we are a small Dutch shop, not a big company. What you do get: your money back if nothing arrives, reviews tied to real orders, and a human answering on Discord. Note: we **never DM you first** and never ask for your password.',
  },
  account: {
    nl: 'Je hebt **geen account nodig** om te bestellen. Wil je er toch een, dan gaat inloggen zonder wachtwoord: je vult je e-mail in en krijgt een code van 6 cijfers.',
    en: 'You do **not need an account** to order. If you want one, sign-in is passwordless: enter your email and we send a 6-digit code.',
  },
  track: {
    nl: 'Plak je bestelnummer hier (het ziet eruit als FM-2026-XXXXXXXX) en ik zoek de status voor je op. Of open de pagina Bestelling volgen — daar hoef je ook niet voor in te loggen.',
    en: 'Paste your order number here (it looks like FM-2026-XXXXXXXX) and I will look up the status. Or open the Track Order page — no login needed for that either.',
  },
  discord: {
    nl: 'Op onze Discord zit de support, drops en giveaways. Een echt mens leest je ticket — geen bot.',
    en: 'Our Discord has support, drops and giveaways. A real person reads your ticket — not a bot.',
  },
  greeting: {
    nl: 'Hoi! 👋 Vraag me gerust naar prijzen, levertijd, betalen of je bestelling. Noem een game en ik zoek de pakketten erbij.',
    en: 'Hey! 👋 Ask me about prices, delivery, paying or your order. Name a game and I will pull up the packs.',
  },
  thanks: { nl: 'Graag gedaan! 💜', en: 'Anytime! 💜' },
  fallback: {
    nl: 'Daar weet ik zo geen goed antwoord op. Ik kan wel helpen met prijzen, levertijd, betalen, terugbetalingen en de status van je bestelling. Kom je er niet uit? Stel je vraag op onze Discord — daar antwoordt een mens.',
    en: 'I do not have a good answer for that one. I can help with prices, delivery, paying, refunds and your order status. Still stuck? Ask on our Discord — a human answers there.',
  },
  noMatch: {
    nl: 'Dat product vind ik niet in de winkel. Bekijk de hele catalogus, of noem de game (bijvoorbeeld "Robux" of "V-Bucks").',
    en: 'I cannot find that product in the shop. Browse the full catalogue, or name the game (for example "Robux" or "V-Bucks").',
  },
  orderNotFound: {
    nl: 'Dat bestelnummer ken ik niet. Check of hij klopt (FM-2026-XXXXXXXX) — hij staat in je bevestigingsmail. Klopt het wel? Open dan een ticket op Discord, dan zoeken we het uit.',
    en: 'I do not know that order number. Check it against your confirmation email (FM-2026-XXXXXXXX). Sure it is right? Open a ticket on Discord and we will find it.',
  },
};

/** Buyer-facing meaning of each order status. Same wording as the Discord bot. */
const STATUS = {
  pending: { nl: '⏳ We wachten nog op je betaling. Betaal met je bestelnummer als referentie — de status springt vanzelf om.',
    en: '⏳ We are still waiting for your payment. Pay with your order number as the reference — the status flips by itself.' },
  payment_received: { nl: '✅ Je betaling is bevestigd. Je hoeft niets meer te doen; we maken je bestelling klaar.',
    en: '✅ Your payment is confirmed. Nothing left for you to do; we are preparing your order.' },
  processing: { nl: '🔧 We zijn je bestelling nu aan het klaarmaken.', en: '🔧 We are preparing your order right now.' },
  awaiting_fulfillment: { nl: '📦 Betaald en in de wachtrij voor levering.', en: '📦 Paid and queued for delivery.' },
  completed: { nl: '🎉 Geleverd! Je code is gemaild naar het adres van je bestelling. Niets gekregen? Check spam en open anders een ticket.',
    en: '🎉 Delivered! Your code was emailed to the address on the order. Nothing there? Check spam, then open a ticket.' },
  refunded: { nl: '↩️ Deze bestelling is terugbetaald — meestal 1–3 werkdagen op je rekening.',
    en: '↩️ This order was refunded — usually 1–3 working days back on your account.' },
  cancelled: { nl: '✖️ Deze bestelling is geannuleerd. Klopt dat niet? Open een ticket.',
    en: '✖️ This order was cancelled. Think that is wrong? Open a ticket.' },
  failed: { nl: '⚠️ Er ging iets mis met deze bestelling. Open een ticket, dan lossen we het op.',
    en: '⚠️ Something went wrong with this order. Open a ticket and we will sort it out.' },
};

const has = (t, ...words) => words.some((w) => t.includes(w));

/**
 * Answer one message.
 *
 * `deps` is injected so this is testable: { products, lookupOrder }. Products
 * are the live catalog rows (with the honest `instant` / `stockLeft` flags the
 * storefront uses); lookupOrder resolves an order number to its status.
 */
export async function answer(message, { lang: uiLang = EN, products = [], lookupOrder = null } = {}) {
  const raw = String(message || '').trim();
  const t = raw.toLowerCase();
  const lang = detectLang(raw, uiLang === NL ? NL : EN);
  const say = (key) => ({ text: T[key][lang] });

  if (!raw) return say('greeting');

  // 1. An order number beats every other intent: it is the most specific thing
  //    a visitor can type, and it is always about "where is my stuff".
  const num = raw.match(ORDER_RE)?.[0]?.toUpperCase();
  if (num && lookupOrder) {
    const order = await lookupOrder(num).catch(() => null);
    if (!order) return { ...say('orderNotFound'), actions: ['discord'] };
    const s = STATUS[order.status] || { nl: order.statusLabel, en: order.statusLabel };
    return {
      text: `**${order.number}** — ${s[lang] || s.en}`,
      order: { number: order.number, status: order.status, total: order.totalFormatted },
      actions: ['track'],
    };
  }
  if (num && !lookupOrder) return { ...say('track'), actions: ['track'] };

  // 2. "How do I redeem X" — answer for the category they named, not in general.
  // Dutch splits the verb ("hoe wissel ik mijn code in"), so matching the whole
  // word 'inwisselen' alone missed the most natural way to ask this.
  if (has(t, 'redeem', 'inwissel', 'wissel', 'verzilver', 'activeer', 'activate',
    'code gebruik', 'gebruik ik mijn code', 'use my code', 'waar vul ik', 'invoeren', 'waar voer ik')) {
    const cat = matchCategory(t, products);
    const r = REDEEM[cat];
    if (r) return { text: r[lang], actions: ['shop'] };
  }

  // 3. Product / price questions — answered from the live catalog, never guessed.
  const wantsProduct = has(t, 'price', 'prijs', 'kost', 'cost', 'hoeveel', 'how much', 'cheap', 'goedkoop',
    'recommend', 'aanraden', 'welke', 'which', 'buy', 'kopen', 'verkoop', 'sell', 'heb je', 'do you have',
    'pakket', 'pack', 'voorraad', 'stock', 'available', 'beschikbaar');
  const matches = findProducts(t, products);
  if (matches.length && (wantsProduct || matches.length <= 4)) {
    const picks = matches.slice(0, 3);
    const availability = picks.some((p) => p.instant)
      ? (lang === NL ? 'Groen vinkje = op voorraad, gaat automatisch de deur uit zodra je betaling bevestigd is.'
        : 'In stock — sent automatically once your payment is confirmed.')
      : (lang === NL ? 'Deze koop ik voor je in en lever ik met de hand, meestal binnen een paar uur.'
        : 'These we buy in and deliver by hand, usually within a few hours.');
    return {
      text: lang === NL ? `Dit heb ik voor je gevonden:\n\n${availability}` : `Here is what I found:\n\n${availability}`,
      products: picks.map((p) => ({
        id: p.id, name: p.name, category: p.category || null,
        price: p.price, currency: p.currency,
        image: p.image, instant: !!p.instant, stockLeft: p.stockLeft ?? null,
      })),
    };
  }
  if (wantsProduct && !matches.length && products.length) return { ...say('noMatch'), actions: ['shop'] };

  // 4. The standing questions, in either language.
  if (has(t, 'deliver', 'levering', 'leveren', 'duurt', 'hoe lang', 'how long', 'how fast', 'snel', 'wanneer krijg', 'when do i get', 'instant')) {
    return { ...say('delivery'), actions: ['how'] };
  }
  if (has(t, 'pay', 'betaal', 'betalen', 'ideal', 'tikkie', 'paypal', 'card', 'kaart', 'creditcard', 'overmaken', 'payment')) {
    return { ...say('payment'), actions: ['how'] };
  }
  if (has(t, 'refund', 'terugbetaling', 'geld terug', 'money back', 'niet aangekomen', 'not received', 'niks gekregen', 'kwijt')) {
    return { ...say('refund'), actions: ['discord', 'track'] };
  }
  if (has(t, 'safe', 'legit', 'scam', 'oplicht', 'betrouwbaar', 'veilig', 'nep', 'trust', 'vertrouw')) {
    return { ...say('safety'), actions: ['reviews', 'discord'] };
  }
  if (has(t, 'track', 'status', 'bestelling', 'order', 'waar is mijn', 'where is my')) {
    return { ...say('track'), actions: ['track'] };
  }
  if (has(t, 'account', 'login', 'log in', 'inloggen', 'wachtwoord', 'password', 'sign in', 'registreren')) {
    return { ...say('account'), actions: ['shop'] };
  }
  if (has(t, 'discord', 'community', 'giveaway', 'support', 'help me', 'contact', 'ticket')) {
    return { ...say('discord'), actions: ['discord'] };
  }
  if (has(t, 'hoi', 'hallo', 'hey', 'hi ', 'hello', 'yo ', 'goedemorgen', 'goedemiddag') || t === 'hi' || t === 'hey') {
    return say('greeting');
  }
  if (has(t, 'thank', 'bedankt', 'dank je', 'dankje', 'thx', 'merci')) return say('thanks');

  return { ...say('fallback'), actions: ['shop', 'discord'] };
}

/** Which category the message is about, if any. */
function matchCategory(t, products) {
  const alias = {
    robux: ['robux', 'roblox'], 'v-bucks': ['vbucks', 'v-bucks', 'fortnite'], valorant: ['valorant', 'vp '],
    'discord-nitro': ['nitro'], giftcard: ['gift card', 'giftcard', 'steam', 'playstation', 'psn', 'xbox'],
    gamepass: ['game pass', 'gamepass'], spotify: ['spotify'], minecraft: ['minecraft'],
  };
  for (const [cat, words] of Object.entries(alias)) if (words.some((w) => t.includes(w))) return cat;
  const p = products.find((x) => t.includes(String(x.category || '').toLowerCase()));
  return p?.category || null;
}

/** Live catalog search: exact name, then partial, then category. */
function findProducts(t, products) {
  if (!products.length) return [];
  const scored = products.map((p) => {
    const name = String(p.name || '').toLowerCase();
    const cat = String(p.category || '').toLowerCase();
    let score = 0;
    if (name && t.includes(name)) score += 80;
    for (const w of name.split(/\s+/)) if (w.length > 2 && t.includes(w)) score += 12;
    if (cat && t.includes(cat)) score += 30;
    if (cat === 'v-bucks' && /vbucks|fortnite/.test(t)) score += 30;
    if (cat === 'robux' && /roblox/.test(t)) score += 30;
    if (cat === 'giftcard' && /gift ?card|steam|playstation|psn|xbox/.test(t)) score += 30;
    return { p, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.p.price - b.p.price);
  return scored.map((x) => x.p);
}

/** Suggested follow-ups, so the visitor is never left with a dead end. */
export function quickReplies(lang = EN) {
  return lang === NL
    ? ['Hoe lang duurt levering?', 'Hoe betaal ik?', 'Is dit betrouwbaar?', 'Prijs van Robux']
    : ['How long does delivery take?', 'How do I pay?', 'Is this legit?', 'Price of Robux'];
}

export const assistantMeta = { brand: config.email.fromName };
