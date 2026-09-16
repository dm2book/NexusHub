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

/**
 * Every language the shop is read in.
 *
 * It was nl + en for a long time while the storefront itself had grown to four,
 * and the mismatch was not a missing translation — it was a crash. The widget's
 * whole chrome (title, greeting, buttons, the offline notice) already existed in
 * German and French, so a visitor on /de saw a fully German assistant; the
 * moment they typed, the browser posted `lang: "de"` and the endpoint rejected
 * it with a 400. The assistant was not worse in German, it was dead in German.
 */
const NL = 'nl';
const EN = 'en';
const DE = 'de';
const FR = 'fr';
export const CHAT_LANGS = [NL, EN, DE, FR];

/**
 * Language detection from the message itself, so the answer matches how the
 * question was asked even if the UI is in the other language.
 */
const MARKERS = {
  [NL]: [' hoe ', ' wat ', ' waar ', ' wanneer ', ' kan ik ', ' ik ', ' mijn ', ' niet ', ' geld ',
    ' betaal', ' bestell', ' levering', ' duurt', ' snel', ' veilig', ' terug', ' hallo', ' hoi', ' doei',
    ' bedankt', ' dank', ' waarom', ' welke', ' goedkoop', ' krijg', ' heb ', ' met ', ' voor ', ' euro'],
  [EN]: [' how ', ' what ', ' where ', ' when ', ' can i ', ' my ', ' the ', ' is it ', ' does ',
    ' delivery', ' payment', ' refund', ' order', ' safe', ' thanks', ' hello', ' cheap', ' price'],
  [DE]: [' wie ', ' was ', ' wo ', ' wann ', ' kann ich ', ' ich ', ' mein', ' nicht ', ' geld ',
    ' bezahl', ' bestell', ' lieferung', ' liefer', ' dauert', ' schnell', ' sicher', ' zurück', ' hallo',
    ' danke', ' warum', ' welche', ' günstig', ' billig', ' bekomme', ' habt ihr ', ' für ', ' euro'],
  [FR]: [' comment ', ' quoi ', ' où ', ' quand ', ' je ', ' mon ', ' ma ', ' mes ', ' pas ', ' argent ',
    ' payer', ' paiement', ' commande', ' livraison', ' livrer', ' combien ', ' rapide', ' sûr', ' fiable',
    ' remboursement', ' bonjour', ' salut ', ' merci', ' pourquoi', ' quel', ' pas cher', ' prix', ' euros'],
};

/**
 * Language detection from the message itself, so the answer matches how the
 * question was asked even if the UI is in another language.
 *
 * Ties fall back to the UI language rather than to a winner-by-list-order:
 * "Robux?" carries no marker at all, and on /fr it should not come back
 * in English just because English is first.
 */
export function detectLang(text, fallback = EN) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const score = (list) => list.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  const scores = CHAT_LANGS.map((l) => [l, score(MARKERS[l])]);
  const best = Math.max(...scores.map(([, n]) => n));
  const winners = scores.filter(([, n]) => n === best).map(([l]) => l);
  if (best === 0 || winners.length > 1) return CHAT_LANGS.includes(fallback) ? fallback : EN;
  return winners[0];
}

/** An order number, in the shape the store issues them. */
export const ORDER_RE = /\bFM-\d{4}-[A-Z0-9]{4,}\b/i;

/**
 * How each category is redeemed. Mirrors the delivery email exactly — a buyer
 * must never get two different answers to "how do I use this?".
 */
