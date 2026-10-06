/**
 * SEO pages generated from the live catalogue: game pages, gift-card brand
 * pages, platform pages and gift-budget pages — each with a title, a meta
 * description, an FAQ, schema.org markup and internal links, in the shop's
 * four languages.
 *
 * Runs on the server (to render the head a crawler reads) and in the browser
 * (to render the page), so it imports nothing that only exists on one side.
 *
 * ── RULES IT KEEPS ────────────────────────────────────────────────────────
 *   · A page exists only where the catalogue has DEPTH: two or more active
 *     products (four for a budget page). One product is a product page, and a
 *     second URL for it is a doorway.
 *   · Every sentence is built from catalogue facts — product names, prices,
 *     platforms, regions, how a category is delivered — and the payment
 *     methods the shop actually takes. No "cheapest", no "instant", no star
 *     rating, no search-volume figure: there is no data behind any of them.
 *   · The FAQ in the schema is exactly the FAQ on the page.
 *   · A category that already has a hand-written landing page (content/seo.js
 *     LANDING) keeps it; this module then only links to it.
 */
import { platformOf } from './platform.js';
import { deliveryField } from './deliveryInfo.js';

export const SEO_LANGS = ['nl', 'en', 'de', 'fr'];
const SITE_URL = 'https://www.forgemarket.nl';

/* ── Vocabulary ─────────────────────────────────────────────────────────── */
export const GAMES = {
  robux: { name: 'Roblox', unit: 'Robux' }, 'v-bucks': { name: 'Fortnite', unit: 'V-Bucks' },
  eafc: { name: 'EA SPORTS FC', unit: 'FC Points' }, valorant: { name: 'Valorant', unit: 'Valorant Points' },
  cod: { name: 'Call of Duty', unit: 'COD Points' }, apex: { name: 'Apex Legends', unit: 'Apex Coins' },
  brawl: { name: 'Brawl Stars', unit: 'Gems' }, clash: { name: 'Clash of Clans', unit: 'Gems' },
  clashroyale: { name: 'Clash Royale', unit: 'Gems' }, genshin: { name: 'Genshin Impact', unit: 'Genesis Crystals' },
  league: { name: 'League of Legends', unit: 'RP' }, pokemongo: { name: 'Pokémon GO', unit: 'PokéCoins' },
  pubg: { name: 'PUBG Mobile', unit: 'UC' }, freefire: { name: 'Free Fire', unit: 'Diamonds' },
  mlbb: { name: 'Mobile Legends', unit: 'Diamonds' }, minecraft: { name: 'Minecraft', unit: 'Minecoins' },
  gta: { name: 'GTA Online', unit: 'Shark Cards' }, 'discord-nitro': { name: 'Discord', unit: 'Nitro' },
  gamepass: { name: 'Xbox Game Pass', unit: 'Game Pass' }, spotify: { name: 'Spotify', unit: 'Premium' },
};
export const BRANDS = [
  { id: 'steam', name: 'Steam', re: /\bsteam\b/i, platform: 'pc' },
  { id: 'playstation', name: 'PlayStation Store', re: /playstation|\bpsn\b/i, platform: 'playstation' },
  { id: 'xbox', name: 'Xbox', re: /\bxbox\b/i, platform: 'xbox' },
  { id: 'nintendo', name: 'Nintendo eShop', re: /nintendo|eshop/i, platform: 'switch' },
  { id: 'netflix', name: 'Netflix', re: /netflix/i },
  { id: 'google-play', name: 'Google Play', re: /google\s*play/i },
  { id: 'apple', name: 'App Store & iTunes', re: /app\s*store|itunes|apple/i },
  { id: 'amazon', name: 'Amazon', re: /amazon/i },
];
export const PLATFORMS = [
  { id: 'playstation', name: 'PlayStation' }, { id: 'xbox', name: 'Xbox' }, { id: 'pc', name: 'PC' },
  { id: 'switch', name: 'Nintendo Switch' },
];
export const BUDGETS = [1000, 2500, 5000];

