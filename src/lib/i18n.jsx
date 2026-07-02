/* eslint-disable react-refresh/only-export-components */
/**
 * Lightweight storefront i18n (EN default, NL translation) — no dependencies.
 *
 * Usage: const { t, lang, setLang } = useI18n();
 *        t('cart.title', 'Your cart')   ← key + English default inline
 *
 * English lives at the call site (always readable, nothing can "miss"); the NL
 * dictionary below only maps keys → Dutch. Unknown keys fall back to English,
 * so a missing translation can never break the UI. The choice persists in
 * localStorage and defaults to the browser language on first visit.
 */
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';

const NL = {
  // Navigation
  'nav.home': 'Home',
  'nav.products': 'Alle producten',
  'nav.reviews': 'Reviews',
  'nav.how': 'Hoe het werkt',
  'nav.support': 'Klantenservice',
  'nav.search': 'Zoek producten...',
  'nav.login': 'Inloggen',
  'nav.signup': 'Account maken',
  'nav.account': 'Account',

  // Footer
  'footer.tagline': 'Dé marketplace voor digitale producten — direct geleverd, realtime te volgen.',
  'footer.discord': '💬 Join onze Discord',
  'footer.shop': 'Winkel',
  'footer.company': 'Bedrijf',
  'footer.help': 'Hulp & juridisch',
  'footer.allProducts': 'Alle producten',
  'footer.wishlist': 'Verlanglijst',
  'footer.track': 'Bestelling volgen',
  'footer.payments': 'Betaalmethoden',
  'footer.about': 'Over ons',
  'footer.how': 'Hoe het werkt',
  'footer.trust': 'Trust Center',
  'footer.reviews': 'Reviews',
  'footer.contact': 'Contact',
  'footer.faq': 'FAQ',
  'footer.refunds': 'Terugbetalingsbeleid',
  'footer.terms': 'Voorwaarden',
  'footer.privacy': 'Privacy',
  'footer.rights': 'Directe digitale levering',
  'status.ok': '● Alle systemen operationeel',
  'status.degraded': '● Gedeeltelijke storing — bestellingen kunnen vertraagd zijn',

  // Home
  'home.badge': '#1 vertrouwde marketplace',
  'home.h1a': 'Alles wat je nodig hebt,',
  'home.h1b': 'op één plek.',
  'home.sub': 'Koop Robux, V-Bucks, Valorant Points en meer — direct geleverd. Snelle levering, veilige betalingen, 24/7 support.',
  'home.shopNow': 'Shop nu',
  'home.shopNowBig': 'Shop nu',
  'home.viewAll': 'Bekijk alle producten',
  'home.happy': 'tevreden klanten',
  'home.popular': 'Populaire producten',
  'home.packs': '{n} pakketten beschikbaar',
  'home.from': 'Vanaf',
  'home.moreCategories': 'Meer categorieën',
  'home.offer': 'Aanbieding',
  'home.botHi': 'Hoi! 👋 Waarmee kan ik je helpen?',
  'home.chat': 'Chat met ons',
  'home.reviewsTitle': 'Wat onze klanten zeggen',
  'home.outOf5': 'van de 5',
  'home.basedOn': 'Op basis van {n} reviews',
  'home.beFirst': 'Wees de eerste die na een aankoop een geverifieerde review achterlaat.',
  'home.joinDiscord': 'Join onze Discord',
  'home.discordSub': 'Krijg support, updates en exclusieve giveaways!',
  'home.membersOnline': 'leden online',
  'home.joinBtn': 'Join Discord',

  // Cart
  'cart.title': 'Je winkelwagen',
  'cart.empty': 'Je winkelwagen is leeg',
  'cart.emptySub': 'Bekijk de shop en voeg wat digitale producten toe.',
  'cart.browse': 'Naar de shop',
  'cart.each': 'per stuk',
  'cart.summary': 'Besteloverzicht',
  'cart.subtotal': 'Subtotaal',
  'cart.delivery': 'Levering',
  'cart.instantFree': 'Direct · Gratis',
  'cart.total': 'Totaal',
  'cart.checkout': 'Afrekenen',
  'cart.continue': 'Verder winkelen',
  'cart.popular': 'Populair op dit moment',
  'cart.completeOrder': 'Maak je bestelling compleet',
  'cart.added': 'toegevoegd',

  // Shop
  'shop.browseCategories': 'CATEGORIEËN',
  'shop.all': 'Alle producten',
  'shop.tagline': 'Digitale producten, direct geleverd in je inbox & dashboard.',
  'shop.trending': 'Nu populair',
  'shop.loading': 'Laden…',
  'shop.search': 'Zoek producten…',
  'shop.sortPopular': 'Populair',
  'shop.sortPriceAsc': 'Prijs: laag → hoog',
  'shop.sortPriceDesc': 'Prijs: hoog → laag',
  'shop.sortName': 'Naam A–Z',
  'shop.none': 'Nog geen producten',
  'shop.noMatches': 'Geen resultaten',
  'shop.noneSub': 'Producten verschijnen hier zodra ze zijn toegevoegd.',
  'shop.noMatchesSub': 'Probeer een andere categorie of zoekterm.',

  // Product page
  'product.back': 'Terug naar shop',
  'product.addToCart': 'In winkelwagen',
  'product.buyNow': 'Direct kopen',
  'product.instant': 'Directe levering',
  'product.instantSub': 'Codes binnen seconden',
  'product.protected': 'Kopersbescherming',
  'product.protectedSub': 'Geld-terug-garantie',
  'product.verified': 'Geverifieerde reviews',
  'product.verifiedSub': 'Alleen echte aankopen',
  'product.support': '24/7 support',
  'product.supportSub': 'Altijd bereikbaar',
  'product.onlyLeft': 'Nog maar {n} beschikbaar',
  'product.reviewsAll': 'Alle reviews →',
  'product.related': 'Vergelijkbare producten',

  // Checkout
  'checkout.title': 'Afrekenen',
  'checkout.back': 'Terug naar winkelwagen',
  'checkout.details': 'Jouw gegevens',
  'checkout.email': 'E-mailadres',
  'checkout.name': 'Volledige naam',
  'checkout.pay': 'Bestelling plaatsen',
  'checkout.summary': 'Besteloverzicht',

  // Track
  'track.title': 'Volg je bestelling',
  'track.placeholder': 'Bestelnummer (bijv. FM-2026-000123)',
  'track.button': 'Zoek bestelling',
};

const LanguageContext = createContext({
  lang: 'en',
  setLang: () => {},
  t: (_key, en) => en,
});

function initialLang() {
  try {
    const stored = localStorage.getItem('fm_lang');
    if (stored === 'nl' || stored === 'en') return stored;
    return (navigator.language || '').toLowerCase().startsWith('nl') ? 'nl' : 'en';
  } catch { return 'en'; }
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(initialLang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const setLang = useCallback((l) => {
    try { localStorage.setItem('fm_lang', l); } catch { /* private mode */ }
    setLangState(l);
  }, []);

  // {n}-style tokens are substituted from vars: t('x', 'Only {n} left', {n: 3}).
  const t = useCallback((key, en, vars) => {
    let s = lang === 'nl' ? (NL[key] ?? en) : en;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  return useContext(LanguageContext);
}