const REDEEM = {
  robux: { nl: 'Robux wissel je in op **roblox.com/redeem**: inloggen, code plakken, klaar. Ze komen op het account waarmee je bent ingelogd — check dus dat dat de juiste is.',
    en: 'Redeem Robux at **roblox.com/redeem**: sign in, paste the code, done. They land on the account you are signed in to — double-check it is the right one.',
    de: 'Robux löst du auf **roblox.com/redeem** ein: einloggen, Code einfügen, fertig. Sie landen auf dem Account, mit dem du eingeloggt bist — prüf also, dass es der richtige ist.',
    fr: 'Les Robux se récupèrent sur **roblox.com/redeem** : connecte-toi, colle le code, c’est fait. Ils arrivent sur le compte avec lequel tu es connecté — vérifie donc que c’est le bon.' },
  'v-bucks': { nl: 'V-Bucks wissel je in op **fortnite.com/vbuckscard** met je Epic-account. Ze werken daarna op elk platform van dat account.',
    en: 'Redeem V-Bucks at **fortnite.com/vbuckscard** with your Epic account. They then work on every platform on that account.',
    de: 'V-Bucks löst du auf **fortnite.com/vbuckscard** mit deinem Epic-Account ein. Danach gelten sie auf jeder Plattform dieses Accounts.',
    fr: 'Les V-Bucks se récupèrent sur **fortnite.com/vbuckscard** avec ton compte Epic. Ils fonctionnent ensuite sur toutes les plateformes de ce compte.' },
  valorant: { nl: 'Valorant Points wissel je in in de game: open de **Store** en kies **Redeem code**.',
    en: 'Redeem Valorant Points in-game: open the **Store** and choose **Redeem code**.',
    de: 'Valorant Points löst du im Spiel ein: **Store** öffnen und **Redeem code** wählen.',
    fr: 'Les Valorant Points se récupèrent dans le jeu : ouvre la **Boutique** et choisis **Redeem code**.' },
  'discord-nitro': { nl: 'Nitro activeer je op **discord.com/billing/promotions** terwijl je ingelogd bent.',
    en: 'Activate Nitro at **discord.com/billing/promotions** while signed in.',
    de: 'Nitro aktivierst du auf **discord.com/billing/promotions**, während du eingeloggt bist.',
    fr: 'Nitro s’active sur **discord.com/billing/promotions** pendant que tu es connecté.' },
  giftcard: { nl: 'Een gift card wissel je in bij de winkel zelf (Steam, PlayStation, Xbox): inloggen, **Code inwisselen** of **Tegoed toevoegen**, code plakken. Het saldo blijft daarna op dat account.',
    en: 'Redeem a gift card at the store it belongs to (Steam, PlayStation, Xbox): sign in, find **Redeem code** / **Add funds**, paste it. The balance stays on that account.',
    de: 'Eine Guthabenkarte löst du im jeweiligen Shop selbst ein (Steam, PlayStation, Xbox): einloggen, **Code einlösen** bzw. **Guthaben aufladen**, Code einfügen. Das Guthaben bleibt danach auf diesem Account.',
    fr: 'Une carte cadeau se récupère dans la boutique concernée (Steam, PlayStation, Xbox) : connecte-toi, cherche **Utiliser un code** / **Ajouter des fonds**, colle le code. Le solde reste ensuite sur ce compte.' },
  gamepass: { nl: 'Game Pass activeer je op **redeem.microsoft.com** met je Microsoft-account.',
    en: 'Activate Game Pass at **redeem.microsoft.com** with your Microsoft account.',
    de: 'Game Pass aktivierst du auf **redeem.microsoft.com** mit deinem Microsoft-Konto.',
    fr: 'Le Game Pass s’active sur **redeem.microsoft.com** avec ton compte Microsoft.' },
  spotify: { nl: 'Spotify-codes wissel je in op **spotify.com/redeem**.',
    en: 'Redeem Spotify codes at **spotify.com/redeem**.',
    de: 'Spotify-Codes löst du auf **spotify.com/redeem** ein.',
    fr: 'Les codes Spotify se récupèrent sur **spotify.com/redeem**.' },
  minecraft: { nl: 'Minecraft-codes wissel je in op **minecraft.net/redeem**.',
    en: 'Redeem Minecraft codes at **minecraft.net/redeem**.',
    de: 'Minecraft-Codes löst du auf **minecraft.net/redeem** ein.',
    fr: 'Les codes Minecraft se récupèrent sur **minecraft.net/redeem**.' },
};

