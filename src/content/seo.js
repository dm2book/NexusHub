/**
 * Every page's metadata, in one place, in both languages.
 *
 * This exists because of what a crawler actually saw before it: the same title,
 * the same description and the same social image on every single URL. React set
 * them per page — but a link scraper (Discord, WhatsApp, Twitter, Facebook,
 * Slack) does not execute JavaScript, so sharing a Robux product read
 * "ForgeMarket — Digital Goods Marketplace" with the generic homepage picture.
 * There was no canonical in the HTML at all.
 *
 * So this module is consumed twice:
 *
 *   - at BUILD time by scripts/prerender.mjs, which writes a real HTML file per
 *     route with the tags already in it. Those stay static, so they cost nothing
 *     at runtime and the CDN keeps serving them.
 *   - at RUN time by the React app, so an in-app navigation updates the title
 *     and canonical the same way.
 *
 * One source, so the two can never disagree — which is the failure mode that
 * makes hand-written meta tags worse than none.
 *
 * A note on the copy: titles stay under ~60 characters and descriptions under
 * ~155, because past that Google truncates and the part you cared about is the
 * part that disappears. Each one says what the page is FOR rather than stuffing
 * the same five keywords into every slot — which reads as spam to a person and
 * is no longer worth anything to a search engine.
 */

/* The shop's own address, from the environment where there is one.
 *
 * This was the literal below, and the runtime reads `config.appUrl` — so the
 * prerendered canonicals said `https://forgemarket.nl` while the sitemap, which
 * the server generates from APP_URL, said `https://www.forgemarket.nl`. Two
 * sources of truth for the one fact that has to be identical everywhere: a
 * canonical is the page telling search engines its real address, and pointing
 * it at a host the deployment does not serve is the worst version of getting it
 * wrong.
 *
 * `process` is guarded because this module is imported by the browser bundle as
 * well as by scripts/prerender.mjs in Node. In the browser the literal is used,
 * which is correct — the client only ever builds links for the origin it is
 * already on. */
const ENV_URL = (typeof process !== 'undefined' && process.env && process.env.APP_URL) || '';

export const SITE = {
  name: 'ForgeMarket',
  url: (ENV_URL || 'https://www.forgemarket.nl').replace(/\/+$/, ''),
  // The social image. 1200x630 is what every scraper crops to.
  ogImage: '/og.png',
  twitter: null,   // no account yet; the card renders fine without it
};

/** The products this shop is actually built around. Used for the landing copy. */
export const FOCUS = ['Robux', 'V-Bucks', 'Valorant Points', 'giftcards', 'game currency'];

/**
 * Routes with copy of their own.
 *
 * `keywords` is deliberately absent — the meta keywords tag has been ignored by
 * every major search engine for well over a decade, and shipping one is a
 * reliable signal that whoever wrote the page was guessing.
 */