const brandOf = (p) => (p.category === 'giftcard' ? BRANDS.find((b) => b.re.test(p.name || '')) || null : null);
const eur = (cents, lang = 'nl') => new Intl.NumberFormat({ nl: 'nl-NL', en: 'en-IE', de: 'de-DE', fr: 'fr-FR' }[lang] || 'nl-NL',
  { style: 'currency', currency: 'EUR' }).format((cents || 0) / 100);
const join = (list, lang, word = 'and') => {
  const w = { and: { nl: 'en', en: 'and', de: 'und', fr: 'et' }, or: { nl: 'of', en: 'or', de: 'oder', fr: 'ou' } }[word][lang];
  return list.length <= 1 ? (list[0] || '') : `${list.slice(0, -1).join(', ')} ${w} ${list.at(-1)}`;
};
const or = (list, lang) => join(list, lang, 'or');
/* Whole euros where the amount is round: "€25", not "€ 25,00", in a title. */
const eur0 = (cents, lang = 'nl') => (cents % 100 === 0 ? `€${cents / 100}` : eur(cents, lang));
/* Google cuts a description at about 155 characters and a title at about 60:
   whatever falls off is lost, so it is cut at a word, never mid-word. */
export const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);
const regionOf = (p) => ((/\b(EU|NL|Global|UK|US|BE|DE)\b/.exec(p.name || '') || [])[1] || null);