const T = {
  delivery: {
    nl: 'Zit het op voorraad, dan gaat je code **automatisch** de deur uit zodra we je betaling bevestigen. Staat het niet op voorraad, dan kopen we het voor je in en leveren we met de hand — meestal binnen een paar uur overdag. Je code komt altijd binnen op het mailadres dat je bij het bestellen opgeeft.',
    en: 'If it is in stock your code goes out **automatically** as soon as we confirm your payment. If it is not, we buy it in for you and deliver by hand — usually within a few hours during the day. Either way the code arrives at the email you used at checkout.',
    de: 'Ist der Artikel auf Lager, geht dein Code **automatisch** raus, sobald wir deine Zahlung bestätigt haben. Ist er es nicht, kaufen wir ihn für dich ein und liefern von Hand — tagsüber meist innerhalb weniger Stunden. In beiden Fällen kommt der Code an die E-Mail-Adresse, die du bei der Bestellung angegeben hast.',
    fr: 'Si l’article est en stock, ton code part **automatiquement** dès que nous confirmons ton paiement. Sinon, nous l’achetons pour toi et le livrons à la main — en journée, généralement en quelques heures. Dans les deux cas, le code arrive à l’adresse e-mail utilisée lors de la commande.',
  },
  payment: {
    nl: 'Je plaatst eerst je bestelling. Daarna zie je het bedrag en een **referentie** (je bestelnummer). Betaal met die referentie erbij — zo koppelen we jouw betaling aan jouw bestelling. Wij bevestigen elke betaling met de hand, meestal binnen een paar minuten overdag. Geen creditcard-checkout dus, en geen verborgen kosten.',
    en: 'You place the order first. Then you see the amount and a **reference** (your order number). Pay with that reference in the description — that is how we match your payment to your order. We confirm every payment by hand, usually within minutes during the day. No card checkout, and no hidden fees.',
    de: 'Du gibst zuerst die Bestellung auf. Danach siehst du den Betrag und einen **Verwendungszweck** (deine Bestellnummer). Überweise mit diesem Verwendungszweck — so ordnen wir deine Zahlung deiner Bestellung zu. Wir bestätigen jede Zahlung von Hand, tagsüber meist innerhalb von Minuten. Also keine Kartenzahlung an der Kasse und keine versteckten Kosten.',
    fr: 'Tu passes d’abord la commande. Ensuite tu vois le montant et une **référence** (ton numéro de commande). Paie en indiquant cette référence — c’est ainsi que nous relions ton paiement à ta commande. Nous confirmons chaque paiement à la main, en journée généralement en quelques minutes. Donc pas de paiement par carte à la caisse, et aucun frais caché.',
  },
  refund: {
    nl: 'Komt je bestelling niet aan, dan krijg je je geld terug. Open een ticket in onze Discord met je bestelnummer, of mail terug op je bestelbevestiging. Een terugbetaling staat meestal binnen 1–3 werkdagen op de rekening waarmee je betaalde.',
    en: 'If your order never arrives you get your money back. Open a ticket in our Discord with your order number, or reply to your order confirmation email. A refund is usually back within 1–3 working days, on the account you paid from.',
    de: 'Kommt deine Bestellung nicht an, bekommst du dein Geld zurück. Öffne ein Ticket in unserem Discord mit deiner Bestellnummer oder antworte einfach auf deine Bestellbestätigung. Eine Rückzahlung ist meist innerhalb von 1–3 Werktagen wieder auf dem Konto, von dem du bezahlt hast.',
    fr: 'Si ta commande n’arrive jamais, tu es remboursé. Ouvre un ticket sur notre Discord avec ton numéro de commande, ou réponds simplement à ton e-mail de confirmation. Un remboursement revient généralement sous 1 à 3 jours ouvrés, sur le compte depuis lequel tu as payé.',
  },
  safety: {
    nl: 'Eerlijk antwoord: we zijn een kleine Nederlandse winkel, geen groot bedrijf. Wat we je wél geven: je geld terug als er niets aankomt, reviews die aan echte bestellingen hangen, en een mens dat antwoordt op Discord. Let op: wij **DM\'en je nooit als eerste** en vragen nooit om je wachtwoord.',
    en: 'Honest answer: we are a small Dutch shop, not a big company. What you do get: your money back if nothing arrives, reviews tied to real orders, and a human answering on Discord. Note: we **never DM you first** and never ask for your password.',
    de: 'Ehrliche Antwort: wir sind ein kleiner niederländischer Shop, keine große Firma. Was du trotzdem bekommst: dein Geld zurück, wenn nichts ankommt, Bewertungen, die an echte Bestellungen gebunden sind, und einen Menschen, der auf Discord antwortet. Wichtig: wir **schreiben dich nie zuerst per DM an** und fragen nie nach deinem Passwort.',
    fr: 'Réponse honnête : nous sommes une petite boutique néerlandaise, pas une grande entreprise. Ce que tu as quand même : ton argent rendu si rien n’arrive, des avis liés à de vraies commandes, et une personne qui répond sur Discord. À savoir : nous ne **t’écrivons jamais en premier en DM** et ne demandons jamais ton mot de passe.',
  },
  account: {
    nl: 'Je hebt **geen account nodig** om te bestellen. Wil je er toch een, dan gaat inloggen zonder wachtwoord: je vult je e-mail in en krijgt een code van 6 cijfers.',
    en: 'You do **not need an account** to order. If you want one, sign-in is passwordless: enter your email and we send a 6-digit code.',
    de: 'Du brauchst **kein Konto**, um zu bestellen. Willst du trotzdem eins, läuft die Anmeldung ohne Passwort: E-Mail eingeben, und du bekommst einen 6-stelligen Code.',
    fr: 'Tu n’as **pas besoin de compte** pour commander. Si tu en veux un, la connexion se fait sans mot de passe : tu saisis ton e-mail et tu reçois un code à 6 chiffres.',
  },
  track: {
    nl: 'Plak je bestelnummer hier (het ziet eruit als FM-2026-XXXXXXXX) en ik zoek de status voor je op. Of open de pagina Bestelling volgen — daar hoef je ook niet voor in te loggen.',
    en: 'Paste your order number here (it looks like FM-2026-XXXXXXXX) and I will look up the status. Or open the Track Order page — no login needed for that either.',
    de: 'Füg deine Bestellnummer hier ein (sie sieht aus wie FM-2026-XXXXXXXX), dann sehe ich den Status für dich nach. Oder öffne die Seite „Bestellung verfolgen“ — dafür brauchst du ebenfalls kein Konto.',
    fr: 'Colle ton numéro de commande ici (il ressemble à FM-2026-XXXXXXXX) et je regarde le statut pour toi. Ou ouvre la page « Suivre ma commande » — là non plus, pas besoin de compte.',
  },
  discord: {
    nl: 'Op onze Discord zit de support, drops en giveaways. Een echt mens leest je ticket — geen bot.',
    en: 'Our Discord has support, drops and giveaways. A real person reads your ticket — not a bot.',
    de: 'Auf unserem Discord gibt es Support, Drops und Giveaways. Dein Ticket liest ein echter Mensch — kein Bot.',
    fr: 'Sur notre Discord, tu trouves le support, les drops et les giveaways. Ton ticket est lu par une vraie personne — pas par un bot.',
  },
  greeting: {
    nl: 'Hoi! 👋 Vraag me gerust naar prijzen, levertijd, betalen of je bestelling. Noem een game en ik zoek de pakketten erbij.',
    en: 'Hey! 👋 Ask me about prices, delivery, paying or your order. Name a game and I will pull up the packs.',
    de: 'Hi! 👋 Frag mich nach Preisen, Lieferzeit, Bezahlen oder deiner Bestellung. Nenn ein Spiel, dann hole ich die passenden Pakete raus.',
    fr: 'Salut ! 👋 Demande-moi les prix, les délais, le paiement ou ta commande. Nomme un jeu et je sors les packs correspondants.',
  },
  thanks: { nl: 'Graag gedaan! 💜', en: 'Anytime! 💜', de: 'Gern geschehen! 💜', fr: 'Avec plaisir ! 💜' },
  fallback: {
    nl: 'Daar weet ik zo geen goed antwoord op. Ik kan wel helpen met prijzen, levertijd, betalen, terugbetalingen en de status van je bestelling. Kom je er niet uit? Stel je vraag op onze Discord — daar antwoordt een mens.',
    en: 'I do not have a good answer for that one. I can help with prices, delivery, paying, refunds and your order status. Still stuck? Ask on our Discord — a human answers there.',
    de: 'Darauf habe ich keine gute Antwort. Bei Preisen, Lieferzeit, Bezahlen, Rückzahlungen und dem Status deiner Bestellung kann ich dir helfen. Kommst du nicht weiter? Frag auf unserem Discord — dort antwortet ein Mensch.',
    fr: 'Là, je n’ai pas de bonne réponse. Je peux t’aider sur les prix, les délais, le paiement, les remboursements et le statut de ta commande. Toujours bloqué ? Demande sur notre Discord — une personne y répond.',
  },
  noMatch: {
    nl: 'Dat product vind ik niet in de winkel. Bekijk de hele catalogus, of noem de game (bijvoorbeeld "Robux" of "V-Bucks").',
    en: 'I cannot find that product in the shop. Browse the full catalogue, or name the game (for example "Robux" or "V-Bucks").',
    de: 'Dieses Produkt finde ich im Shop nicht. Schau dir den ganzen Katalog an oder nenn das Spiel (zum Beispiel „Robux“ oder „V-Bucks“).',
    fr: 'Je ne trouve pas ce produit dans la boutique. Parcours tout le catalogue, ou nomme le jeu (par exemple « Robux » ou « V-Bucks »).',
  },
  orderNotFound: {
    nl: 'Dat bestelnummer ken ik niet. Check of hij klopt (FM-2026-XXXXXXXX) — hij staat in je bevestigingsmail. Klopt het wel? Open dan een ticket op Discord, dan zoeken we het uit.',
    en: 'I do not know that order number. Check it against your confirmation email (FM-2026-XXXXXXXX). Sure it is right? Open a ticket on Discord and we will find it.',
    de: 'Diese Bestellnummer kenne ich nicht. Vergleich sie mit deiner Bestätigungsmail (FM-2026-XXXXXXXX). Sicher, dass sie stimmt? Öffne ein Ticket auf Discord, dann finden wir sie.',
    fr: 'Je ne connais pas ce numéro de commande. Compare-le avec ton e-mail de confirmation (FM-2026-XXXXXXXX). Tu es sûr qu’il est correct ? Ouvre un ticket sur Discord et nous le retrouverons.',
  },
};