export const PAGES = {
  '/': {
    nl: {
      title: 'Robux, V-Bucks & giftcards kopen — direct geleverd',
      description: 'Koop Robux, V-Bucks, Valorant Points en giftcards bij een Nederlandse shop. Op voorraad gaat automatisch de deur uit, de rest met de hand binnen een paar uur.',
    },
    en: {
      title: 'Buy Robux, V-Bucks & gift cards — delivered fast',
      description: 'Robux, V-Bucks, Valorant Points and gift cards from a small Dutch shop. In stock goes out automatically, the rest by hand within hours. Money back if we cannot deliver.',
    },
    de: {
      title: 'Robux, V-Bucks & Geschenkkarten kaufen — schnell geliefert',
      description: 'Robux, V-Bucks, Valorant Points und Geschenkkarten aus einem kleinen niederländischen Shop. Was auf Lager ist, geht automatisch raus, der Rest von Hand innerhalb weniger Stunden. Geld zurück, wenn wir nicht liefern können.',
    },
    fr: {
      title: 'Acheter des Robux, V-Bucks et cartes cadeaux — livrés vite',
      description: 'Robux, V-Bucks, Valorant Points et cartes cadeaux dans une petite boutique néerlandaise. Ce qui est en stock part automatiquement, le reste à la main en quelques heures. Remboursé si nous ne pouvons pas livrer.',
    },
  },
  '/shop': {
    nl: {
      title: 'Alle producten — game currency & giftcards',
      description: 'De volledige catalogus: Robux, V-Bucks, Valorant Points, Steam, Discord Nitro en giftcards. De prijs die je ziet is de prijs die je betaalt, af te rekenen met iDEAL.',
    },
    en: {
      title: 'All products — game currency & gift cards',
      description: 'The full catalogue: Robux, V-Bucks, Valorant Points, Steam, Discord Nitro and gift cards. The price you see is the price you pay, with iDEAL.',
    },
    de: {
      title: 'Alle Produkte — Spielwährung & Geschenkkarten',
      description: 'Der ganze Katalog: Robux, V-Bucks, Valorant Points, Steam, Discord Nitro und Geschenkkarten. Der Preis, den du siehst, ist der Preis, den du zahlst — mit iDEAL.',
    },
    fr: {
      title: 'Tous les produits — monnaie de jeu et cartes cadeaux',
      description: 'Tout le catalogue : Robux, V-Bucks, Valorant Points, Steam, Discord Nitro et cartes cadeaux. Le prix que tu vois est le prix que tu paies, avec iDEAL.',
    },
  },
  '/how-it-works': {
    nl: {
      title: 'Hoe het werkt — bestellen en geleverd krijgen',
      description: 'Van bestellen tot levering in drie stappen. Wat er op voorraad staat gaat automatisch, de rest levert een mens met de hand af — meestal binnen een paar uur.',
    },
    en: {
      title: 'How it works — ordering and delivery',
      description: 'From order to delivery in three steps. What is in stock goes out automatically; the rest a person delivers by hand, usually within a few hours.',
    },
    de: {
      title: 'So funktioniert es — bestellen und liefern',
      description: 'Von der Bestellung zur Lieferung in drei Schritten. Was auf Lager ist, geht automatisch raus; den Rest liefert ein Mensch von Hand, meistens innerhalb weniger Stunden.',
    },
    fr: {
      title: 'Comment ça marche — commande et livraison',
      description: 'De la commande à la livraison en trois étapes. Ce qui est en stock part automatiquement ; le reste, une personne le livre à la main, en général en quelques heures.',
    },
  },
  '/payment-methods': {
    nl: {
      title: 'Betaalmethoden — iDEAL, Bancontact, PayPal',
      description: 'Betaal met iDEAL, Bancontact, Apple Pay, creditcard of PayPal via Mollie. Je bestelling wordt automatisch bevestigd, meestal binnen seconden.',
    },
    en: {
      title: 'Payment methods — iDEAL, Bancontact, PayPal',
      description: 'Pay with iDEAL, Bancontact, Apple Pay, credit card or PayPal through Mollie. Your order confirms automatically, usually within seconds.',
    },
    de: {
      title: 'Zahlungsmethoden — iDEAL, Bancontact, PayPal',
      description: 'Zahle mit iDEAL, Bancontact, Apple Pay, Kreditkarte oder PayPal über Mollie. Deine Bestellung wird automatisch bestätigt, meistens innerhalb von Sekunden.',
    },
    fr: {
      title: 'Moyens de paiement — iDEAL, Bancontact, PayPal',
      description: 'Paie avec iDEAL, Bancontact, Apple Pay, carte bancaire ou PayPal via Mollie. Ta commande est confirmée automatiquement, en général en quelques secondes.',
    },
  },
  '/track': {
    nl: {
      title: 'Bestelling volgen — status live bekijken',
      description: 'Vul je bestelnummer in en volg je bestelling live. Geen account nodig; de pagina ververst zichzelf zodra je betaling bevestigd is.',
    },
    en: {
      title: 'Track your order — live status',
      description: 'Enter your order number and follow your order live. No account needed; the page updates itself the moment your payment is confirmed.',
    },
    de: {
      title: 'Bestellung verfolgen — Status in Echtzeit',
      description: 'Gib deine Bestellnummer ein und verfolge deine Bestellung live. Kein Konto nötig; die Seite aktualisiert sich selbst, sobald deine Zahlung bestätigt ist.',
    },
    fr: {
      title: 'Suivre ta commande — statut en direct',
      description: 'Saisis ton numéro de commande et suis ta commande en direct. Aucun compte nécessaire ; la page se met à jour dès que ton paiement est confirmé.',
    },
  },
  '/refunds': {
    nl: {
      title: 'Terugbetalingsbeleid — wanneer je geld terugkrijgt',
      description: 'Wanneer je recht hebt op terugbetaling, hoe je het aanvraagt en binnen welke termijn het geld terug is. Inclusief het modelformulier voor herroeping.',
    },
    en: {
      title: 'Refund policy — when you get your money back',
      description: 'When you are entitled to a refund, how to request one, and how long it takes. Includes the model withdrawal form.',
    },
    de: {
      title: 'Rückerstattungen — wann du dein Geld zurückbekommst',
      description: 'Wann dir eine Rückerstattung zusteht, wie du sie beantragst und wie lange sie dauert. Mit Muster-Widerrufsformular.',
    },
    fr: {
      title: 'Politique de remboursement — quand tu es remboursé',
      description: 'Quand tu as droit à un remboursement, comment le demander et combien de temps cela prend. Avec le formulaire type de rétractation.',
    },
  },
  '/faq': {
    nl: {
      title: 'Veelgestelde vragen over bestellen en leveren',
      description: 'Hoe snel is de levering, welke betaalmethoden zijn er, wat als een code niet werkt, en hoe zit het met terugbetalen.',
    },
    en: {
      title: 'Frequently asked questions about orders',
      description: 'How fast is delivery, which payment methods are accepted, what if a code does not work, and how refunds are handled.',
    },
    de: {
      title: 'Häufige Fragen zu Bestellungen',
      description: 'Wie schnell geliefert wird, welche Zahlungsmethoden gehen, was passiert, wenn ein Code nicht funktioniert, und wie Rückerstattungen laufen.',
    },
    fr: {
      title: 'Questions fréquentes sur les commandes',
      description: 'Les délais de livraison, les moyens de paiement acceptés, que faire si un code ne marche pas, et comment se passent les remboursements.',
    },
  },
  '/about': {
    nl: {
      title: 'Over ForgeMarket — wie er achter de shop zit',
      description: 'ForgeMarket wordt gerund door één persoon in Nederland. Wat we verkopen, hoe we leveren, en waarom er een mens op je bericht antwoordt.',
    },
    en: {
      title: 'About ForgeMarket — who runs the shop',
      description: 'ForgeMarket is run by one person in the Netherlands. What we sell, how we deliver, and why a human answers your message.',
    },
    de: {
      title: 'Über ForgeMarket — wer den Shop führt',
      description: 'ForgeMarket wird von einer Person in den Niederlanden geführt. Was wir verkaufen, wie wir liefern, und warum ein Mensch auf deine Nachricht antwortet.',
    },
    fr: {
      title: 'À propos de ForgeMarket — qui tient la boutique',
      description: 'ForgeMarket est tenue par une seule personne aux Pays-Bas. Ce que nous vendons, comment nous livrons, et pourquoi c’est un humain qui répond à ton message.',
    },
  },
  '/contact': {
    nl: {
      title: 'Contact — er antwoordt een echt mens',
      description: 'Vragen over een bestelling of iets misgegaan? Mail ons of open een ticket in Discord. We reageren binnen één werkdag, meestal sneller.',
    },
    en: {
      title: 'Contact — a real person answers',
      description: 'Questions about an order, or something gone wrong? Email us or open a ticket on Discord. We reply within one working day, usually sooner.',
    },
    de: {
      title: 'Kontakt — ein echter Mensch antwortet',
      description: 'Fragen zu einer Bestellung oder ist etwas schiefgelaufen? Schreib uns eine E-Mail oder öffne ein Ticket auf Discord. Wir antworten innerhalb eines Werktags, meistens früher.',
    },
    fr: {
      title: 'Contact — une vraie personne répond',
      description: 'Une question sur une commande, ou un problème ? Écris-nous un e-mail ou ouvre un ticket sur Discord. Nous répondons sous un jour ouvré, en général plus tôt.',
    },
  },
  '/reviews': {
    nl: {
      title: 'Reviews van echte bestellingen',
      description: 'Wat kopers schrijven na hun bestelling. Elke review op deze pagina hoort bij een bestelling die echt is geplaatst en geleverd.',
    },
    en: {
      title: 'Reviews from real orders',
      description: 'What buyers write after ordering. Every review here belongs to an order that was genuinely placed and delivered.',
    },
    de: {
      title: 'Bewertungen aus echten Bestellungen',
      description: 'Was Käufer nach ihrer Bestellung schreiben. Jede Bewertung hier gehört zu einer Bestellung, die wirklich aufgegeben und geliefert wurde.',
    },
    fr: {
      title: 'Avis de vraies commandes',
      description: 'Ce que les acheteurs écrivent après avoir commandé. Chaque avis ici correspond à une commande réellement passée et livrée.',
    },
  },
  '/trust': {
    nl: {
      title: 'Trust Center — waarom je hier veilig koopt',
      description: 'Hoe we leveren, wat er gebeurt als het misgaat, welke gegevens we bewaren en hoe je bestelling beschermd is.',
    },
    en: {
      title: 'Trust Center — why buying here is safe',
      description: 'How we deliver, what happens when something goes wrong, what data we keep and how your order is protected.',
    },
    de: {
      title: 'Trust Center — warum der Kauf hier sicher ist',
      description: 'Wie wir liefern, was passiert, wenn etwas schiefgeht, welche Daten wir behalten und wie deine Bestellung geschützt ist.',
    },
    fr: {
      title: 'Centre de confiance — pourquoi acheter ici est sûr',
      description: 'Comment nous livrons, ce qui se passe en cas de problème, quelles données nous gardons et comment ta commande est protégée.',
    },
  },
  '/discord': {
    nl: {
      title: 'Discord — support, drops en giveaways',
      description: 'Word lid van de ForgeMarket Discord voor hulp bij je bestelling, restock-meldingen, deals en giveaways.',
    },
    en: {
      title: 'Discord — support, drops and giveaways',
      description: 'Join the ForgeMarket Discord for help with your order, restock alerts, deals and giveaways.',
    },
    de: {
      title: 'Discord — Support, Drops und Giveaways',
      description: 'Komm in den ForgeMarket-Discord für Hilfe bei deiner Bestellung, Restock-Benachrichtigungen, Angebote und Giveaways.',
    },
    fr: {
      title: 'Discord — support, drops et giveaways',
      description: 'Rejoins le Discord ForgeMarket pour de l’aide sur ta commande, des alertes de réassort, des offres et des giveaways.',
    },
  },
  '/drops': {
    nl: {
      title: 'Drops & restocks — wat er binnenkomt',
      description: 'Aankomende drops, restocks en aanbiedingen. Zie wat er terugkomt op voorraad voordat het weg is.',
    },
    en: {
      title: 'Drops & restocks — what is coming in',
      description: 'Upcoming drops, restocks and offers. See what is coming back in stock before it goes.',
    },
    de: {
      title: 'Drops & Restocks — was reinkommt',
      description: 'Kommende Drops, Restocks und Angebote. Sieh, was wieder auf Lager kommt, bevor es weg ist.',
    },
    fr: {
      title: 'Drops et réassorts — ce qui arrive',
      description: 'Les prochains drops, réassorts et offres. Vois ce qui revient en stock avant que ça reparte.',
    },
  },
  '/terms': {
    nl: { title: 'Algemene voorwaarden', description: 'De voorwaarden die gelden bij elke bestelling: betaling, levering, herroepingsrecht en terugbetaling.' },
    en: { title: 'Terms and conditions', description: 'The terms that apply to every order: payment, delivery, right of withdrawal and refunds.' },
    de: { title: 'Allgemeine Geschäftsbedingungen', description: 'Die Bedingungen, die für jede Bestellung gelten: Zahlung, Lieferung, Widerrufsrecht und Rückerstattungen.' },
    fr: { title: 'Conditions générales', description: 'Les conditions qui s’appliquent à chaque commande : paiement, livraison, droit de rétractation et remboursements.' },
  },
  '/privacy': {
    nl: { title: 'Privacybeleid', description: 'Welke persoonsgegevens ForgeMarket verwerkt, op welke grondslag, hoe lang ze bewaard worden en welke rechten je hebt.' },
    en: { title: 'Privacy policy', description: 'What personal data ForgeMarket processes, on what legal basis, how long it is kept, and your rights.' },
    de: { title: 'Datenschutzerklärung', description: 'Welche personenbezogenen Daten ForgeMarket verarbeitet, auf welcher Rechtsgrundlage, wie lange sie gespeichert werden und welche Rechte du hast.' },
    fr: { title: 'Politique de confidentialité', description: 'Quelles données personnelles ForgeMarket traite, sur quelle base légale, combien de temps elles sont conservées et quels sont tes droits.' },
  },
  '/cookies': {
    nl: { title: 'Cookiebeleid', description: 'Welke cookies ForgeMarket plaatst, wat er in je eigen browser blijft, en waarom deze site geen cookiebanner heeft.' },
    en: { title: 'Cookie policy', description: 'Which cookies ForgeMarket sets, what stays in your own browser, and why this site has no cookie banner.' },
    de: { title: 'Cookie-Richtlinie', description: 'Welche Cookies ForgeMarket setzt, was in deinem eigenen Browser bleibt und warum diese Seite kein Cookie-Banner hat.' },
    fr: { title: 'Politique relative aux cookies', description: 'Quels cookies ForgeMarket dépose, ce qui reste dans ton propre navigateur, et pourquoi ce site n’a pas de bandeau cookies.' },
  },
  '/login': {
    nl: { title: 'Inloggen', description: 'Log in zonder wachtwoord met een code per e-mail, of ga verder met Discord.' },
    en: { title: 'Sign in', description: 'Sign in without a password using a code sent by email, or continue with Discord.' },
    de: { title: 'Anmelden', description: 'Melde dich ohne Passwort mit einem Code per E-Mail an, oder mach mit Discord weiter.' },
    fr: { title: 'Se connecter', description: 'Connecte-toi sans mot de passe avec un code envoyé par e-mail, ou continue avec Discord.' },
  },
  '/cart': {
    nl: { title: 'Winkelwagen', description: 'De producten in je winkelwagen, met het totaal en de betaalmethoden die je bij het afrekenen kunt kiezen.' },
    en: { title: 'Cart', description: 'The products in your cart, with the total including VAT and the payment methods you can choose at checkout.' },
    de: { title: 'Warenkorb', description: 'Die Produkte in deinem Warenkorb, mit dem Gesamtbetrag und den Zahlungsmethoden, die du beim Bezahlen wählen kannst.' },
    fr: { title: 'Panier', description: 'Les produits de ton panier, avec le total et les moyens de paiement disponibles au moment de payer.' },
  },
};