/* ── The FAQ, from facts only ───────────────────────────────────────────── */
function faqFor(kind, ctx, lang) {
  const pay = or(ctx.payMethods.length ? ctx.payMethods : ['—'], lang);
  const T = {
    nl: {
      how: ['Hoe werkt de levering?', ctx.accountField
        ? `Je vult bij het afrekenen je ${ctx.accountField} in; we zetten het daarop. We vragen nooit je wachtwoord.`
        : 'Je krijgt een code per e-mail, met de stappen om hem in te wisselen. Wat op voorraad staat gaat automatisch de deur uit, de rest met de hand — overdag meestal binnen een paar uur.'],
      pay: ['Hoe betaal ik?', `Je plaatst eerst je bestelling en betaalt daarna met ${pay}, met je bestelnummer als omschrijving. Er wordt niets automatisch afgeschreven.`],
      refund: ['Wat als het niet geleverd wordt?', 'Dan krijg je je geld volledig terug. Zolang je bestelling niet geleverd is, kun je hem ook annuleren.'],
      account: ['Heb ik een account nodig?', 'Nee, je kunt als gast bestellen en je bestelling volgen met de link in je bevestigingsmail.'],
      platform: [`Werkt dit op elk platform?`, `Nee: deze producten werken alleen op ${ctx.platformName}. Controleer je platform voordat je koopt.`],
      region: ['Werkt het in mijn land?', `Kijk naar de regio op het product (${join(ctx.regions, lang)}). Je account moet uit dezelfde regio komen.`],
      choose: ['Welk bedrag kies ik?', `Er zijn ${ctx.count} opties, van ${eur(ctx.min, lang)} tot ${eur(ctx.max, lang)}.${ctx.perThousand ? ' Op elk product zie je de prijs per 1.000.' : ''}`],
    },
    en: {
      how: ['How is it delivered?', ctx.accountField
        ? `You enter your ${ctx.accountField} at checkout and we add it to that account. We never ask for your password.`
        : 'You receive a code by email, with the steps to redeem it. In stock goes out automatically, the rest by hand — during the day usually within a few hours.'],
      pay: ['How do I pay?', `You place your order first and then pay with ${pay}, using your order number as the reference. Nothing is charged automatically.`],
      refund: ['What if it is not delivered?', 'Then you get your money back in full. Until your order is delivered you can also cancel it.'],
      account: ['Do I need an account?', 'No, you can order as a guest and follow your order with the link in your confirmation email.'],
      platform: ['Does this work on every platform?', `No: these products only work on ${ctx.platformName}. Check your platform before you buy.`],
      region: ['Does it work in my country?', `Check the region on the product (${join(ctx.regions, lang)}). Your account has to be from the same region.`],
      choose: ['Which amount should I pick?', `There are ${ctx.count} options, from ${eur(ctx.min, lang)} to ${eur(ctx.max, lang)}.${ctx.perThousand ? ' Every product shows its price per 1,000.' : ''}`],
    },
    de: {
      how: ['Wie wird geliefert?', ctx.accountField
        ? `Du gibst beim Bezahlen deinen ${ctx.accountField} an, und wir buchen es auf dieses Konto. Nach deinem Passwort fragen wir nie.`
        : 'Du bekommst einen Code per E-Mail, mit den Schritten zum Einlösen. Was auf Lager ist, geht automatisch raus, der Rest von Hand — tagsüber meist innerhalb weniger Stunden.'],
      pay: ['Wie bezahle ich?', `Du gibst zuerst deine Bestellung auf und bezahlst dann mit ${pay}, mit deiner Bestellnummer als Verwendungszweck. Nichts wird automatisch abgebucht.`],
      refund: ['Was, wenn nicht geliefert wird?', 'Dann bekommst du dein Geld vollständig zurück. Solange deine Bestellung nicht geliefert ist, kannst du sie auch stornieren.'],
      account: ['Brauche ich ein Konto?', 'Nein, du kannst als Gast bestellen und deine Bestellung über den Link in deiner Bestätigungsmail verfolgen.'],
      platform: ['Funktioniert das auf jeder Plattform?', `Nein: Diese Produkte funktionieren nur auf ${ctx.platformName}. Prüfe deine Plattform vor dem Kauf.`],
      region: ['Funktioniert es in meinem Land?', `Achte auf die Region beim Produkt (${join(ctx.regions, lang)}). Dein Konto muss aus derselben Region sein.`],
      choose: ['Welchen Betrag wähle ich?', `Es gibt ${ctx.count} Optionen, von ${eur(ctx.min, lang)} bis ${eur(ctx.max, lang)}.${ctx.perThousand ? ' Jedes Produkt zeigt den Preis pro 1.000.' : ''}`],
    },
    fr: {
      how: ['Comment se passe la livraison ?', ctx.accountField
        ? `Tu indiques ton ${ctx.accountField} au paiement et nous créditons ce compte. Nous ne demandons jamais ton mot de passe.`
        : 'Tu reçois un code par e-mail, avec les étapes pour l’utiliser. Ce qui est en stock part automatiquement, le reste à la main — en journée, en général en quelques heures.'],
      pay: ['Comment je paie ?', `Tu passes d’abord ta commande, puis tu paies avec ${pay}, avec ton numéro de commande comme référence. Rien n’est prélevé automatiquement.`],
      refund: ['Et si ce n’est pas livré ?', 'Tu es remboursé intégralement. Tant que ta commande n’est pas livrée, tu peux aussi l’annuler.'],
      account: ['Ai-je besoin d’un compte ?', 'Non, tu peux commander en invité et suivre ta commande avec le lien de ton e-mail de confirmation.'],
      platform: ['Est-ce que ça marche sur toutes les plateformes ?', `Non : ces produits ne fonctionnent que sur ${ctx.platformName}. Vérifie ta plateforme avant d’acheter.`],
      region: ['Est-ce que ça marche dans mon pays ?', `Regarde la région indiquée sur le produit (${join(ctx.regions, lang)}). Ton compte doit être de la même région.`],
      choose: ['Quel montant choisir ?', `Il y a ${ctx.count} options, de ${eur(ctx.min, lang)} à ${eur(ctx.max, lang)}.${ctx.perThousand ? ' Chaque produit indique son prix pour 1 000.' : ''}`],
    },
  }[lang];
  const out = [T.choose, T.how, T.pay];
  if (kind === 'platform' && ctx.platformName) out.push(T.platform);
  if (ctx.regions.length) out.push(T.region);
  out.push(T.refund, T.account);
  return out.map(([q, a]) => ({ q, a }));
}

