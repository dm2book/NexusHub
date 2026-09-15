/**
 * Per-category delivery explanation, shown on every product page (and mirrored
 * in Discord). Tells the buyer exactly HOW their order arrives and what they
 * need to do — the #1 question for game top-ups, and a big trust builder.
 *
 * Keyed by product category. Anything without a specific entry falls back to
 * `default` (code / top-up). One set per language the storefront offers — it
 * was en/nl only, so `entry[lang] || entry.en` handed a German buyer the
 * delivery terms of their own order in English, including the sentence about
 * never being asked for a password.
 */
export const DELIVERY_INFO = {
  robux: {
    /* The one detail the buyer has to hand over, named once here.
       The product page asks "Do you need my account details?" only when it
       knows what the answer is — and it was reading a `deliveryField` that is
       set on 0 of the 72 products, so the question never appeared on any page.
       For Robux the answer was already written three lines down, in the steps:
       a username, never a password. That is the single most reassuring thing
       this category can say and it was the one thing the FAQ left out. */
    field: {
      en: 'Roblox username', nl: 'Roblox-gebruikersnaam',
      de: 'Roblox-Benutzername', fr: 'nom d’utilisateur Roblox',
    },
    en: {
      // "Roblox+" is a third-party browser extension, not a Roblox product, so
      // calling it official was simply false — and "fully account-safe" is an
      // absolute guarantee no top-up service can honestly make. What is left is
      // what the steps below actually describe and we can stand behind.
      method: 'Sent straight to your Roblox account — we only need your username, never your password, and you never log in anywhere.',
      steps: [
        'Turn on 2-Step Verification (2FA) on your Roblox account — required before we can deliver.',
        'Send us your Roblox username (in your order or a support ticket).',
        'We deliver the Robux to your account. Done! 🎉',
      ],
      notes: [
        'Roblox allows a maximum of 5,000 R$ per account per day. Bigger orders are automatically split across days — e.g. 10,000 R$ arrives over 2 days.',
        'Large orders can be delivered faster through 2 accounts: a colleague and I each complete part of your order at the same time.',
        'We will NEVER ask for your password — the payout method never needs it.',
      ],
    },
    nl: {
      method: 'Rechtstreeks op je Roblox-account — we hebben alleen je gebruikersnaam nodig, nooit je wachtwoord, en je logt nergens in.',
      steps: [
        'Zet 2-staps-verificatie (2FA) aan op je Roblox-account — verplicht voordat we kunnen leveren.',
        'Geef ons je Roblox-gebruikersnaam door (in je bestelling of via een ticket).',
        'Wij leveren de Robux op je account. Klaar! 🎉',
      ],
      notes: [
        'Roblox staat maximaal 5.000 R$ per account per dag toe. Grotere bestellingen splitsen we automatisch over meerdere dagen — bijv. 10.000 R$ komt in 2 dagen binnen.',
        'Grote bestellingen leveren we sneller via 2 accounts: een collega en ik voltooien allebei een deel van je bestelling tegelijk.',
        'We vragen NOOIT om je wachtwoord — de uitbetaalmethode heeft dat nooit nodig.',
      ],
    },
    de: {
      method: 'Direkt auf dein Roblox-Konto — wir brauchen nur deinen Benutzernamen, niemals dein Passwort, und du loggst dich nirgendwo ein.',
      steps: [
        'Aktiviere die Bestätigung in zwei Schritten (2FA) in deinem Roblox-Konto — ohne sie können wir nicht liefern.',
        'Schick uns deinen Roblox-Benutzernamen (in deiner Bestellung oder per Ticket).',
        'Wir liefern die Robux auf dein Konto. Fertig! 🎉',
      ],
      notes: [
        'Roblox erlaubt höchstens 5.000 R$ pro Konto und Tag. Größere Bestellungen teilen wir automatisch auf mehrere Tage auf — 10.000 R$ kommen also über 2 Tage an.',
        'Große Bestellungen liefern wir schneller über 2 Konten: ein Kollege und ich erledigen gleichzeitig je einen Teil deiner Bestellung.',
        'Wir fragen NIEMALS nach deinem Passwort — der Auszahlungsweg braucht es nie.',
      ],
    },
    fr: {
      method: 'Directement sur ton compte Roblox — nous avons seulement besoin de ton nom d’utilisateur, jamais de ton mot de passe, et tu ne te connectes nulle part.',
      steps: [
        'Active la validation en deux étapes (2FA) sur ton compte Roblox — obligatoire avant que nous puissions livrer.',
        'Envoie-nous ton nom d’utilisateur Roblox (dans ta commande ou par ticket).',
        'Nous livrons les Robux sur ton compte. C’est fait ! 🎉',
      ],
      notes: [
        'Roblox autorise au maximum 5 000 R$ par compte et par jour. Les commandes plus grandes sont réparties automatiquement sur plusieurs jours — 10 000 R$ arrivent donc en 2 jours.',
        'Les grosses commandes sont livrées plus vite via 2 comptes : un collègue et moi traitons chacun une partie de ta commande en même temps.',
        'Nous ne demanderons JAMAIS ton mot de passe — le moyen de versement n’en a jamais besoin.',
      ],
    },
  },

  'v-bucks': {
    en: {
      method: 'Delivered as an official V-Bucks gift card code that you redeem yourself — works on every platform.',
      steps: [
        'Your code appears instantly in your dashboard and by email.',
        'Redeem it in Fortnite or on your Epic Games account.',
        'Your V-Bucks show up right away. 🎮',
      ],
      notes: [
        'Codes are region-based — make sure your account matches the region shown on the product.',
        'Keep your code private: once redeemed, a code can’t be refunded.',
      ],
    },
    nl: {
      method: 'Geleverd als een officiële V-Bucks giftcard-code die je zelf inwisselt — werkt op elk platform.',
      steps: [
        'Je code verschijnt direct in je dashboard en per e-mail.',
        'Wissel hem in bij Fortnite of op je Epic Games-account.',
        'Je V-Bucks staan er meteen op. 🎮',
      ],
      notes: [
        'Codes zijn regio-gebonden — zorg dat je account bij de regio op het product past.',
        'Houd je code privé: eenmaal ingewisseld kan een code niet worden terugbetaald.',
      ],
    },
    de: {
      method: 'Geliefert als offizieller V-Bucks-Geschenkkartencode, den du selbst einlöst — funktioniert auf jeder Plattform.',
      steps: [
        'Dein Code erscheint sofort in deinem Dashboard und per E-Mail.',
        'Löse ihn in Fortnite oder in deinem Epic-Games-Konto ein.',
        'Deine V-Bucks sind sofort da. 🎮',
      ],
      notes: [
        'Codes sind regionsgebunden — achte darauf, dass dein Konto zur Region auf dem Produkt passt.',
        'Behalte deinen Code für dich: einmal eingelöst, lässt sich ein Code nicht erstatten.',
      ],
    },
    fr: {
      method: 'Livré sous forme de code de carte cadeau V-Bucks officiel que tu utilises toi-même — fonctionne sur toutes les plateformes.',
      steps: [
        'Ton code apparaît immédiatement dans ton tableau de bord et par e-mail.',
        'Utilise-le dans Fortnite ou sur ton compte Epic Games.',
        'Tes V-Bucks arrivent tout de suite. 🎮',
      ],
      notes: [
        'Les codes dépendent de la région — vérifie que ton compte correspond à la région indiquée sur le produit.',
        'Garde ton code pour toi : une fois utilisé, un code ne peut pas être remboursé.',
      ],
    },
  },

  default: {
    en: {
      method: 'Delivered as an official code (or a direct top-up, depending on the product) — instant and account-safe.',
      steps: [
        'After payment your code / confirmation appears in your dashboard and by email.',
        'Follow the short redeem steps we include with it.',
        'Enjoy — you’re all set. ✅',
      ],
      notes: [
        'Any account requirements (like enabling 2FA or matching your region) are shown before checkout and in our Discord.',
        'Stuck or something not right? Open a ticket — we help fast and eligible orders are money-back guaranteed.',
      ],
    },
    nl: {
      method: 'Geleverd als een officiële code (of een directe top-up, afhankelijk van het product) — direct en account-veilig.',
      steps: [
        'Na betaling verschijnt je code / bevestiging in je dashboard en per e-mail.',
        'Volg de korte inwissel-stappen die we erbij zetten.',
        'Klaar — veel plezier! ✅',
      ],
      notes: [
        'Eventuele account-vereisten (zoals 2FA aanzetten of je regio) zie je vóór het afrekenen en in onze Discord.',
        'Loopt iets niet goed? Open een ticket — we helpen snel en in aanmerking komende bestellingen zijn met geld-terug-garantie.',
      ],
    },
    de: {
      method: 'Geliefert als offizieller Code (oder als direkte Aufladung, je nach Produkt) — sofort und kontosicher.',
      steps: [
        'Nach der Zahlung erscheint dein Code bzw. deine Bestätigung im Dashboard und per E-Mail.',
        'Folge den kurzen Einlöseschritten, die wir mitschicken.',
        'Fertig — viel Spaß! ✅',
      ],
      notes: [
        'Etwaige Kontovoraussetzungen (etwa 2FA aktivieren oder die passende Region) siehst du vor dem Bezahlen und in unserem Discord.',
        'Hängt etwas oder stimmt etwas nicht? Öffne ein Ticket — wir helfen schnell, und infrage kommende Bestellungen haben Geld-zurück-Garantie.',
      ],
    },
    fr: {
      method: 'Livré sous forme de code officiel (ou de recharge directe, selon le produit) — immédiat et sans risque pour ton compte.',
      steps: [
        'Après le paiement, ton code ou ta confirmation apparaît dans ton tableau de bord et par e-mail.',
        'Suis les quelques étapes d’utilisation que nous joignons.',
        'C’est tout — bon jeu ! ✅',
      ],
      notes: [
        'Les éventuelles conditions de compte (activer la 2FA, correspondre à la bonne région) sont indiquées avant le paiement et sur notre Discord.',
        'Quelque chose bloque ou ne va pas ? Ouvre un ticket — nous aidons vite, et les commandes éligibles sont garanties satisfait ou remboursé.',
      ],
    },
  },
};

/** Delivery info for a category in the given language (falls back to default / en). */
export function deliveryInfo(category, lang = 'en') {
  const entry = DELIVERY_INFO[category] || DELIVERY_INFO.default;
  return entry[lang] || entry.en;
}

/**
 * The one thing the buyer has to hand over for this category, or null.
 *
 * A product may state its own `deliveryField`; none of the 72 currently do, so
 * without this the FAQ's "Do you need my account details?" never rendered on a
 * single page — including the five Robux products, where the answer ("your
 * username, never your password") is the most reassuring sentence available.
 */
export function deliveryField(category, lang = 'en') {
  const f = DELIVERY_INFO[category]?.field;
  return f ? (f[lang] || f.en) : null;
}