/**
 * Landing pages for what this shop is actually searched for.
 *
 * `/shop?category=robux` is crawlable but weak: a query string reads as a
 * filtered view of one page rather than a page about Robux, and every variant
 * competes with the others for the same words. A path does not have that
 * problem, and it is what somebody would type.
 *
 * Each one renders the shop already filtered — same component, same data, no
 * duplicate catalogue to keep in sync — but with its own title, description,
 * heading and canonical. The `category` is the value the products genuinely
 * carry, so a landing page can never point at an empty shelf by typo.
 *
 * There used to be five of these, against twenty-one categories the shop
 * genuinely stocks. Sixteen categories — forty-six of the seventy-one products
 * — had no address of their own at all: their only URL was `/shop?category=x`,
 * whose canonical points at `/shop`. Every one of those queries ("FC Points
 * kopen", "CoD Points kopen", "Genesis Crystals kopen") had nothing to land on.
 *
 * This object is now the ONE source for them. It is read by
 * scripts/prerender.mjs (which writes the HTML), by src/App.jsx (which
 * declares the routes), by the sitemap in server/src/routes/catalog.js, and by
 * the internal links on the homepage and on every product page — so a category
 * cannot have a page that nothing links to, or a link to a page that does not
 * exist.
 *
 * `sub` is the sentence under the heading. It lives here rather than in
 * App.jsx because it is the page's only prose, and prose that describes the
 * page belongs with the rest of the page's copy.
 *
 * A category earns a page when the shop stocks at least two products in it.
 * One product is not a category — it is the product page again under another
 * URL, which is the definition of a doorway. `spotify` and `gamepass` hold one
 * each and are deliberately absent until they have depth.
 */