/* ── Titles and descriptions ────────────────────────────────────────────── */
const COPY = {
  game: {
    nl: (c) => ({ title: `${c.unit} kopen voor ${c.name} · ${c.count} pakketten`, h1: `${c.unit} kopen`,
      description: `${c.unit} voor ${c.name}: ${c.count} pakketten van ${eur(c.min)} tot ${eur(c.max)}. Betaal na het bestellen met ${or(c.payMethods, 'nl')}; niet geleverd = geld terug.`,
      intro: `Alle ${c.unit}-pakketten voor ${c.name} op een rij, met de prijs per pakket.` }),
    en: (c) => ({ title: `Buy ${c.unit} for ${c.name} · ${c.count} packs`, h1: `Buy ${c.unit}`,
      description: `${c.unit} for ${c.name}: ${c.count} packs from ${eur(c.min, 'en')} to ${eur(c.max, 'en')}. Pay after ordering with ${or(c.payMethods, 'en')}; not delivered = money back.`,
      intro: `Every ${c.unit} pack for ${c.name} in one place, with the price of each.` }),
    de: (c) => ({ title: `${c.unit} für ${c.name} kaufen · ${c.count} Pakete`, h1: `${c.unit} kaufen`,
      description: `${c.unit} für ${c.name}: ${c.count} Pakete von ${eur(c.min, 'de')} bis ${eur(c.max, 'de')}. Zahle nach der Bestellung mit ${or(c.payMethods, 'de')}; nicht geliefert = Geld zurück.`,
      intro: `Alle ${c.unit}-Pakete für ${c.name} auf einen Blick, mit dem Preis jedes Pakets.` }),
    fr: (c) => ({ title: `Acheter des ${c.unit} pour ${c.name} · ${c.count} packs`, h1: `Acheter des ${c.unit}`,
      description: `${c.unit} pour ${c.name} : ${c.count} packs de ${eur(c.min, 'fr')} à ${eur(c.max, 'fr')}. Paie après la commande avec ${or(c.payMethods, 'fr')} ; pas livré = remboursé.`,
      intro: `Tous les packs ${c.unit} pour ${c.name} au même endroit, avec le prix de chacun.` }),
  },
  giftcard: {
    nl: (c) => ({ title: `${c.name} giftcard kopen · ${c.amounts} · code per mail`, h1: `${c.name} giftcards`,
      description: `${c.name} tegoed: ${c.count} bedragen (${c.amounts}). De code komt per e-mail. Betaal na het bestellen met ${or(c.payMethods, 'nl')}.`,
      intro: `${c.name}-tegoed van ${c.amountWords.nl} als code per e-mail.` }),
    en: (c) => ({ title: `Buy ${c.name} gift cards · ${c.amounts} · code by email`, h1: `${c.name} gift cards`,
      description: `${c.name} credit: ${c.count} amounts (${c.amounts}). The code arrives by email. Pay after ordering with ${or(c.payMethods, 'en')}.`,
      intro: `${c.name} credit of ${c.amountWords.en} as a code by email.` }),
    de: (c) => ({ title: `${c.name} Guthabenkarte kaufen · ${c.amounts} · Code per Mail`, h1: `${c.name} Guthabenkarten`,
      description: `${c.name}-Guthaben: ${c.count} Beträge (${c.amounts}). Der Code kommt per E-Mail. Zahle nach der Bestellung mit ${or(c.payMethods, 'de')}.`,
      intro: `${c.name}-Guthaben über ${c.amountWords.de} als Code per E-Mail.` }),
    fr: (c) => ({ title: `Carte cadeau ${c.name} · ${c.amounts} · code par e-mail`, h1: `Cartes cadeaux ${c.name}`,
      description: `Crédit ${c.name} : ${c.count} montants (${c.amounts}). Le code arrive par e-mail. Paie après la commande avec ${or(c.payMethods, 'fr')}.`,
      intro: `Du crédit ${c.name} de ${c.amountWords.fr} sous forme de code par e-mail.` }),
  },
  platform: {
    nl: (c) => ({ title: `${c.name}: game-tegoed en giftcards · ${c.count} producten`, h1: `Voor ${c.name}`,
      description: `Alles voor ${c.name}: ${c.games}. ${c.count} producten, alleen te gebruiken op ${c.name}. Betaal na het bestellen met ${or(c.payMethods, 'nl')}.`,
      intro: `Alles in de winkel dat werkt op ${c.name}, op één plek.` }),
    en: (c) => ({ title: `${c.name}: game currency and gift cards · ${c.count} products`, h1: `For ${c.name}`,
      description: `Everything for ${c.name}: ${c.games}. ${c.count} products that work on ${c.name} only. Pay after ordering with ${or(c.payMethods, 'en')}.`,
      intro: `Everything in the shop that works on ${c.name}, in one place.` }),
    de: (c) => ({ title: `${c.name}: Spielwährung und Guthabenkarten · ${c.count} Produkte`, h1: `Für ${c.name}`,
      description: `Alles für ${c.name}: ${c.games}. ${c.count} Produkte, die nur auf ${c.name} funktionieren. Zahle nach der Bestellung mit ${or(c.payMethods, 'de')}.`,
      intro: `Alles im Shop, was auf ${c.name} funktioniert, an einem Ort.` }),
    fr: (c) => ({ title: `${c.name} : monnaie de jeu et cartes cadeaux · ${c.count} produits`, h1: `Pour ${c.name}`,
      description: `Tout pour ${c.name} : ${c.games}. ${c.count} produits qui fonctionnent uniquement sur ${c.name}. Paie après la commande avec ${or(c.payMethods, 'fr')}.`,
      intro: `Tout ce qui fonctionne sur ${c.name} dans la boutique, au même endroit.` }),
  },
  budget: {
    nl: (c) => ({ title: `Gamecadeau onder ${eur0(c.cap)} · ${c.count} ideeën`, h1: `Cadeau onder ${eur0(c.cap)}`,
      description: `${c.count} game-tegoeden en giftcards tot ${eur0(c.cap)}: ${c.games}. Een code als cadeau, niets te versturen.`,
      intro: `Game-tegoed en giftcards tot ${eur0(c.cap)} — handig als cadeau, want het is een code.` }),
    en: (c) => ({ title: `Gaming gifts under ${eur0(c.cap, 'en')} · ${c.count} ideas`, h1: `Gifts under ${eur0(c.cap, 'en')}`,
      description: `${c.count} game credits and gift cards up to ${eur0(c.cap, 'en')}: ${c.games}. A code as a gift, nothing to post.`,
      intro: `Game credit and gift cards up to ${eur0(c.cap, 'en')} — easy as a gift, because it is a code.` }),
    de: (c) => ({ title: `Gaming-Geschenke unter ${eur0(c.cap, 'de')} · ${c.count} Ideen`, h1: `Geschenke unter ${eur0(c.cap, 'de')}`,
      description: `${c.count} Spielguthaben und Guthabenkarten bis ${eur0(c.cap, 'de')}: ${c.games}. Ein Code als Geschenk, nichts zu verschicken.`,
      intro: `Spielguthaben und Guthabenkarten bis ${eur0(c.cap, 'de')} — praktisch als Geschenk, weil es ein Code ist.` }),
    fr: (c) => ({ title: `Cadeaux gaming à moins de ${eur0(c.cap, 'fr')} · ${c.count} idées`, h1: `Cadeaux à moins de ${eur0(c.cap, 'fr')}`,
      description: `${c.count} crédits de jeu et cartes cadeaux jusqu’à ${eur0(c.cap, 'fr')} : ${c.games}. Un code en cadeau, rien à envoyer.`,
      intro: `Du crédit de jeu et des cartes cadeaux jusqu’à ${eur0(c.cap, 'fr')} — pratique en cadeau, car c’est un code.` }),
  },
};

