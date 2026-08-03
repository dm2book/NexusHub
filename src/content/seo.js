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

export const SITE = {
  name: 'ForgeMarket',
  url: 'https://forgemarket.nl',
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
  },
  '/shop': {
    nl: {
      title: 'Alle producten — game currency & giftcards',
      description: 'De volledige catalogus: Robux, V-Bucks, Valorant Points, Steam, Discord Nitro en giftcards. Prijzen inclusief btw, betalen met iDEAL.',
    },
    en: {
      title: 'All products — game currency & gift cards',
      description: 'The full catalogue: Robux, V-Bucks, Valorant Points, Steam, Discord Nitro and gift cards. Prices include VAT, pay with iDEAL.',
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
  },
  '/terms': {
    nl: { title: 'Algemene voorwaarden', description: 'De voorwaarden die gelden bij elke bestelling: betaling, levering, herroepingsrecht en terugbetaling.' },
    en: { title: 'Terms and conditions', description: 'The terms that apply to every order: payment, delivery, right of withdrawal and refunds.' },
  },
  '/privacy': {
    nl: { title: 'Privacybeleid', description: 'Welke persoonsgegevens ForgeMarket verwerkt, op welke grondslag, hoe lang ze bewaard worden en welke rechten je hebt.' },
    en: { title: 'Privacy policy', description: 'What personal data ForgeMarket processes, on what legal basis, how long it is kept, and your rights.' },
  },
  '/cookies': {
    nl: { title: 'Cookiebeleid', description: 'Welke cookies ForgeMarket plaatst, wat er in je eigen browser blijft, en waarom deze site geen cookiebanner heeft.' },
    en: { title: 'Cookie policy', description: 'Which cookies ForgeMarket sets, what stays in your own browser, and why this site has no cookie banner.' },
  },
  '/login': {
    nl: { title: 'Inloggen', description: 'Log in zonder wachtwoord met een code per e-mail, of ga verder met Discord.' },
    en: { title: 'Sign in', description: 'Sign in without a password using a code sent by email, or continue with Discord.' },
  },
  '/cart': {
    nl: { title: 'Winkelwagen', description: 'De producten in je winkelwagen, met het totaal inclusief btw en de betaalmethoden die je bij het afrekenen kunt kiezen.' },
    en: { title: 'Cart', description: 'The products in your cart, with the total including VAT and the payment methods you can choose at checkout.' },
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
 */
export const LANDING = {
  '/robux': {
    category: 'robux',
    nl: {
      title: 'Robux kopen — direct op je Roblox-account',
      description: 'Robux kopen met iDEAL. Wat op voorraad staat gaat automatisch de deur uit; de rest zetten we met de hand op je Roblox-account, meestal binnen een paar uur.',
      h1: 'Robux kopen',
    },
    en: {
      title: 'Buy Robux — straight to your Roblox account',
      description: 'Buy Robux with iDEAL. What is in stock goes out automatically; the rest we add to your Roblox account by hand, usually within a few hours.',
      h1: 'Buy Robux',
    },
  },
  '/v-bucks': {
    category: 'v-bucks',
    nl: {
      title: 'V-Bucks kopen voor Fortnite — snel geleverd',
      description: 'V-Bucks kopen met iDEAL, Bancontact of PayPal. Op voorraad wordt automatisch geleverd, de rest met de hand binnen een paar uur.',
      h1: 'V-Bucks kopen',
    },
    en: {
      title: 'Buy V-Bucks for Fortnite — delivered fast',
      description: 'Buy V-Bucks with iDEAL, Bancontact or PayPal. In stock is delivered automatically, the rest by hand within a few hours.',
      h1: 'Buy V-Bucks',
    },
  },
  '/valorant-points': {
    category: 'valorant',
    nl: {
      title: 'Valorant Points kopen — VP met iDEAL',
      description: 'Valorant Points kopen bij een Nederlandse shop. Betaal met iDEAL en krijg je VP automatisch of met de hand geleverd, meestal binnen een paar uur.',
      h1: 'Valorant Points kopen',
    },
    en: {
      title: 'Buy Valorant Points — VP with iDEAL',
      description: 'Buy Valorant Points from a Dutch shop. Pay with iDEAL and get your VP automatically or delivered by hand, usually within a few hours.',
      h1: 'Buy Valorant Points',
    },
  },
  '/giftcards': {
    category: 'giftcard',
    nl: {
      title: 'Giftcards kopen — Steam, PlayStation, Xbox',
      description: 'Digitale giftcards voor Steam, PlayStation, Xbox, Netflix en meer. Code per e-mail, betalen met iDEAL, geld terug als we niet kunnen leveren.',
      h1: 'Giftcards kopen',
    },
    en: {
      title: 'Buy gift cards — Steam, PlayStation, Xbox',
      description: 'Digital gift cards for Steam, PlayStation, Xbox, Netflix and more. Code by email, pay with iDEAL, money back if we cannot deliver.',
      h1: 'Buy gift cards',
    },
  },
  '/game-currency': {
    category: '',
    nl: {
      title: 'Game currency kopen — Robux, V-Bucks, VP',
      description: 'Game currency voor Roblox, Fortnite, Valorant en meer, bij één Nederlandse shop. Betalen met iDEAL, levering automatisch of met de hand.',
      h1: 'Game currency kopen',
    },
    en: {
      title: 'Buy game currency — Robux, V-Bucks, VP',
      description: 'Game currency for Roblox, Fortnite, Valorant and more, from one Dutch shop. Pay with iDEAL, delivered automatically or by hand.',
      h1: 'Buy game currency',
    },
  },
};

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

/** Metadata for a path, falling back to the homepage's. */
export function metaFor(path, lang = 'nl') {
  const clean = (path || '/').replace(/\/+$/, '') || '/';
  const resolved = ALIASES[clean] || clean;
  const page = PAGES[resolved] || LANDING[resolved] || PAGES['/'];
  return page[lang === 'nl' ? 'nl' : 'en'];
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