export const LANDING = {
  '/robux': {
    category: 'robux',
    nl: {
      title: 'Robux kopen — direct op je Roblox-account',
      description: 'Robux kopen met iDEAL. Wat op voorraad staat gaat automatisch de deur uit; de rest zetten we met de hand op je Roblox-account, meestal binnen een paar uur.',
      h1: 'Robux kopen',
      sub: 'Robux voor je Roblox-account. Op voorraad gaat automatisch de deur uit; de rest zetten we met de hand voor je klaar.',
    },
    en: {
      title: 'Buy Robux — straight to your Roblox account',
      description: 'Buy Robux with iDEAL. What is in stock goes out automatically; the rest we add to your Roblox account by hand, usually within a few hours.',
      h1: 'Buy Robux',
      sub: 'Robux for your Roblox account. In stock goes out automatically; the rest we prepare by hand.',
    },
    de: {
      title: 'Robux kaufen — direkt auf dein Roblox-Konto',
      description: 'Robux kaufen mit iDEAL. Was auf Lager ist, geht automatisch raus; den Rest buchen wir von Hand auf dein Roblox-Konto, meistens innerhalb weniger Stunden.',
      h1: 'Robux kaufen',
      sub: 'Robux für dein Roblox-Konto. Was auf Lager ist, geht automatisch raus; den Rest bereiten wir von Hand vor.',
    },
    fr: {
      title: 'Acheter des Robux — directement sur ton compte Roblox',
      description: 'Achète des Robux avec iDEAL. Ce qui est en stock part automatiquement ; le reste, nous l’ajoutons à la main sur ton compte Roblox, en général en quelques heures.',
      h1: 'Acheter des Robux',
      sub: 'Des Robux pour ton compte Roblox. Ce qui est en stock part automatiquement ; le reste, nous le préparons à la main.',
    },
  },
  '/v-bucks': {
    category: 'v-bucks',
    nl: {
      title: 'V-Bucks kopen voor Fortnite — snel geleverd',
      description: 'V-Bucks kopen met iDEAL, Bancontact of PayPal. Op voorraad wordt automatisch geleverd, de rest met de hand binnen een paar uur.',
      h1: 'V-Bucks kopen',
      sub: 'V-Bucks voor Fortnite, betaald met iDEAL. Automatisch geleverd wanneer we voorraad hebben.',
    },
    en: {
      title: 'Buy V-Bucks for Fortnite — delivered fast',
      description: 'Buy V-Bucks with iDEAL, Bancontact or PayPal. In stock is delivered automatically, the rest by hand within a few hours.',
      h1: 'Buy V-Bucks',
      sub: 'V-Bucks for Fortnite, paid with iDEAL. Delivered automatically when we have stock.',
    },
    de: {
      title: 'V-Bucks für Fortnite kaufen — schnell geliefert',
      description: 'V-Bucks kaufen mit iDEAL, Bancontact oder PayPal. Was auf Lager ist, wird automatisch geliefert, der Rest von Hand innerhalb weniger Stunden.',
      h1: 'V-Bucks kaufen',
      sub: 'V-Bucks für Fortnite, bezahlt mit iDEAL. Automatisch geliefert, solange wir Lagerbestand haben.',
    },
    fr: {
      title: 'Acheter des V-Bucks pour Fortnite — livrés vite',
      description: 'Achète des V-Bucks avec iDEAL, Bancontact ou PayPal. Ce qui est en stock est livré automatiquement, le reste à la main en quelques heures.',
      h1: 'Acheter des V-Bucks',
      sub: 'Des V-Bucks pour Fortnite, payés avec iDEAL. Livrés automatiquement tant que nous avons du stock.',
    },
  },
  '/valorant-points': {
    category: 'valorant',
    nl: {
      title: 'Valorant Points kopen — VP met iDEAL',
      description: 'Valorant Points kopen bij een Nederlandse shop. Betaal met iDEAL en krijg je VP automatisch of met de hand geleverd, meestal binnen een paar uur.',
      h1: 'Valorant Points kopen',
      sub: 'Valorant Points (VP) met iDEAL. Automatisch als het op voorraad staat, anders met de hand binnen een paar uur.',
    },
    en: {
      title: 'Buy Valorant Points — VP with iDEAL',
      description: 'Buy Valorant Points from a Dutch shop. Pay with iDEAL and get your VP automatically or delivered by hand, usually within a few hours.',
      h1: 'Buy Valorant Points',
      sub: 'Valorant Points (VP) with iDEAL. Automatic when in stock, otherwise by hand within a few hours.',
    },
    de: {
      title: 'Valorant Points kaufen — VP mit iDEAL',
      description: 'Valorant Points bei einem niederländischen Shop kaufen. Zahle mit iDEAL und erhalte deine VP automatisch oder von Hand geliefert, meistens innerhalb weniger Stunden.',
      h1: 'Valorant Points kaufen',
      sub: 'Valorant Points (VP) mit iDEAL. Automatisch, solange vorrätig, sonst von Hand innerhalb weniger Stunden.',
    },
    fr: {
      title: 'Acheter des Valorant Points — des VP avec iDEAL',
      description: 'Achète des Valorant Points dans une boutique néerlandaise. Paie avec iDEAL et reçois tes VP automatiquement ou livrés à la main, en général en quelques heures.',
      h1: 'Acheter des Valorant Points',
      sub: 'Des Valorant Points (VP) avec iDEAL. Automatique tant qu’il y a du stock, sinon à la main en quelques heures.',
    },
  },
  '/giftcards': {
    category: 'giftcard',
    nl: {
      title: 'Giftcards kopen — Steam, PlayStation, Xbox',
      description: 'Digitale giftcards voor Steam, PlayStation, Xbox, Netflix en meer. Code per e-mail, betalen met iDEAL, geld terug als we niet kunnen leveren.',
      h1: 'Giftcards kopen',
      sub: 'Digitale giftcards voor Steam, PlayStation, Xbox en meer. De code komt per e-mail.',
    },
    en: {
      title: 'Buy gift cards — Steam, PlayStation, Xbox',
      description: 'Digital gift cards for Steam, PlayStation, Xbox, Netflix and more. Code by email, pay with iDEAL, money back if we cannot deliver.',
      h1: 'Buy gift cards',
      sub: 'Digital gift cards for Steam, PlayStation, Xbox and more. The code arrives by email.',
    },
    de: {
      title: 'Geschenkkarten kaufen — Steam, PlayStation, Xbox',
      description: 'Digitale Geschenkkarten für Steam, PlayStation, Xbox, Netflix und mehr. Code per E-Mail, zahlen mit iDEAL, Geld zurück, wenn wir nicht liefern können.',
      h1: 'Geschenkkarten kaufen',
      sub: 'Digitale Geschenkkarten für Steam, PlayStation, Xbox und mehr. Der Code kommt per E-Mail.',
    },
    fr: {
      title: 'Acheter des cartes cadeaux — Steam, PlayStation, Xbox',
      description: 'Cartes cadeaux numériques pour Steam, PlayStation, Xbox, Netflix et plus. Code par e-mail, paiement avec iDEAL, remboursé si nous ne pouvons pas livrer.',
      h1: 'Acheter des cartes cadeaux',
      sub: 'Des cartes cadeaux numériques pour Steam, PlayStation, Xbox et plus. Le code arrive par e-mail.',
    },
  },
  '/fc-points': {
    category: 'eafc',
    nl: {
      title: 'FC Points kopen voor EA FC — direct geleverd',
      description: 'FC Points kopen met iDEAL voor EA SPORTS FC. Op voorraad gaat automatisch de deur uit, de rest zetten we met de hand voor je klaar.',
      h1: 'FC Points kopen',
      sub: 'FC Points voor EA SPORTS FC, voor packs en Ultimate Team. Betalen met iDEAL, levering automatisch of met de hand.',
    },
    en: {
      title: 'Buy FC Points for EA FC — delivered fast',
      description: 'Buy FC Points for EA SPORTS FC with iDEAL. In stock goes out automatically, the rest we prepare by hand.',
      h1: 'Buy FC Points',
      sub: 'FC Points for EA SPORTS FC, for packs and Ultimate Team. Pay with iDEAL, delivered automatically or by hand.',
    },
    de: {
      title: 'FC Points für EA FC kaufen — schnell geliefert',
      description: 'FC Points für EA SPORTS FC mit iDEAL kaufen. Was auf Lager ist, geht automatisch raus, den Rest bereiten wir von Hand vor.',
      h1: 'FC Points kaufen',
      sub: 'FC Points für EA SPORTS FC, für Packs und Ultimate Team. Zahle mit iDEAL, geliefert automatisch oder von Hand.',
    },
    fr: {
      title: 'Acheter des FC Points pour EA FC — livrés vite',
      description: 'Achète des FC Points pour EA SPORTS FC avec iDEAL. Ce qui est en stock part automatiquement, le reste, nous le préparons à la main.',
      h1: 'Acheter des FC Points',
      sub: 'Des FC Points pour EA SPORTS FC, pour les packs et Ultimate Team. Paie avec iDEAL, livré automatiquement ou à la main.',
    },
  },
  '/cod-points': {
    category: 'cod',
    nl: {
      title: 'CoD Points kopen — Call of Duty CP met iDEAL',
      description: 'CoD Points (CP) kopen voor Call of Duty en Warzone. Betaal met iDEAL; wat op voorraad staat gaat automatisch de deur uit.',
      h1: 'CoD Points kopen',
      sub: 'CP voor Call of Duty en Warzone — voor bundles, skins en de Battle Pass.',
    },
    en: {
      title: 'Buy CoD Points — Call of Duty CP with iDEAL',
      description: 'Buy CoD Points (CP) for Call of Duty and Warzone. Pay with iDEAL; what is in stock goes out automatically.',
      h1: 'Buy CoD Points',
      sub: 'CP for Call of Duty and Warzone — for bundles, skins and the Battle Pass.',
    },
    de: {
      title: 'CoD Points kaufen — Call of Duty CP mit iDEAL',
      description: 'CoD Points (CP) für Call of Duty und Warzone kaufen. Zahle mit iDEAL; was auf Lager ist, geht automatisch raus.',
      h1: 'CoD Points kaufen',
      sub: 'CP für Call of Duty und Warzone — für Bundles, Skins und den Battle Pass.',
    },
    fr: {
      title: 'Acheter des CoD Points — des CP Call of Duty avec iDEAL',
      description: 'Achète des CoD Points (CP) pour Call of Duty et Warzone. Paie avec iDEAL ; ce qui est en stock part automatiquement.',
      h1: 'Acheter des CoD Points',
      sub: 'Des CP pour Call of Duty et Warzone — pour les bundles, les skins et le Battle Pass.',
    },
  },
  '/apex-coins': {
    category: 'apex',
    nl: {
      title: 'Apex Coins kopen — Apex Legends met iDEAL',
      description: 'Apex Coins kopen voor Apex Legends. Betaal met iDEAL of Bancontact; op voorraad wordt automatisch geleverd, de rest met de hand.',
      h1: 'Apex Coins kopen',
      sub: 'Apex Coins voor Apex Legends — voor legends, skins en de Battle Pass.',
    },
    en: {
      title: 'Buy Apex Coins — Apex Legends with iDEAL',
      description: 'Buy Apex Coins for Apex Legends. Pay with iDEAL or Bancontact; in stock is delivered automatically, the rest by hand.',
      h1: 'Buy Apex Coins',
      sub: 'Apex Coins for Apex Legends — for legends, skins and the Battle Pass.',
    },
    de: {
      title: 'Apex Coins kaufen — Apex Legends mit iDEAL',
      description: 'Apex Coins für Apex Legends kaufen. Zahle mit iDEAL oder Bancontact; was auf Lager ist, wird automatisch geliefert, der Rest von Hand.',
      h1: 'Apex Coins kaufen',
      sub: 'Apex Coins für Apex Legends — für Legenden, Skins und den Battle Pass.',
    },
    fr: {
      title: 'Acheter des Apex Coins — Apex Legends avec iDEAL',
      description: 'Achète des Apex Coins pour Apex Legends. Paie avec iDEAL ou Bancontact ; ce qui est en stock est livré automatiquement, le reste à la main.',
      h1: 'Acheter des Apex Coins',
      sub: 'Des Apex Coins pour Apex Legends — pour les légendes, les skins et le Battle Pass.',
    },
  },
  '/genshin-crystals': {
    category: 'genshin',
    nl: {
      title: 'Genesis Crystals kopen — Genshin Impact top-up',
      description: 'Genesis Crystals kopen voor Genshin Impact, betaald met iDEAL. Automatisch geleverd wanneer we voorraad hebben, anders met de hand.',
      h1: 'Genesis Crystals kopen',
      sub: 'Genesis Crystals voor Genshin Impact — voor wishes, de Battle Pass en Welkin.',
    },
    en: {
      title: 'Buy Genesis Crystals — Genshin Impact top-up',
      description: 'Buy Genesis Crystals for Genshin Impact, paid with iDEAL. Delivered automatically when in stock, otherwise by hand.',
      h1: 'Buy Genesis Crystals',
      sub: 'Genesis Crystals for Genshin Impact — for wishes, the Battle Pass and Welkin.',
    },
    de: {
      title: 'Genesis Crystals kaufen — Genshin Impact aufladen',
      description: 'Genesis Crystals für Genshin Impact kaufen, bezahlt mit iDEAL. Automatisch geliefert, solange vorrätig, sonst von Hand.',
      h1: 'Genesis Crystals kaufen',
      sub: 'Genesis Crystals für Genshin Impact — für Wishes, den Battle Pass und Welkin.',
    },
    fr: {
      title: 'Acheter des Genesis Crystals — recharge Genshin Impact',
      description: 'Achète des Genesis Crystals pour Genshin Impact, payés avec iDEAL. Livrés automatiquement tant qu’il y a du stock, sinon à la main.',
      h1: 'Acheter des Genesis Crystals',
      sub: 'Des Genesis Crystals pour Genshin Impact — pour les vœux, le Battle Pass et le Welkin.',
    },
  },
  '/clash-of-clans-gems': {
    category: 'clash',
    nl: {
      title: 'Clash of Clans Gems kopen — met iDEAL',
      description: 'Gems kopen voor Clash of Clans. Betaal met iDEAL; wat op voorraad staat gaat automatisch de deur uit, de rest binnen een paar uur.',
      h1: 'Clash of Clans Gems kopen',
      sub: 'Gems voor Clash of Clans — voor builders, boosts en de Gold Pass.',
    },
    en: {
      title: 'Buy Clash of Clans Gems — with iDEAL',
      description: 'Buy Gems for Clash of Clans. Pay with iDEAL; what is in stock goes out automatically, the rest within a few hours.',
      h1: 'Buy Clash of Clans Gems',
      sub: 'Gems for Clash of Clans — for builders, boosts and the Gold Pass.',
    },
    de: {
      title: 'Clash of Clans Gems kaufen — mit iDEAL',
      description: 'Gems für Clash of Clans kaufen. Zahle mit iDEAL; was auf Lager ist, geht automatisch raus, der Rest innerhalb weniger Stunden.',
      h1: 'Clash of Clans Gems kaufen',
      sub: 'Gems für Clash of Clans — für Bauarbeiter, Boosts und den Gold Pass.',
    },
    fr: {
      title: 'Acheter des gemmes Clash of Clans — avec iDEAL',
      description: 'Achète des gemmes pour Clash of Clans. Paie avec iDEAL ; ce qui est en stock part automatiquement, le reste en quelques heures.',
      h1: 'Acheter des gemmes Clash of Clans',
      sub: 'Des gemmes pour Clash of Clans — pour les ouvriers, les boosts et le Gold Pass.',
    },
  },
  '/clash-royale-gems': {
    category: 'clashroyale',
    nl: {
      title: 'Clash Royale Gems kopen — direct geleverd',
      description: 'Gems kopen voor Clash Royale met iDEAL. Op voorraad wordt automatisch geleverd, de rest zetten we met de hand voor je klaar.',
      h1: 'Clash Royale Gems kopen',
      sub: 'Gems voor Clash Royale — voor chests, kaarten en de Pass Royale.',
    },
    en: {
      title: 'Buy Clash Royale Gems — delivered fast',
      description: 'Buy Gems for Clash Royale with iDEAL. In stock is delivered automatically, the rest we prepare by hand.',
      h1: 'Buy Clash Royale Gems',
      sub: 'Gems for Clash Royale — for chests, cards and the Pass Royale.',
    },
    de: {
      title: 'Clash Royale Gems kaufen — schnell geliefert',
      description: 'Gems für Clash Royale mit iDEAL kaufen. Was auf Lager ist, wird automatisch geliefert, den Rest bereiten wir von Hand vor.',
      h1: 'Clash Royale Gems kaufen',
      sub: 'Gems für Clash Royale — für Truhen, Karten und den Pass Royale.',
    },
    fr: {
      title: 'Acheter des gemmes Clash Royale — livrées vite',
      description: 'Achète des gemmes pour Clash Royale avec iDEAL. Ce qui est en stock est livré automatiquement, le reste, nous le préparons à la main.',
      h1: 'Acheter des gemmes Clash Royale',
      sub: 'Des gemmes pour Clash Royale — pour les coffres, les cartes et le Pass Royale.',
    },
  },
  '/brawl-stars-gems': {
    category: 'brawl',
    nl: {
      title: 'Brawl Stars Gems kopen — met iDEAL',
      description: 'Gems kopen voor Brawl Stars. Betaal met iDEAL, Bancontact of PayPal; automatisch geleverd zodra er voorraad is.',
      h1: 'Brawl Stars Gems kopen',
      sub: 'Gems voor Brawl Stars — voor brawlers, skins en de Brawl Pass.',
    },
    en: {
      title: 'Buy Brawl Stars Gems — with iDEAL',
      description: 'Buy Gems for Brawl Stars. Pay with iDEAL, Bancontact or PayPal; delivered automatically as soon as stock is there.',
      h1: 'Buy Brawl Stars Gems',
      sub: 'Gems for Brawl Stars — for brawlers, skins and the Brawl Pass.',
    },
    de: {
      title: 'Brawl Stars Gems kaufen — mit iDEAL',
      description: 'Gems für Brawl Stars kaufen. Zahle mit iDEAL, Bancontact oder PayPal; geliefert wird automatisch, sobald Lagerbestand da ist.',
      h1: 'Brawl Stars Gems kaufen',
      sub: 'Gems für Brawl Stars — für Brawler, Skins und den Brawl Pass.',
    },
    fr: {
      title: 'Acheter des gemmes Brawl Stars — avec iDEAL',
      description: 'Achète des gemmes pour Brawl Stars. Paie avec iDEAL, Bancontact ou PayPal ; la livraison est automatique dès qu’il y a du stock.',
      h1: 'Acheter des gemmes Brawl Stars',
      sub: 'Des gemmes pour Brawl Stars — pour les brawlers, les skins et le Brawl Pass.',
    },
  },
  '/free-fire-diamonds': {
    category: 'freefire',
    nl: {
      title: 'Free Fire Diamonds kopen — snel geleverd',
      description: 'Diamonds kopen voor Free Fire met iDEAL. Wat op voorraad staat gaat automatisch de deur uit, de rest met de hand binnen een paar uur.',
      h1: 'Free Fire Diamonds kopen',
      sub: 'Diamonds voor Free Fire — voor skins, karakters en de Elite Pass.',
    },
    en: {
      title: 'Buy Free Fire Diamonds — delivered fast',
      description: 'Buy Diamonds for Free Fire with iDEAL. What is in stock goes out automatically, the rest by hand within a few hours.',
      h1: 'Buy Free Fire Diamonds',
      sub: 'Diamonds for Free Fire — for skins, characters and the Elite Pass.',
    },
    de: {
      title: 'Free Fire Diamonds kaufen — schnell geliefert',
      description: 'Diamonds für Free Fire mit iDEAL kaufen. Was auf Lager ist, geht automatisch raus, der Rest von Hand innerhalb weniger Stunden.',
      h1: 'Free Fire Diamonds kaufen',
      sub: 'Diamonds für Free Fire — für Skins, Charaktere und den Elite Pass.',
    },
    fr: {
      title: 'Acheter des diamants Free Fire — livrés vite',
      description: 'Achète des diamants pour Free Fire avec iDEAL. Ce qui est en stock part automatiquement, le reste à la main en quelques heures.',
      h1: 'Acheter des diamants Free Fire',
      sub: 'Des diamants pour Free Fire — pour les skins, les personnages et l’Elite Pass.',
    },
  },
  '/riot-points': {
    category: 'league',
    nl: {
      title: 'Riot Points kopen — RP voor League of Legends',
      description: 'Riot Points (RP) kopen voor League of Legends, betaald met iDEAL. Automatisch geleverd wanneer we voorraad hebben.',
      h1: 'Riot Points kopen',
      sub: 'RP voor League of Legends — voor champions, skins en de Battle Pass.',
    },
    en: {
      title: 'Buy Riot Points — RP for League of Legends',
      description: 'Buy Riot Points (RP) for League of Legends, paid with iDEAL. Delivered automatically when in stock.',
      h1: 'Buy Riot Points',
      sub: 'RP for League of Legends — for champions, skins and the Battle Pass.',
    },
    de: {
      title: 'Riot Points kaufen — RP für League of Legends',
      description: 'Riot Points (RP) für League of Legends kaufen, bezahlt mit iDEAL. Automatisch geliefert, solange vorrätig.',
      h1: 'Riot Points kaufen',
      sub: 'RP für League of Legends — für Champions, Skins und den Battle Pass.',
    },
    fr: {
      title: 'Acheter des Riot Points — des RP pour League of Legends',
      description: 'Achète des Riot Points (RP) pour League of Legends, payés avec iDEAL. Livrés automatiquement tant qu’il y a du stock.',
      h1: 'Acheter des Riot Points',
      sub: 'Des RP pour League of Legends — pour les champions, les skins et le Battle Pass.',
    },
  },
  '/gta-shark-cards': {
    category: 'gta',
    nl: {
      title: 'GTA Shark Cards kopen — cash voor GTA Online',
      description: 'Shark Cards kopen voor GTA Online. Betaal met iDEAL en krijg je in-game cash automatisch of met de hand geleverd.',
      h1: 'GTA Shark Cards kopen',
      sub: 'Shark Cards voor GTA Online — in-game cash voor auto\u2019s, wapens en bedrijven.',
    },
    en: {
      title: 'Buy GTA Shark Cards — cash for GTA Online',
      description: 'Buy Shark Cards for GTA Online. Pay with iDEAL and get your in-game cash automatically or delivered by hand.',
      h1: 'Buy GTA Shark Cards',
      sub: 'Shark Cards for GTA Online — in-game cash for cars, weapons and businesses.',
    },
    de: {
      title: 'GTA Shark Cards kaufen — Geld für GTA Online',
      description: 'Shark Cards für GTA Online kaufen. Zahle mit iDEAL und erhalte dein Ingame-Geld automatisch oder von Hand geliefert.',
      h1: 'GTA Shark Cards kaufen',
      sub: 'Shark Cards für GTA Online — Ingame-Geld für Autos, Waffen und Unternehmen.',
    },
    fr: {
      title: 'Acheter des Shark Cards GTA — de l’argent pour GTA Online',
      description: 'Achète des Shark Cards pour GTA Online. Paie avec iDEAL et reçois ton argent en jeu automatiquement ou livré à la main.',
      h1: 'Acheter des Shark Cards GTA',
      sub: 'Des Shark Cards pour GTA Online — de l’argent en jeu pour les voitures, les armes et les entreprises.',
    },
  },
  '/minecoins': {
    category: 'minecraft',
    nl: {
      title: 'Minecoins kopen — Minecraft met iDEAL',
      description: 'Minecoins kopen voor Minecraft. Betaal met iDEAL; op voorraad gaat automatisch de deur uit, de rest met de hand.',
      h1: 'Minecoins kopen',
      sub: 'Minecoins voor Minecraft — voor skins, werelden en texture packs.',
    },
    en: {
      title: 'Buy Minecoins — Minecraft with iDEAL',
      description: 'Buy Minecoins for Minecraft. Pay with iDEAL; in stock goes out automatically, the rest by hand.',
      h1: 'Buy Minecoins',
      sub: 'Minecoins for Minecraft — for skins, worlds and texture packs.',
    },
    de: {
      title: 'Minecoins kaufen — Minecraft mit iDEAL',
      description: 'Minecoins für Minecraft kaufen. Zahle mit iDEAL; was auf Lager ist, geht automatisch raus, der Rest von Hand.',
      h1: 'Minecoins kaufen',
      sub: 'Minecoins für Minecraft — für Skins, Welten und Texture Packs.',
    },
    fr: {
      title: 'Acheter des Minecoins — Minecraft avec iDEAL',
      description: 'Achète des Minecoins pour Minecraft. Paie avec iDEAL ; ce qui est en stock part automatiquement, le reste à la main.',
      h1: 'Acheter des Minecoins',
      sub: 'Des Minecoins pour Minecraft — pour les skins, les mondes et les packs de textures.',
    },
  },
  '/pubg-uc': {
    category: 'pubg',
    nl: {
      title: 'PUBG UC kopen — Unknown Cash met iDEAL',
      description: 'UC kopen voor PUBG Mobile, betaald met iDEAL. Wat op voorraad staat wordt automatisch geleverd, de rest binnen een paar uur.',
      h1: 'PUBG UC kopen',
      sub: 'Unknown Cash voor PUBG Mobile — voor crates, skins en de Royale Pass.',
    },
    en: {
      title: 'Buy PUBG UC — Unknown Cash with iDEAL',
      description: 'Buy UC for PUBG Mobile, paid with iDEAL. What is in stock is delivered automatically, the rest within a few hours.',
      h1: 'Buy PUBG UC',
      sub: 'Unknown Cash for PUBG Mobile — for crates, skins and the Royale Pass.',
    },
    de: {
      title: 'PUBG UC kaufen — Unknown Cash mit iDEAL',
      description: 'UC für PUBG Mobile kaufen, bezahlt mit iDEAL. Was auf Lager ist, wird automatisch geliefert, der Rest innerhalb weniger Stunden.',
      h1: 'PUBG UC kaufen',
      sub: 'Unknown Cash für PUBG Mobile — für Kisten, Skins und den Royale Pass.',
    },
    fr: {
      title: 'Acheter des UC PUBG — de l’Unknown Cash avec iDEAL',
      description: 'Achète des UC pour PUBG Mobile, payés avec iDEAL. Ce qui est en stock est livré automatiquement, le reste en quelques heures.',
      h1: 'Acheter des UC PUBG',
      sub: 'De l’Unknown Cash pour PUBG Mobile — pour les caisses, les skins et le Royale Pass.',
    },
  },
  '/mobile-legends-diamonds': {
    category: 'mlbb',
    nl: {
      title: 'Mobile Legends Diamonds kopen — MLBB top-up',
      description: 'Diamonds kopen voor Mobile Legends: Bang Bang met iDEAL. Automatisch geleverd zodra er voorraad is, anders met de hand.',
      h1: 'Mobile Legends Diamonds kopen',
      sub: 'Diamonds voor Mobile Legends: Bang Bang — voor helden, skins en de Pass.',
    },
    en: {
      title: 'Buy Mobile Legends Diamonds — MLBB top-up',
      description: 'Buy Diamonds for Mobile Legends: Bang Bang with iDEAL. Delivered automatically as soon as stock is there, otherwise by hand.',
      h1: 'Buy Mobile Legends Diamonds',
      sub: 'Diamonds for Mobile Legends: Bang Bang — for heroes, skins and the Pass.',
    },
    de: {
      title: 'Mobile Legends Diamonds kaufen — MLBB aufladen',
      description: 'Diamonds für Mobile Legends: Bang Bang mit iDEAL kaufen. Geliefert wird automatisch, sobald Lagerbestand da ist, sonst von Hand.',
      h1: 'Mobile Legends Diamonds kaufen',
      sub: 'Diamonds für Mobile Legends: Bang Bang — für Helden, Skins und den Pass.',
    },
    fr: {
      title: 'Acheter des diamants Mobile Legends — recharge MLBB',
      description: 'Achète des diamants pour Mobile Legends: Bang Bang avec iDEAL. Livrés automatiquement dès qu’il y a du stock, sinon à la main.',
      h1: 'Acheter des diamants Mobile Legends',
      sub: 'Des diamants pour Mobile Legends: Bang Bang — pour les héros, les skins et le Pass.',
    },
  },
  '/pokemon-go': {
    category: 'pokemongo',
    nl: {
      title: 'Pokemon GO munten kopen — PokéCoins met iDEAL',
      description: 'PokéCoins kopen voor Pokemon GO. Betaal met iDEAL; op voorraad wordt automatisch geleverd, de rest met de hand.',
      h1: 'PokéCoins kopen',
      sub: 'PokéCoins voor Pokemon GO — voor items, opslag en raids.',
    },
    en: {
      title: 'Buy Pokemon GO coins — PokéCoins with iDEAL',
      description: 'Buy PokéCoins for Pokemon GO. Pay with iDEAL; in stock is delivered automatically, the rest by hand.',
      h1: 'Buy PokéCoins',
      sub: 'PokéCoins for Pokemon GO — for items, storage and raids.',
    },
    de: {
      title: 'Pokémon GO Münzen kaufen — PokéCoins mit iDEAL',
      description: 'PokéCoins für Pokémon GO kaufen. Zahle mit iDEAL; was auf Lager ist, wird automatisch geliefert, der Rest von Hand.',
      h1: 'PokéCoins kaufen',
      sub: 'PokéCoins für Pokémon GO — für Items, mehr Speicherplatz und Raids.',
    },
    fr: {
      title: 'Acheter des pièces Pokémon GO — des PokéCoins avec iDEAL',
      description: 'Achète des PokéCoins pour Pokémon GO. Paie avec iDEAL ; ce qui est en stock est livré automatiquement, le reste à la main.',
      h1: 'Acheter des PokéCoins',
      sub: 'Des PokéCoins pour Pokémon GO — pour les objets, le stockage et les raids.',
    },
  },
  '/discord-nitro': {
    category: 'discord-nitro',
    nl: {
      title: 'Discord Nitro kopen — 1 maand of 1 jaar',
      description: 'Discord Nitro kopen met iDEAL. De code komt per e-mail; op voorraad gaat automatisch de deur uit, de rest met de hand.',
      h1: 'Discord Nitro kopen',
      sub: 'Nitro voor Discord — emoji overal, grotere uploads en een betere stream.',
    },
    en: {
      title: 'Buy Discord Nitro — 1 month or 1 year',
      description: 'Buy Discord Nitro with iDEAL. The code arrives by email; in stock goes out automatically, the rest by hand.',
      h1: 'Buy Discord Nitro',
      sub: 'Nitro for Discord — emoji everywhere, bigger uploads and a better stream.',
    },
    de: {
      title: 'Discord Nitro kaufen — 1 Monat oder 1 Jahr',
      description: 'Discord Nitro mit iDEAL kaufen. Der Code kommt per E-Mail; was auf Lager ist, geht automatisch raus, der Rest von Hand.',
      h1: 'Discord Nitro kaufen',
      sub: 'Nitro für Discord — Emojis überall, größere Uploads und ein besserer Stream.',
    },
    fr: {
      title: 'Acheter Discord Nitro — 1 mois ou 1 an',
      description: 'Achète Discord Nitro avec iDEAL. Le code arrive par e-mail ; ce qui est en stock part automatiquement, le reste à la main.',
      h1: 'Acheter Discord Nitro',
      sub: 'Nitro pour Discord — des emojis partout, des envois plus lourds et un meilleur stream.',
    },
  },
  '/game-currency': {
    category: '',
    nl: {
      title: 'Game currency kopen — Robux, V-Bucks, VP',
      description: 'Game currency voor Roblox, Fortnite, Valorant en meer, bij één Nederlandse shop. Betalen met iDEAL, levering automatisch of met de hand.',
      h1: 'Game currency kopen',
      sub: 'Alle game currency op één plek: Robux, V-Bucks, Valorant Points en meer.',
    },
    en: {
      title: 'Buy game currency — Robux, V-Bucks, VP',
      description: 'Game currency for Roblox, Fortnite, Valorant and more, from one Dutch shop. Pay with iDEAL, delivered automatically or by hand.',
      h1: 'Buy game currency',
      sub: 'All game currency in one place: Robux, V-Bucks, Valorant Points and more.',
    },
    de: {
      title: 'Spielwährung kaufen — Robux, V-Bucks, VP',
      description: 'Spielwährung für Roblox, Fortnite, Valorant und mehr, aus einem niederländischen Shop. Zahle mit iDEAL, geliefert automatisch oder von Hand.',
      h1: 'Spielwährung kaufen',
      sub: 'Alle Spielwährungen an einem Ort: Robux, V-Bucks, Valorant Points und mehr.',
    },
    fr: {
      title: 'Acheter de la monnaie de jeu — Robux, V-Bucks, VP',
      description: 'De la monnaie de jeu pour Roblox, Fortnite, Valorant et plus, depuis une boutique néerlandaise. Paie avec iDEAL, livraison automatique ou à la main.',
      h1: 'Acheter de la monnaie de jeu',
      sub: 'Toute la monnaie de jeu au même endroit : Robux, V-Bucks, Valorant Points et plus.',
    },
  },
};