/** Buyer-facing meaning of each order status. Same wording as the Discord bot. */
const STATUS = {
  pending: { nl: '⏳ We wachten nog op je betaling. Betaal met je bestelnummer als referentie — de status springt vanzelf om.',
    en: '⏳ We are still waiting for your payment. Pay with your order number as the reference — the status flips by itself.',
    de: '⏳ Wir warten noch auf deine Zahlung. Überweise mit deiner Bestellnummer als Verwendungszweck — der Status springt dann von selbst um.',
    fr: '⏳ Nous attendons encore ton paiement. Paie en indiquant ton numéro de commande comme référence — le statut change tout seul.' },
  payment_received: { nl: '✅ Je betaling is bevestigd. Je hoeft niets meer te doen; we maken je bestelling klaar.',
    en: '✅ Your payment is confirmed. Nothing left for you to do; we are preparing your order.',
    de: '✅ Deine Zahlung ist bestätigt. Für dich gibt es nichts mehr zu tun; wir machen deine Bestellung fertig.',
    fr: '✅ Ton paiement est confirmé. Tu n’as plus rien à faire ; nous préparons ta commande.' },
  processing: { nl: '🔧 We zijn je bestelling nu aan het klaarmaken.', en: '🔧 We are preparing your order right now.',
    de: '🔧 Wir machen deine Bestellung gerade fertig.', fr: '🔧 Nous préparons ta commande en ce moment.' },
  awaiting_fulfillment: { nl: '📦 Betaald en in de wachtrij voor levering.', en: '📦 Paid and queued for delivery.',
    de: '📦 Bezahlt und in der Warteschlange für die Lieferung.', fr: '📦 Payée et en file d’attente pour la livraison.' },
  completed: { nl: '🎉 Geleverd! Je code is gemaild naar het adres van je bestelling. Niets gekregen? Check spam en open anders een ticket.',
    en: '🎉 Delivered! Your code was emailed to the address on the order. Nothing there? Check spam, then open a ticket.',
    de: '🎉 Geliefert! Dein Code ging per Mail an die Adresse auf der Bestellung. Nichts da? Schau in den Spam und öffne sonst ein Ticket.',
    fr: '🎉 Livrée ! Ton code a été envoyé à l’adresse e-mail de la commande. Rien reçu ? Regarde dans les spams, puis ouvre un ticket.' },
  refunded: { nl: '↩️ Deze bestelling is terugbetaald — meestal 1–3 werkdagen op je rekening.',
    en: '↩️ This order was refunded — usually 1–3 working days back on your account.',
    de: '↩️ Diese Bestellung wurde zurückerstattet — meist in 1–3 Werktagen wieder auf deinem Konto.',
    fr: '↩️ Cette commande a été remboursée — généralement sous 1 à 3 jours ouvrés sur ton compte.' },
  cancelled: { nl: '✖️ Deze bestelling is geannuleerd. Klopt dat niet? Open een ticket.',
    en: '✖️ This order was cancelled. Think that is wrong? Open a ticket.',
    de: '✖️ Diese Bestellung wurde storniert. Stimmt das nicht? Öffne ein Ticket.',
    fr: '✖️ Cette commande a été annulée. Tu penses que c’est une erreur ? Ouvre un ticket.' },
  failed: { nl: '⚠️ Er ging iets mis met deze bestelling. Open een ticket, dan lossen we het op.',
    en: '⚠️ Something went wrong with this order. Open a ticket and we will sort it out.',
    de: '⚠️ Bei dieser Bestellung ist etwas schiefgelaufen. Öffne ein Ticket, dann klären wir das.',
    fr: '⚠️ Quelque chose s’est mal passé avec cette commande. Ouvre un ticket et nous réglons ça.' },
};

