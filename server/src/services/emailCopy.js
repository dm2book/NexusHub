/**
 * The parts of an email the server writes rather than the template.
 *
 * A template is prose with tokens in it. Several of those tokens are filled by
 * code — the delivered-code card, the redeem instructions for the category that
 * was bought, the order breakdown, the withdrawal-right footnote, the "we still
 * need your username" block — and all of it was hardcoded Dutch. So translating
 * the templates alone would have produced a German email with a Dutch order
 * summary and Dutch redeem steps inside it, which is worse than one honest
 * language.
 *
 * Keyed by language, falling back to Dutch for anything unlisted, exactly like
 * the templates. Kept in one file rather than beside each generator, because
 * the failure mode being avoided is a phrase that exists in three languages in
 * one place and one language in another.
 */

const FALLBACK = 'nl';

/** How to use what was delivered, per product category. */
const REDEEM = {
  nl: {
    robux: { icon: '🎮', title: 'Zo wissel je je Robux-code in', where: 'roblox.com/redeem',
      steps: ['Log in bij Roblox en open <strong>roblox.com/redeem</strong>.', 'Plak de code hierboven en klik op <strong>Redeem</strong>.', 'De Robux komen op het account waarop je bent ingelogd — controleer even of dat de juiste is.'] },
    'v-bucks': { icon: '🪂', title: 'Zo wissel je je V-Bucks-code in', where: 'fortnite.com/vbuckscard',
      steps: ['Open <strong>fortnite.com/vbuckscard</strong> en log in op je Epic-account.', 'Vul de code hierboven in en bevestig.', 'V-Bucks gelden op elk platform van dat Epic-account.'] },
    valorant: { icon: '🎯', title: 'Zo wissel je je Valorant-code in', where: 'de winkel in de game',
      steps: ['Open Valorant en ga naar de <strong>Store</strong>.', 'Kies <strong>Redeem code</strong> (of wissel hem in op de site van Riot).', 'De Points staan meteen in je wallet.'] },
    'discord-nitro': { icon: '💜', title: 'Zo wissel je je Nitro-code in', where: 'discord.com/billing/promotions',
      steps: ['Open <strong>discord.com/billing/promotions</strong> terwijl je ingelogd bent.', 'Plak de code en bevestig.', 'Nitro is meteen actief op dat Discord-account.'] },
    giftcard: { icon: '🎁', title: 'Zo wissel je je giftcard in', where: 'de winkel waar hij bij hoort',
      steps: ['Open de winkel waar de kaart voor is (Steam, PlayStation, Xbox, …) en log in.', 'Zoek <strong>Code inwisselen</strong> / <strong>Tegoed toevoegen</strong> en plak de code hierboven.', 'Het saldo komt op dat account te staan — daarna kun je het niet meer verplaatsen.'] },
    gamepass: { icon: '🕹', title: 'Zo wissel je je Game Pass-code in', where: 'redeem.microsoft.com',
      steps: ['Open <strong>redeem.microsoft.com</strong> en log in met je Microsoft-account.', 'Vul de code in en bevestig.', 'Game Pass wordt actief op dat account — controleer of het het account is waarop je speelt.'] },
    spotify: { icon: '🎧', title: 'Zo wissel je je Spotify-code in', where: 'spotify.com/redeem',
      steps: ['Open <strong>spotify.com/redeem</strong> en log in.', 'Plak de code en bevestig.', 'Premium wordt toegevoegd aan dat Spotify-account.'] },
    minecraft: { icon: '⛏', title: 'Zo wissel je je Minecraft-code in', where: 'minecraft.net/redeem',
      steps: ['Open <strong>minecraft.net/redeem</strong> en log in.', 'Vul de code in en bevestig.', 'De aankoop is gekoppeld aan dat Microsoft-account.'] },
    _: { icon: '📩', title: 'Zo gebruik je je code', where: 'de game of winkel waar hij bij hoort',
      steps: ['Open de game of winkel waar deze top-up voor is en log in.', 'Zoek <strong>Code inwisselen</strong> in de shop of je accountinstellingen en plak de code hierboven.', 'Kom je er niet uit? Beantwoord deze mail met een screenshot, dan helpen we je erdoorheen.'] },
  },
  en: {
    robux: { icon: '🎮', title: 'How to redeem your Robux code', where: 'roblox.com/redeem',
      steps: ['Sign in to Roblox and open <strong>roblox.com/redeem</strong>.', 'Paste the code above and press <strong>Redeem</strong>.', 'The Robux land in the account you are signed in to — double-check it is the right one.'] },
    'v-bucks': { icon: '🪂', title: 'How to redeem your V-Bucks code', where: 'fortnite.com/vbuckscard',
      steps: ['Open <strong>fortnite.com/vbuckscard</strong> and sign in to your Epic account.', 'Enter the code above and confirm.', 'V-Bucks are shared across every platform on that Epic account.'] },
    valorant: { icon: '🎯', title: 'How to redeem your Valorant code', where: 'the in-game store',
      steps: ['Open Valorant and go to the <strong>Store</strong>.', 'Choose <strong>Redeem code</strong> (or redeem on the Riot website).', 'Points appear in your wallet straight away.'] },
    'discord-nitro': { icon: '💜', title: 'How to redeem your Nitro code', where: 'discord.com/billing/promotions',
      steps: ['Open <strong>discord.com/billing/promotions</strong> while signed in.', 'Paste the code and confirm.', 'Nitro activates on that Discord account immediately.'] },
    giftcard: { icon: '🎁', title: 'How to redeem your gift card', where: 'the store it belongs to',
      steps: ['Open the store the card is for (Steam, PlayStation, Xbox, …) and sign in.', 'Find <strong>Redeem code</strong> / <strong>Add funds</strong> and paste the code above.', 'The balance is added to that account — it cannot be moved afterwards.'] },
    gamepass: { icon: '🕹', title: 'How to redeem your Game Pass code', where: 'redeem.microsoft.com',
      steps: ['Open <strong>redeem.microsoft.com</strong> and sign in with your Microsoft account.', 'Enter the code and confirm.', 'Game Pass activates on that account — check it is the one you play on.'] },
    spotify: { icon: '🎧', title: 'How to redeem your Spotify code', where: 'spotify.com/redeem',
      steps: ['Open <strong>spotify.com/redeem</strong> and sign in.', 'Paste the code and confirm.', 'Premium is applied to that Spotify account.'] },
    minecraft: { icon: '⛏', title: 'How to redeem your Minecraft code', where: 'minecraft.net/redeem',
      steps: ['Open <strong>minecraft.net/redeem</strong> and sign in.', 'Enter the code and confirm.', 'The purchase is tied to that Microsoft account.'] },
    _: { icon: '📩', title: 'How to use your code', where: 'the game or store it belongs to',
      steps: ['Open the game or store this top-up is for and sign in.', 'Find <strong>Redeem code</strong> in the shop or account settings and paste the code above.', 'Stuck? Reply to this email with a screenshot and we will walk you through it.'] },
  },
  de: {
    robux: { icon: '🎮', title: 'So löst du deinen Robux-Code ein', where: 'roblox.com/redeem',
      steps: ['Melde dich bei Roblox an und öffne <strong>roblox.com/redeem</strong>.', 'Füg den Code oben ein und klick auf <strong>Redeem</strong>.', 'Die Robux landen auf dem Konto, in dem du angemeldet bist — prüf kurz, ob das das richtige ist.'] },
    'v-bucks': { icon: '🪂', title: 'So löst du deinen V-Bucks-Code ein', where: 'fortnite.com/vbuckscard',
      steps: ['Öffne <strong>fortnite.com/vbuckscard</strong> und melde dich bei deinem Epic-Konto an.', 'Gib den Code oben ein und bestätige.', 'V-Bucks gelten auf jeder Plattform dieses Epic-Kontos.'] },
    valorant: { icon: '🎯', title: 'So löst du deinen Valorant-Code ein', where: 'dem Ingame-Shop',
      steps: ['Öffne Valorant und geh in den <strong>Store</strong>.', 'Wähl <strong>Redeem code</strong> (oder löse ihn auf der Riot-Website ein).', 'Die Points sind sofort in deiner Wallet.'] },
    'discord-nitro': { icon: '💜', title: 'So löst du deinen Nitro-Code ein', where: 'discord.com/billing/promotions',
      steps: ['Öffne <strong>discord.com/billing/promotions</strong>, während du angemeldet bist.', 'Füg den Code ein und bestätige.', 'Nitro ist auf diesem Discord-Konto sofort aktiv.'] },
    giftcard: { icon: '🎁', title: 'So löst du deine Guthabenkarte ein', where: 'dem Shop, zu dem sie gehört',
      steps: ['Öffne den Shop, für den die Karte ist (Steam, PlayStation, Xbox, …), und melde dich an.', 'Such <strong>Code einlösen</strong> / <strong>Guthaben aufladen</strong> und füg den Code oben ein.', 'Das Guthaben landet auf diesem Konto — danach lässt es sich nicht mehr verschieben.'] },
    gamepass: { icon: '🕹', title: 'So löst du deinen Game-Pass-Code ein', where: 'redeem.microsoft.com',
      steps: ['Öffne <strong>redeem.microsoft.com</strong> und melde dich mit deinem Microsoft-Konto an.', 'Gib den Code ein und bestätige.', 'Game Pass wird auf diesem Konto aktiv — prüf, ob es das ist, auf dem du spielst.'] },
    spotify: { icon: '🎧', title: 'So löst du deinen Spotify-Code ein', where: 'spotify.com/redeem',
      steps: ['Öffne <strong>spotify.com/redeem</strong> und melde dich an.', 'Füg den Code ein und bestätige.', 'Premium wird diesem Spotify-Konto hinzugefügt.'] },
    minecraft: { icon: '⛏', title: 'So löst du deinen Minecraft-Code ein', where: 'minecraft.net/redeem',
      steps: ['Öffne <strong>minecraft.net/redeem</strong> und melde dich an.', 'Gib den Code ein und bestätige.', 'Der Kauf ist an dieses Microsoft-Konto gebunden.'] },
    _: { icon: '📩', title: 'So benutzt du deinen Code', where: 'dem Spiel oder Shop, zu dem er gehört',
      steps: ['Öffne das Spiel oder den Shop, für den dieses Guthaben ist, und melde dich an.', 'Such <strong>Code einlösen</strong> im Shop oder in den Kontoeinstellungen und füg den Code oben ein.', 'Kommst du nicht weiter? Antworte auf diese Mail mit einem Screenshot, dann gehen wir es mit dir durch.'] },
  },
  fr: {
    robux: { icon: '🎮', title: 'Comment utiliser ton code Robux', where: 'roblox.com/redeem',
      steps: ['Connecte-toi à Roblox et ouvre <strong>roblox.com/redeem</strong>.', 'Colle le code ci-dessus et clique sur <strong>Redeem</strong>.', 'Les Robux arrivent sur le compte auquel tu es connecté — vérifie que c’est le bon.'] },
    'v-bucks': { icon: '🪂', title: 'Comment utiliser ton code V-Bucks', where: 'fortnite.com/vbuckscard',
      steps: ['Ouvre <strong>fortnite.com/vbuckscard</strong> et connecte-toi à ton compte Epic.', 'Saisis le code ci-dessus et confirme.', 'Les V-Bucks valent sur toutes les plateformes de ce compte Epic.'] },
    valorant: { icon: '🎯', title: 'Comment utiliser ton code Valorant', where: 'la boutique en jeu',
      steps: ['Ouvre Valorant et va dans le <strong>Store</strong>.', 'Choisis <strong>Redeem code</strong> (ou utilise le site de Riot).', 'Les Points arrivent tout de suite dans ton portefeuille.'] },
    'discord-nitro': { icon: '💜', title: 'Comment utiliser ton code Nitro', where: 'discord.com/billing/promotions',
      steps: ['Ouvre <strong>discord.com/billing/promotions</strong> en étant connecté.', 'Colle le code et confirme.', 'Nitro s’active immédiatement sur ce compte Discord.'] },
    giftcard: { icon: '🎁', title: 'Comment utiliser ta carte cadeau', where: 'la boutique à laquelle elle appartient',
      steps: ['Ouvre la boutique concernée (Steam, PlayStation, Xbox, …) et connecte-toi.', 'Cherche <strong>Utiliser un code</strong> / <strong>Ajouter des fonds</strong> et colle le code ci-dessus.', 'Le solde est ajouté à ce compte — il ne peut plus être déplacé ensuite.'] },
    gamepass: { icon: '🕹', title: 'Comment utiliser ton code Game Pass', where: 'redeem.microsoft.com',
      steps: ['Ouvre <strong>redeem.microsoft.com</strong> et connecte-toi avec ton compte Microsoft.', 'Saisis le code et confirme.', 'Game Pass s’active sur ce compte — vérifie que c’est celui sur lequel tu joues.'] },
    spotify: { icon: '🎧', title: 'Comment utiliser ton code Spotify', where: 'spotify.com/redeem',
      steps: ['Ouvre <strong>spotify.com/redeem</strong> et connecte-toi.', 'Colle le code et confirme.', 'Premium est ajouté à ce compte Spotify.'] },
    minecraft: { icon: '⛏', title: 'Comment utiliser ton code Minecraft', where: 'minecraft.net/redeem',
      steps: ['Ouvre <strong>minecraft.net/redeem</strong> et connecte-toi.', 'Saisis le code et confirme.', 'L’achat est lié à ce compte Microsoft.'] },
    _: { icon: '📩', title: 'Comment utiliser ton code', where: 'le jeu ou la boutique concernée',
      steps: ['Ouvre le jeu ou la boutique pour laquelle ce crédit est prévu et connecte-toi.', 'Cherche <strong>Utiliser un code</strong> dans la boutique ou les paramètres du compte et colle le code ci-dessus.', 'Tu bloques ? Réponds à cet e-mail avec une capture et on t’accompagne.'] },
  },
};