/**
 * The landing page for a category, if it has one.
 *
 * Used by every internal link that would otherwise point at
 * `/shop?category=x`. That URL works for a visitor and is worth nothing to a
 * search engine: useMeta points its canonical at `/shop`, so the homepage — the
 * strongest page on the site — was spending all of its category link equity on
 * one destination. A link to `/robux` spends it on the page about Robux.
 *
 * Falls back to the query string, because a category with too few products to
 * deserve a page of its own still has to be browsable.
 */
export function landingPathFor(category) {
  const key = String(category || '').toLowerCase();
  if (!key) return '/shop';
  const hit = Object.entries(LANDING).find(([, def]) => def.category === key);
  return hit ? hit[0] : `/shop?category=${encodeURIComponent(key)}`;
}

/**
 * Pages that must not be indexed.
 *
 * Not because they are secret — the crawler simply has nothing to gain, and a
 * search result for someone else's checkout is a bad look. Kept here rather than
 * only in robots.txt, because robots.txt asks a crawler not to LOOK while
 * `noindex` tells it not to LIST, and the two are not the same thing.
 */
export const NOINDEX = new Set([
  '/cart', '/checkout', '/checkout/success', '/login', '/auth/callback', '/wishlist',
]);

/** Dutch aliases point at the same content — the English URL is canonical. */
export const ALIASES = {
  '/voorwaarden': '/terms',
  '/privacybeleid': '/privacy',
  '/cookiebeleid': '/cookies',
  '/retourbeleid': '/refunds',
};

