/**
 * How to redeem what was delivered, per product category, in every language.
 *
 * These eight recipes were written for the delivery email and lived inside
 * server/src/services/emailCopy.js, where only the email could reach them.
 * Meanwhile the product page and the Discord bot answered "how is this
 * delivered?" from a table with TWO entries — robux and v-bucks — so a buyer
 * asking about Valorant, Nitro, Game Pass, Spotify, Minecraft or a gift card
 * got "delivered as an official code, or topped up straight onto your account
 * — depending on the product", while the exact steps sat a directory away,
 * already translated.
 *
 * Moved here, to the place both trees can read, for the same reason
 * productCopy.js lives here: the server imports from src/lib, never the other
 * way round. Word for word — nothing about how anything is redeemed changed.
 */
export const REDEEM = {
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