/** Every other phrase the generated blocks need. */
const PHRASES = {
  nl: {
    redeemAt: 'Inwisselen op',
    deliveredTitle: '⚡ Rechtstreeks op je account geleverd',
    deliveredSub: 'Opgewaardeerd en klaar om te spelen — geen code om in te wisselen.',
    yourAccount: 'Je account',
    subtotal: 'Subtotaal', coupon: 'Kortingscode', memberOff: 'Forge+-korting',
    bundle: 'Bundel', credit: 'Tegoed', total: 'Totaal',
    withdrawalTitle: 'Herroepingsrecht',
    withdrawalConfirmed: (stamp, sentence) => `Op ${stamp} bevestigde je: “${sentence}”`,
    withdrawalDefault: (stamp) => `Op ${stamp} vroeg je om directe levering en erkende je dat het herroepingsrecht van 14 dagen vervalt zodra de bestelling geleverd is.`,
    withdrawalCancel: 'Tot de levering kun je nog annuleren — beantwoord daarvoor gewoon deze mail.',
    needTitle: '⚠️ We hebben nog één ding van je nodig',
    needBody: (need) => `Deze bestelling leveren we rechtstreeks op je account, dus we hebben je <strong style="color:#fff">${need}</strong> nodig. Beantwoord deze mail met alleen dat gegeven — daarna gaat je bestelling meteen de deur uit. We vragen <strong style="color:#fff">nooit</strong> om je wachtwoord.`,
    payExact: (amt) => `Betaal ${amt} — het bedrag staat er al in`,
    paySendTo: (amt, target) => `Maak ${amt} over naar ${target}`,
    payPrefilled: 'bedrag staat er al in',
    payOr: 'Of maak het zelf over', payComplete: 'Rond je betaling af',
    payHow: (number) => `Betaal via een van de methoden hieronder en zet je bestelnummer <strong>${number}</strong> erbij als kenmerk. Je bestelling is bevestigd zodra we hem binnen hebben.`,
  },
  en: {
    redeemAt: 'Redeem at',
    deliveredTitle: '⚡ Delivered straight to your account',
    deliveredSub: 'Topped up and ready to play — no code to redeem.',
    yourAccount: 'Your account',
    subtotal: 'Subtotal', coupon: 'Coupon', memberOff: 'Forge+ discount',
    bundle: 'Bundle', credit: 'Store credit', total: 'Total',
    withdrawalTitle: 'Right of withdrawal',
    withdrawalConfirmed: (stamp, sentence) => `On ${stamp} you confirmed: “${sentence}”`,
    withdrawalDefault: (stamp) => `On ${stamp} you asked for immediate delivery and acknowledged that the 14-day right of withdrawal lapses once the order has been delivered.`,
    withdrawalCancel: 'Until delivery you can still cancel — just reply to this email.',
    needTitle: '⚠️ We still need one thing from you',
    needBody: (need) => `This order is delivered straight to your account, so we need your <strong style="color:#fff">${need}</strong>. Reply to this email with just that, and your order goes out right away. We <strong style="color:#fff">never</strong> ask for your password.`,
    payExact: (amt) => `Pay ${amt} — the amount is already filled in`,
    paySendTo: (amt, target) => `Send ${amt} to ${target}`,
    payPrefilled: 'amount filled in',
    payOr: 'Or pay it yourself', payComplete: 'Complete your payment',
    payHow: (number) => `Pay using one of the methods below and put your order number <strong>${number}</strong> as the reference. Your order is confirmed as soon as we receive it.`,
  },
  de: {
    redeemAt: 'Einlösen auf',
    deliveredTitle: '⚡ Direkt auf dein Konto geliefert',
    deliveredSub: 'Aufgeladen und startklar — kein Code zum Einlösen.',
    yourAccount: 'Dein Konto',
    subtotal: 'Zwischensumme', coupon: 'Rabattcode', memberOff: 'Forge+-Rabatt',
    bundle: 'Bündel', credit: 'Guthaben', total: 'Gesamt',
    withdrawalTitle: 'Widerrufsrecht',
    withdrawalConfirmed: (stamp, sentence) => `Am ${stamp} hast du bestätigt: „${sentence}"`,
    withdrawalDefault: (stamp) => `Am ${stamp} hast du um sofortige Lieferung gebeten und anerkannt, dass das 14-tägige Widerrufsrecht erlischt, sobald die Bestellung geliefert ist.`,
    withdrawalCancel: 'Bis zur Lieferung kannst du noch stornieren — antworte dafür einfach auf diese Mail.',
    needTitle: '⚠️ Wir brauchen noch eine Sache von dir',
    needBody: (need) => `Diese Bestellung liefern wir direkt auf dein Konto, wir brauchen also dein <strong style="color:#fff">${need}</strong>. Antworte auf diese Mail mit nur dieser Angabe — dann geht deine Bestellung sofort raus. Nach deinem Passwort fragen wir <strong style="color:#fff">nie</strong>.`,
    payExact: (amt) => `Zahle ${amt} — der Betrag steht schon drin`,
    paySendTo: (amt, target) => `Überweise ${amt} an ${target}`,
    payPrefilled: 'Betrag steht schon drin',
    payOr: 'Oder überweise selbst', payComplete: 'Schließ deine Zahlung ab',
    payHow: (number) => `Zahl über eine der Methoden unten und gib deine Bestellnummer <strong>${number}</strong> als Verwendungszweck an. Deine Bestellung ist bestätigt, sobald wir sie haben.`,
  },
  fr: {
    redeemAt: 'À utiliser sur',
    deliveredTitle: '⚡ Livré directement sur ton compte',
    deliveredSub: 'Crédité et prêt à jouer — aucun code à utiliser.',
    yourAccount: 'Ton compte',
    subtotal: 'Sous-total', coupon: 'Code de réduction', memberOff: 'Remise Forge+',
    bundle: 'Pack', credit: 'Crédit boutique', total: 'Total',
    withdrawalTitle: 'Droit de rétractation',
    withdrawalConfirmed: (stamp, sentence) => `Le ${stamp} tu as confirmé : « ${sentence} »`,
    withdrawalDefault: (stamp) => `Le ${stamp} tu as demandé une livraison immédiate et reconnu que le droit de rétractation de 14 jours s’éteint dès que la commande est livrée.`,
    withdrawalCancel: 'Jusqu’à la livraison tu peux encore annuler — réponds simplement à cet e-mail.',
    needTitle: '⚠️ Il nous manque encore une chose',
    needBody: (need) => `Cette commande est livrée directement sur ton compte : il nous faut donc ton <strong style="color:#fff">${need}</strong>. Réponds à cet e-mail avec seulement cette information et ta commande part tout de suite. Nous ne demandons <strong style="color:#fff">jamais</strong> ton mot de passe.`,
    payExact: (amt) => `Paie ${amt} — le montant est déjà rempli`,
    paySendTo: (amt, target) => `Vire ${amt} à ${target}`,
    payPrefilled: 'montant déjà rempli',
    payOr: 'Ou fais le virement toi-même', payComplete: 'Termine ton paiement',
    payHow: (number) => `Paie avec un des moyens ci-dessous et mets ton numéro de commande <strong>${number}</strong> en référence. Ta commande est confirmée dès que nous le recevons.`,
  },
};

/** Phrases for a language, falling back to Dutch. */
export function emailCopy(lang) {
  return PHRASES[lang] || PHRASES[FALLBACK];
}

/** The redeem recipe for a category, falling back to the generic one. */
export function redeemSteps(lang, category) {
  const table = REDEEM[lang] || REDEEM[FALLBACK];
  return table[String(category || '').toLowerCase()] || null;
}

/** The generic recipe, for an order whose categories have no recipe of their own. */
export function redeemFallback(lang) {
  return (REDEEM[lang] || REDEEM[FALLBACK])._;
}

export const EMAIL_LANGS = Object.keys(PHRASES);