/**
 * Metadata for a path, falling back to the homepage's.
 *
 * In the language asked for, not "Dutch or English". This picked between two
 * languages while the shop offered four, so a German reader's browser tab said
 * "Buy Robux, V-Bucks & gift cards" above a page written in German — on every
 * page of the site.
 */
export function metaFor(path, lang = 'nl') {
  const clean = (path || '/').replace(/\/+$/, '') || '/';
  const resolved = ALIASES[clean] || clean;
  const page = PAGES[resolved] || LANDING[resolved] || PAGES['/'];
  return page[lang] || page.en;
}

/** The canonical URL for a path — the alias resolves to the page it duplicates. */
export function canonicalFor(path) {
  const clean = (path || '/').replace(/\/+$/, '') || '/';
  return SITE.url + (ALIASES[clean] || clean);
}

// ── Structured data ─────────────────────────────────────────────────────────

/**
 * Who the shop is. Emitted on every page, because a search engine building an
 * entity for this site should not have to find the one page that mentions it.
 *
 * `legalIdentity.js` is still mostly empty, so the address is left OUT rather
 * than filled with a placeholder: schema.org markup that does not match the
 * page is a manual-action risk, and an invented address is exactly the kind
 * that gets one.
 */
export function organizationLd({ email, legal } = {}) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    '@id': `${SITE.url}/#organization`,
    name: SITE.name,
    url: SITE.url,
    logo: `${SITE.url}/icon-512.png`,
    image: `${SITE.url}${SITE.ogImage}`,
    description: PAGES['/'].en.description,
    areaServed: ['NL', 'BE'],
    currenciesAccepted: 'EUR',
    paymentAccepted: 'iDEAL, Bancontact, Apple Pay, Credit Card, PayPal',
  };
  if (email) {
    ld.contactPoint = {
      '@type': 'ContactPoint', contactType: 'customer support',
      email, availableLanguage: ['nl', 'en'],
    };
  }
  if (legal?.legalName) ld.legalName = legal.legalName;
  if (legal?.kvk) ld.identifier = { '@type': 'PropertyValue', name: 'KvK', value: legal.kvk };
  if (legal?.vat) ld.vatID = legal.vat;
  if (legal?.address && legal?.city) {
    ld.address = {
      '@type': 'PostalAddress',
      streetAddress: legal.address,
      postalCode: legal.postcode || undefined,
      addressLocality: legal.city,
      addressCountry: 'NL',
    };
  }
  return ld;
}

