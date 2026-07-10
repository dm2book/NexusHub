/**
 * Per-category delivery explanation, shown on every product page (and mirrored
 * in Discord). Tells the buyer exactly HOW their order arrives and what they
 * need to do — the #1 question for game top-ups, and a big trust builder.
 *
 * Keyed by product category. Anything without a specific entry falls back to
 * `default` (code / top-up). Bilingual (en / nl) to match the storefront.
 */
export const DELIVERY_INFO = {
  robux: {
    en: {
      method: 'Sent straight to your Roblox account via the official Group Payout (“Roblox+”) method — no password or login needed, and fully account-safe.',
      steps: [
        'Turn on 2-Step Verification (2FA) on your Roblox account — required before we can deliver.',
        'Join our Roblox group — we send you the link right after your order.',
        'We pay the Robux out to your account. Done! 🎉',
      ],
      notes: [
        'Roblox allows a maximum of 5,000 R$ per account per day. Bigger orders are automatically split across days — e.g. 10,000 R$ arrives over 2 days.',
        'Large orders can be delivered faster through 2 accounts: a colleague and I each complete part of your order at the same time.',
        'We will NEVER ask for your password — the payout method never needs it.',
      ],
    },
    nl: {
      method: 'Rechtstreeks op je Roblox-account via de officiële Group Payout (“Roblox+”)-methode — geen wachtwoord of inloggen nodig, en 100% account-veilig.',
      steps: [
        'Zet 2-staps-verificatie (2FA) aan op je Roblox-account — verplicht voordat we kunnen leveren.',
        'Word lid van onze Roblox-groep — de link krijg je direct na je bestelling.',
        'Wij storten de Robux op je account. Klaar! 🎉',
      ],
      notes: [
        'Roblox staat maximaal 5.000 R$ per account per dag toe. Grotere bestellingen splitsen we automatisch over meerdere dagen — bijv. 10.000 R$ komt in 2 dagen binnen.',
        'Grote bestellingen leveren we sneller via 2 accounts: een collega en ik voltooien allebei een deel van je bestelling tegelijk.',
        'We vragen NOOIT om je wachtwoord — de uitbetaalmethode heeft dat nooit nodig.',
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
  },
};

/** Delivery info for a category in the given language (falls back to default / en). */
export function deliveryInfo(category, lang = 'en') {
  const entry = DELIVERY_INFO[category] || DELIVERY_INFO.default;
  return entry[lang] || entry.en;
}