/* ── Keywords: what each page is written to answer ──────────────────────── */
const AMOUNT = /(\d{1,3}(?:[.,\s]\d{3})+|\d+)/;
export function keywordsFor(page) {
  const k = new Set();
  if (page.type === 'game') {
    const { unit, name } = page.subject;
    [`${unit} kopen`, `${name} ${unit}`, `${unit} code`, `${unit} tegoed`].forEach((x) => k.add(x.toLowerCase()));
    for (const p of page.products) { const m = AMOUNT.exec(p.name); if (m) k.add(`${m[1].replace(/[.,\s]/g, '')} ${unit}`.toLowerCase()); }
  } else if (page.type === 'giftcard') {
    const { name } = page.subject;
    [`${name} giftcard`, `${name} tegoed`, `${name} code`, `${name} kaart kopen`].forEach((x) => k.add(x.toLowerCase()));
    for (const p of page.products) { const m = /€\s?(\d+)/.exec(p.name); if (m) k.add(`${name} ${m[1]} euro`.toLowerCase()); }
  } else if (page.type === 'platform') {
    const { name } = page.subject;
    [`${name} tegoed`, `${name} giftcard`, `${name} game currency`].forEach((x) => k.add(x.toLowerCase()));
    for (const g of page.subject.gameUnits || []) k.add(`${g} ${name}`.toLowerCase());
  } else if (page.type === 'budget') {
    [`gamecadeau onder ${page.subject.cap / 100} euro`, `cadeau gamer onder ${page.subject.cap / 100} euro`].forEach((x) => k.add(x));
  }
  return [...k];
}