/** The site itself, with the search box a result page can offer. */
export const websiteLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE.url}/#website`,
  url: SITE.url,
  name: SITE.name,
  publisher: { '@id': `${SITE.url}/#organization` },
  potentialAction: {
    '@type': 'SearchAction',
    target: { '@type': 'EntryPoint', urlTemplate: `${SITE.url}/shop?search={search_term_string}` },
    'query-input': 'required name=search_term_string',
  },
});

/**
 * A category page, as a page about a category.
 *
 * Without it a landing page carried Organization, WebSite and a breadcrumb —
 * three blocks about the SITE and none about the page. This says what the URL
 * is: a collection, part of this website, published by this shop.
 *
 * Deliberately not an ItemList of the products on it. The products come from
 * the database at request time and this HTML is written at build time, so any
 * list here would be a guess — and structured data that does not match the page
 * is the one kind of markup that costs more than it earns.
 */
export function collectionLd(path, { name, description } = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${SITE.url}${path}#page`,
    url: SITE.url + path,
    name,
    description,
    isPartOf: { '@id': `${SITE.url}/#website` },
    about: { '@id': `${SITE.url}/#organization` },
    inLanguage: 'nl-NL',
  };
}

/** Where a page sits, so search results can show a path rather than a bare URL. */
export function breadcrumbLd(trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem', position: i + 1, name: t.name,
      item: t.path ? SITE.url + t.path : undefined,
    })),
  };
}