/** The two sentences that wrap a list of live catalog hits. */
const FOUND = {
  lead: {
    nl: 'Dit heb ik voor je gevonden:', en: 'Here is what I found:',
    de: 'Das habe ich für dich gefunden:', fr: 'Voici ce que j’ai trouvé :',
  },
  inStock: {
    nl: 'Groen vinkje = op voorraad, gaat automatisch de deur uit zodra je betaling bevestigd is.',
    en: 'In stock — sent automatically once your payment is confirmed.',
    de: 'Auf Lager — geht automatisch raus, sobald deine Zahlung bestätigt ist.',
    fr: 'En stock — envoyé automatiquement dès que ton paiement est confirmé.',
  },
  byHand: {
    nl: 'Deze koop ik voor je in en lever ik met de hand, meestal binnen een paar uur.',
    en: 'These we buy in and deliver by hand, usually within a few hours.',
    de: 'Die kaufen wir für dich ein und liefern von Hand, meist innerhalb weniger Stunden.',
    fr: 'Ceux-là, nous les achetons pour toi et les livrons à la main, généralement en quelques heures.',
  },
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
  const lang = detectLang(raw, CHAT_LANGS.includes(uiLang) ? uiLang : EN);
  // Every table below carries all four languages, and a test asserts it — but a
  // missing key must still degrade to a sentence rather than to `undefined`
  // being shown to a visitor as the assistant's answer.
  const say = (key) => ({ text: T[key][lang] || T[key][EN] });

  if (!raw) return say('greeting');

  // 1. An order number beats every other intent: it is the most specific thing
  //    a visitor can type, and it is always about "where is my stuff".
  const num = raw.match(ORDER_RE)?.[0]?.toUpperCase();
  if (num && lookupOrder) {
    const order = await lookupOrder(num).catch(() => null);
    if (!order) return { ...say('orderNotFound'), actions: ['discord'] };
    const s = STATUS[order.status] || Object.fromEntries(CHAT_LANGS.map((l) => [l, order.statusLabel]));
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
    'code gebruik', 'gebruik ik mijn code', 'use my code', 'waar vul ik', 'invoeren', 'waar voer ik',
    'einlös', 'einlos', 'aktivier', 'code benutz', 'wo gebe ich', 'wo eingeben',
    'utiliser mon code', 'utiliser le code', 'activer', 'récupér', 'recuper', 'échanger', 'echanger', 'où saisir')) {
    const cat = matchCategory(t, products);
    const r = REDEEM[cat];
    if (r) return { text: r[lang], actions: ['shop'] };
  }

  // 3. Product / price questions — answered from the live catalog, never guessed.
  // German and French keep their money words explicit ('kostet', 'ça coûte')
  // rather than the bare question words: 'wie viel' and 'combien' also open
  // "wie lange dauert" and "combien de temps", and a delivery question answered
  // with "I cannot find that product" is the worst reply on this list.
  const wantsProduct = has(t, 'price', 'prijs', 'kost', 'cost', 'hoeveel', 'how much', 'cheap', 'goedkoop',
    'recommend', 'aanraden', 'welke', 'which', 'buy', 'kopen', 'verkoop', 'sell', 'heb je', 'do you have',
    'pakket', 'pack', 'voorraad', 'stock', 'available', 'beschikbaar',
    'preis', 'kostet', 'günstig', 'gunstig', 'billig', 'empfehl', 'kaufen', 'habt ihr', 'auf lager', 'verfügbar', 'verfugbar',
    'prix', 'coûte', 'coute', 'pas cher', 'recommand', 'conseill', 'acheter', 'avez-vous', 'vous avez', 'dispo');
  const matches = findProducts(t, products);
  const showProducts = () => {
    const picks = matches.slice(0, 3);
    const availability = (picks.some((p) => p.instant) ? FOUND.inStock : FOUND.byHand)[lang] || FOUND.byHand[EN];
    return {
      text: `${(FOUND.lead[lang] || FOUND.lead[EN])}\n\n${availability}`,
      products: picks.map((p) => ({
        id: p.id, name: p.name, category: p.category || null,
        price: p.price, currency: p.currency,
        image: p.image, instant: !!p.instant, stockLeft: p.stockLeft ?? null,
      })),
    };
  };
  if (matches.length && wantsProduct) return showProducts();
  if (wantsProduct && !matches.length && products.length) return { ...say('noMatch'), actions: ['shop'] };

  // 4. The standing questions, in either language.
  if (has(t, 'deliver', 'levering', 'leveren', 'duurt', 'hoe lang', 'how long', 'how fast', 'snel', 'wanneer krijg', 'when do i get', 'instant',
    'lieferung', 'liefer', 'dauert', 'wie lange', 'wann bekomme', 'wann kommt', 'sofort',
    'livraison', 'livrer', 'combien de temps', 'délai', 'delai', 'quand est-ce', 'quand je reçois', 'immédiat')) {
    return { ...say('delivery'), actions: ['how'] };
  }
  if (has(t, 'pay', 'betaal', 'betalen', 'ideal', 'tikkie', 'paypal', 'card', 'kaart', 'creditcard', 'overmaken', 'payment',
    'bezahl', 'zahlung', 'überweis', 'uberweis', 'karte',
    'payer', 'paiement', 'paie', 'carte', 'virement')) {
    return { ...say('payment'), actions: ['how'] };
  }
  if (has(t, 'refund', 'terugbetaling', 'geld terug', 'money back', 'niet aangekomen', 'not received', 'niks gekregen', 'kwijt',
    'rückerstattung', 'ruckerstattung', 'zurückerstatt', 'nicht angekommen', 'nichts bekommen',
    'rembours', 'pas reçu', 'pas recu', 'rien reçu', 'jamais reçu')) {
    return { ...say('refund'), actions: ['discord', 'track'] };
  }
  if (has(t, 'safe', 'legit', 'scam', 'oplicht', 'betrouwbaar', 'veilig', 'nep', 'trust', 'vertrouw',
    'seriös', 'serios', 'betrug', 'abzocke', 'vertrauen', 'sicher', 'echt?',
    'fiable', 'arnaque', 'confiance', 'légitime', 'legitime', 'escroquerie')) {
    return { ...say('safety'), actions: ['reviews', 'discord'] };
  }
  if (has(t, 'track', 'status', 'bestelling', 'order', 'waar is mijn', 'where is my',
    'bestellung', 'bestellnummer', 'wo ist meine',
    'commande', 'suivi', 'suivre', 'où est ma', 'ou est ma')) {
    return { ...say('track'), actions: ['track'] };
  }
  if (has(t, 'account', 'login', 'log in', 'inloggen', 'wachtwoord', 'password', 'sign in', 'registreren',
    'konto', 'anmelden', 'passwort', 'registrieren',
    'compte', 'connexion', 'me connecter', 'mot de passe', "m'inscrire", 'inscription')) {
    return { ...say('account'), actions: ['shop'] };
  }
  if (has(t, 'discord', 'community', 'giveaway', 'support', 'help me', 'contact', 'ticket')) {
    return { ...say('discord'), actions: ['discord'] };
  }
  if (has(t, 'hoi', 'hallo', 'hey', 'hi ', 'hello', 'yo ', 'goedemorgen', 'goedemiddag',
    'guten tag', 'guten morgen', 'moin', 'servus', 'bonjour', 'salut', 'coucou', 'bonsoir')
    || t === 'hi' || t === 'hey') {
    return say('greeting');
  }
  if (has(t, 'thank', 'bedankt', 'dank je', 'dankje', 'thx', 'danke', 'merci')) return say('thanks');

  // A bare product or game name, with no question around it, is the most common
  // thing anyone types into a shop's chat — and it used to land here, on
  // "I do not have a good answer for that one". It only ever worked by accident:
  // the old rule showed matches without a price word if there were four or
  // fewer of them, so "fortnite" listed its packs and "Robux" — the single
  // best-selling thing in the shop, with more packs than that — did not.
  // Shown last on purpose: "Robux niet aangekomen" is a refund question that
  // happens to name a product, and the intents above still get it first.
  if (matches.length) return showProducts();

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
const QUICK = {
  nl: ['Hoe lang duurt levering?', 'Hoe betaal ik?', 'Is dit betrouwbaar?', 'Prijs van Robux'],
  en: ['How long does delivery take?', 'How do I pay?', 'Is this legit?', 'Price of Robux'],
  de: ['Wie lange dauert die Lieferung?', 'Wie bezahle ich?', 'Ist das seriös?', 'Preis von Robux'],
  fr: ['Combien de temps pour la livraison ?', 'Comment je paie ?', 'C’est fiable ?', 'Prix des Robux'],
};

export function quickReplies(lang = EN) {
  return QUICK[lang] || QUICK[EN];
}

export const assistantMeta = { brand: config.email.fromName };