/* ── Building the pages ─────────────────────────────────────────────────── */
/**
 * @param products     active catalogue rows ({ id, name, price, category, metadata })
 * @param opts.landing paths of the hand-written landing pages, by category
 * @param opts.payMethods the labels of the payment methods the shop takes
 */
export function buildSeoPages(products, { landing = {}, payMethods = [] } = {}) {
  const active = (products || []).filter((p) => p && p.active !== false && Number(p.price) > 0);
  const pages = [];
  const priceRange = (list) => ({ min: Math.min(...list.map((p) => p.price)), max: Math.max(...list.map((p) => p.price)) });
  const base = (list) => ({ count: list.length, ...priceRange(list), payMethods,
    regions: [...new Set(list.map(regionOf).filter(Boolean))] });

  // Game pages: one per in-game currency with depth.
  for (const [cat, g] of Object.entries(GAMES)) {
    const list = active.filter((p) => p.category === cat);
    if (list.length < 2) continue;
    const ctx = { ...base(list), ...g, accountField: null, perThousand: true };
    pages.push({ type: 'game', key: cat, path: landing[cat] || `/games/${cat}`, handWritten: !!landing[cat],
      subject: { ...g, category: cat }, products: list, ctx, faqKind: 'game', deliveryCategory: cat });
  }
  // Gift-card brand pages.
  for (const b of BRANDS) {
    const list = active.filter((p) => brandOf(p)?.id === b.id);
    if (list.length < 2) continue;
    const amounts = [...new Set(list.map((p) => (/€\s?(\d+)/.exec(p.name) || [])[1]).filter(Boolean))]
      .sort((x, y) => x - y).map((a) => `€${a}`);
    const nums = amounts.map((a) => a.slice(1));
    const amountWords = Object.fromEntries(SEO_LANGS.map((l) => [l, `${join(nums, l)} euro`]));
    pages.push({ type: 'giftcard', key: b.id, path: `/giftcards/${b.id}`, subject: { ...b, re: undefined },
      products: list, ctx: { ...base(list), name: b.name, amounts: amounts.join(', ') || '—', amountWords, accountField: null },
      faqKind: 'giftcard', deliveryCategory: 'giftcard' });
  }
  // Platform pages: platform-bound products plus that platform's own store cards.
  for (const pf of PLATFORMS) {
    const list = active.filter((p) => platformOf(p)?.id === pf.id || brandOf(p)?.platform === pf.id
      || (pf.id === 'xbox' && p.category === 'gamepass'));
    if (list.length < 2) continue;
    const games = [...new Set(list.map((p) => (GAMES[p.category]?.unit) || brandOf(p)?.name).filter(Boolean))];
    pages.push({ type: 'platform', key: pf.id, path: `/platform/${pf.id}`, subject: { ...pf, gameUnits: games },
      products: list, ctx: { ...base(list), name: pf.name, platformName: pf.name, games: games.join(', '), accountField: null },
      faqKind: 'platform', deliveryCategory: null });
  }
  // Budget gift pages: codes under a price, where there is a real choice.
  for (const cap of BUDGETS) {
    const list = active.filter((p) => p.price <= cap && p.category !== 'mystery');
    if (list.length < 4) continue;
    const games = [...new Set(list.map((p) => GAMES[p.category]?.name || brandOf(p)?.name).filter(Boolean))].slice(0, 5);
    pages.push({ type: 'budget', key: `under-${cap / 100}`, path: `/cadeau/onder-${cap / 100}-euro`, subject: { cap },
      products: list, ctx: { ...base(list), cap, games: games.join(', '), accountField: null },
      faqKind: 'budget', deliveryCategory: null });
  }

  // Copy, FAQ and links per language.
  for (const page of pages) {
    page.copy = {}; page.faq = {};
    for (const lang of SEO_LANGS) {
      const ctx = { ...page.ctx, accountField: page.deliveryCategory ? deliveryField(page.deliveryCategory, lang) : null };
      const raw = COPY[page.type][lang](ctx);
      page.copy[lang] = { ...raw, title: clip(raw.title, 60), description: clip(raw.description, 155) };
      page.faq[lang] = faqFor(page.faqKind, ctx, lang);
    }
    page.keywords = keywordsFor(page);
  }
  // Internal links: related pages of the same platform or type, plus the hubs.
  for (const page of pages) {
    const pfs = new Set(page.products.map((p) => platformOf(p)?.id || brandOf(p)?.platform).filter(Boolean));
    const related = pages.filter((o) => o !== page && (
      (o.type === 'platform' && pfs.has(o.key))
      || (page.type === 'platform' && o.products.some((p) => page.products.includes(p)) && o.type !== 'budget')
      || (o.type === page.type && page.type !== 'budget')));
    page.links = [...new Map(related.map((o) => [o.path, { path: o.path, type: o.type, key: o.key }])).values()].slice(0, 8);
    page.hubs = [{ path: '/shop', key: 'shop' }, { path: page.type === 'giftcard' ? '/giftcards' : '/game-currency', key: page.type === 'giftcard' ? 'giftcards' : 'currency' }];
  }
  return pages;
}