/**
 * A product, for a rich result.
 *
 * `availability` follows the shop's own honest flags rather than always saying
 * InStock: claiming stock that is not there is the single most common way a
 * merchant loses rich results, and it would also contradict the delivery copy
 * on the page itself.
 *
 * A rating is included ONLY when real reviews exist. schema.org lets you assert
 * an aggregate rating with no reviews behind it; Google treats that as spam,
 * and this shop has spent several rounds removing exactly that kind of claim.
 */
export function productLd(product, { reviewCount = 0, ratingValue = null } = {}) {
  const inStock = product.instant || (product.stockLeft ?? 0) > 0;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${SITE.url}/product/${product.id}#product`,
    name: product.name,
    description: product.description || product.shortDescription || undefined,
    sku: product.sku || product.id,
    category: product.category || undefined,
    brand: { '@type': 'Brand', name: SITE.name },
    offers: {
      '@type': 'Offer',
      url: `${SITE.url}/product/${product.id}`,
      priceCurrency: product.currency || 'EUR',
      price: ((product.price || 0) / 100).toFixed(2),
      availability: inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/PreOrder',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@id': `${SITE.url}/#organization` },
      // Digital goods with an EU withdrawal waiver — stated so the returns
      // policy shown in a rich result matches the one on /refunds.
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'NL',
        returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
        merchantReturnLink: `${SITE.url}/refunds`,
      },
    },
  };
  if (product.image) ld.image = product.image.startsWith('http') ? product.image : SITE.url + product.image;
  if (reviewCount > 0 && ratingValue) {
    ld.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(ratingValue).toFixed(1),
      reviewCount,
      bestRating: 5, worstRating: 1,
    };
  }
  return ld;
}

/** FAQ markup — only ever from questions genuinely rendered on the page. */
export function faqLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((q) => ({
      '@type': 'Question',
      name: q.q,
      acceptedAnswer: { '@type': 'Answer', text: q.a },
    })),
  };
}