/* ── Schema.org: CollectionPage + ItemList + BreadcrumbList + FAQPage ───── */
export function schemaFor(page, lang = 'nl', { siteUrl = SITE_URL, inStock = () => false } = {}) {
  const url = siteUrl + page.path;
  const c = page.copy[lang];
  return [
    { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': `${url}#page`, url, name: c.h1, description: c.description,
      inLanguage: lang, isPartOf: { '@id': `${siteUrl}/#website` },
      mainEntity: { '@type': 'ItemList', numberOfItems: page.products.length,
        itemListElement: page.products.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${siteUrl}/product/${p.id}`, name: p.name })) } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Shop', item: `${siteUrl}/shop` },
      { '@type': 'ListItem', position: 3, name: c.h1, item: url }] },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: page.faq[lang].map((f) => ({
      '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    // Offers for the cheapest and dearest, honest about stock — no rating, ever, without reviews.
    { '@context': 'https://schema.org', '@type': 'Product', name: c.h1, description: c.description,
      offers: { '@type': 'AggregateOffer', priceCurrency: 'EUR', offerCount: page.products.length,
        lowPrice: (page.ctx.min / 100).toFixed(2), highPrice: (page.ctx.max / 100).toFixed(2),
        availability: page.products.some(inStock) ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder' } },
  ];
}

/** Keywords the catalogue implies that no page (generated or hand-written) answers yet. */
export function missingKeywords(pages, products, { extraCovered = [] } = {}) {
  /* Per page: a keyword counts as answered when ONE page carries all its words
     — "steam 25 euro" is not answered by "steam" on one page and "25" on another. */
  const texts = [...pages.map((p) => SEO_LANGS.flatMap((l) => [p.copy[l].title, p.copy[l].h1, p.copy[l].description, p.copy[l].intro]).join(' ')),
    ...extraCovered].map((t) => t.toLowerCase());
  const covered = (kw) => texts.some((t) => kw.split(/\s+/).every((w) => t.includes(w)));
  const wanted = new Map();
  for (const p of products || []) {
    const g = GAMES[p.category]; const b = brandOf(p); const pf = platformOf(p);
    if (g) { wanted.set(`${g.unit} kopen`.toLowerCase(), g.name); if (pf) wanted.set(`${g.unit} ${pf.label}`.toLowerCase(), g.name); }
    if (b) { wanted.set(`${b.name} giftcard`.toLowerCase(), b.name); const m = /€\s?(\d+)/.exec(p.name); if (m) wanted.set(`${b.name} ${m[1]} euro`.toLowerCase(), b.name); }
  }
  return [...wanted.entries()].filter(([kw]) => !covered(kw)).map(([keyword, subject]) => ({ keyword, subject }));
}
