/**
 * The member-facing replies, in the four languages the shop is read in.
 *
 * /order, /price and /delivery already answered in the member's language; the
 * replies a member meets FIRST — the welcome DM, verification, opening a
 * ticket, /help, /vouch, entering a giveaway — were English only, on a server
 * whose house room is Dutch. Same rule as orderStatus.js: a language picked in
 * #roles beats Discord's own locale, and anything we do not write falls back
 * to English.
 *
 * Copy rule for every line here: nothing we cannot back up. No speed promises,
 * no counts, no perks that do not exist.
 */
import { botLang } from './orderStatus.js';

const S = {
  /* —— welcome DM —— */
  welcomeTitle: {
    nl: 'Welkom bij {guild} ⚡', en: 'Welcome to {guild} ⚡',
    de: 'Willkommen bei {guild} ⚡', fr: 'Bienvenue sur {guild} ⚡',
  },
  welcomeBody: {
    nl: 'Hoi {name}, fijn dat je er bent.\n\n**Stap 1 — accepteer de regels.** Ga naar {verify} en druk op de groene knop. '
      + 'Dan gaan de winkelkanalen, giveaways en support open.\n\nAl nieuwsgierig? {howto} en {faq} kun je nu al lezen.',
    en: 'Hey {name}, glad you\'re here.\n\n**Step 1 — accept the rules.** Go to {verify} and press the green button. '
      + 'That unlocks the shop channels, giveaways and support.\n\nAlready curious? {howto} and {faq} are readable right now.',
    de: 'Hey {name}, schön, dass du da bist.\n\n**Schritt 1 — Regeln akzeptieren.** Geh zu {verify} und drück den grünen Button. '
      + 'Dann öffnen sich die Shop-Kanäle, Giveaways und der Support.\n\nSchon neugierig? {howto} und {faq} kannst du jetzt schon lesen.',
    fr: 'Salut {name}, content de te voir.\n\n**Étape 1 — accepte les règles.** Va dans {verify} et appuie sur le bouton vert. '
      + 'Ça débloque les salons boutique, les giveaways et le support.\n\nDéjà curieux ? {howto} et {faq} sont lisibles dès maintenant.',
  },
  /* Staff never DM first — but this bot does, about orders and alerts the
     member asked for. Saying "anyone who DMs you is a scammer" while the bot
     itself DMs payment reminders taught members to distrust the one DM that
     was real. */
  safety: {
    nl: '🛡️ **Veilig blijven:** staff stuurt je nooit als eerste een DM. De enige DM\'s van ons komen van deze bot, '
      + 'alleen over je eigen bestellingen of meldingen die je zelf aanzette — en hij vraagt nooit om een wachtwoord of code. '
      + 'Iemand anders die je een "deal" stuurt? Melden.',
    en: '🛡️ **Stay safe:** staff never DM you first. The only DMs from us come from this bot, only about your own '
      + 'orders or alerts you turned on — and it never asks for a password or a code. Anyone else DMing you a "deal"? Report them.',
    de: '🛡️ **Bleib sicher:** Das Team schreibt dir nie zuerst. Die einzigen DMs von uns kommen von diesem Bot, nur zu '
      + 'deinen eigenen Bestellungen oder Benachrichtigungen, die du eingeschaltet hast — und er fragt nie nach Passwort oder Code. '
      + 'Jemand anderes schickt dir einen „Deal“? Melden.',
    fr: '🛡️ **Reste prudent :** l\'équipe ne t\'écrit jamais en premier. Les seuls MP de notre part viennent de ce bot, '
      + 'uniquement pour tes propres commandes ou les alertes que tu as activées — et il ne demande jamais de mot de passe ni de code. '
      + 'Quelqu\'un d\'autre t\'envoie un « deal » ? Signale-le.',
  },
  promise: {
    nl: 'Geld terug als het nooit aankomt · een echt mens op support · geen account nodig om te kopen.',
    en: 'Money back if it never arrives · a real person on support · no account needed to buy.',
    de: 'Geld zurück, wenn nichts ankommt · ein echter Mensch im Support · kein Konto zum Kaufen nötig.',
    fr: 'Remboursé si rien n\'arrive · une vraie personne au support · pas de compte nécessaire pour acheter.',
  },
  track: { nl: '📦 Bestelling volgen', en: '📦 Track an order', de: '📦 Bestellung verfolgen', fr: '📦 Suivre une commande' },

  /* —— verification —— */
  alreadyVerified: { nl: 'Je hebt de regels al geaccepteerd ✅', en: 'You\'ve already accepted the rules ✅',
    de: 'Du hast die Regeln schon akzeptiert ✅', fr: 'Tu as déjà accepté les règles ✅' },
  rulesTitle: { nl: '📜 Lees & accepteer de regels', en: '📜 Read & accept the rules',
    de: '📜 Regeln lesen & akzeptieren', fr: '📜 Lis & accepte les règles' },
  rulesPrompt: { nl: 'Druk op de groene knop om de regels te accepteren en de server te openen.',
    en: 'Press the green button below to accept the rules and unlock the server.',
    de: 'Drück den grünen Button, um die Regeln zu akzeptieren und den Server freizuschalten.',
    fr: 'Appuie sur le bouton vert pour accepter les règles et débloquer le serveur.' },
  agree: { nl: 'Ik ga akkoord', en: 'I agree', de: 'Ich stimme zu', fr: 'J\'accepte' },
  tooYoung: {
    nl: '👋 Je Discord-account is jonger dan 7 dagen. Om spam-accounts buiten te houden openen we de server pas daarna automatisch — '
      + 'maar je hoeft niet te wachten: open een ticket via de knop hieronder, dan helpt een mens je meteen verder.',
    en: '👋 Your Discord account is less than 7 days old. To keep spam accounts out, the server only unlocks automatically after that — '
      + 'but you don\'t have to wait: open a ticket with the button below and a person will let you in.',
    de: '👋 Dein Discord-Konto ist jünger als 7 Tage. Um Spam-Konten fernzuhalten, wird der Server erst danach automatisch freigeschaltet — '
      + 'du musst aber nicht warten: Öffne über den Button unten ein Ticket, dann hilft dir ein Mensch weiter.',
    fr: '👋 Ton compte Discord a moins de 7 jours. Pour écarter les comptes de spam, le serveur ne se débloque automatiquement qu\'après — '
      + 'mais pas besoin d\'attendre : ouvre un ticket avec le bouton ci-dessous et une personne te fera entrer.',
  },
  openTicket: { nl: 'Open een ticket', en: 'Open a ticket', de: 'Ticket öffnen', fr: 'Ouvrir un ticket' },
  verifyFailed: {
    nl: '⚠️ Ik kon je de rol niet geven — mijn eigen rol staat eronder, dus Discord blokkeerde het. Dit ligt aan ons: '
      + 'een admin is ingelicht. Probeer het daarna nog eens.',
    en: '⚠️ I couldn\'t give you the role — my own role is ranked below it, so Discord blocked me. This is on us: '
      + 'an admin has been notified. Try again after that.',
    de: '⚠️ Ich konnte dir die Rolle nicht geben — meine eigene Rolle steht darunter, also hat Discord blockiert. Das liegt an uns: '
      + 'ein Admin ist informiert. Versuch es danach noch einmal.',
    fr: '⚠️ Je n\'ai pas pu te donner le rôle — mon propre rôle est classé en dessous, Discord m\'a bloqué. C\'est de notre faute : '
      + 'un admin a été prévenu. Réessaie ensuite.',
  },
  verified: {
    nl: '✅ **Welkom!** Je hebt de regels geaccepteerd en de hele server staat open.',
    en: '✅ **Welcome in!** You\'ve accepted the rules and the full server is unlocked.',
    de: '✅ **Willkommen!** Du hast die Regeln akzeptiert, der ganze Server ist freigeschaltet.',
    fr: '✅ **Bienvenue !** Tu as accepté les règles et tout le serveur est débloqué.',
  },
  verifiedNext: {
    nl: 'Stel je vraag in {ask}, kijk rond in {products} en kies je games in {roles} voor restock-meldingen. 🎮',
    en: 'Ask me anything in {ask}, browse {products} and pick your games in {roles} to hear about restocks. 🎮',
    de: 'Frag mich alles in {ask}, stöbere in {products} und wähle deine Spiele in {roles} für Restock-Meldungen. 🎮',
    fr: 'Pose tes questions dans {ask}, parcours {products} et choisis tes jeux dans {roles} pour les alertes de réassort. 🎮',
  },
  pickLang: { nl: 'Kies hieronder je taal en je chatkamer gaat open.', en: 'Pick your language below and your chat room opens.',
    de: 'Wähle unten deine Sprache, dann öffnet sich dein Chatraum.', fr: 'Choisis ta langue ci-dessous et ton salon s\'ouvre.' },
  verifyFirst: {
    nl: 'Accepteer eerst de regels in {verify} — één tik en alles gaat open. Een bestelling volgen? `/order` werkt meteen.',
    en: 'Accept the rules in {verify} first — one tap and everything unlocks. Tracking an order? `/order` works right away.',
    de: 'Akzeptiere zuerst die Regeln in {verify} — ein Tipp und alles ist offen. Bestellung verfolgen? `/order` geht sofort.',
    fr: 'Accepte d\'abord les règles dans {verify} — un clic et tout se débloque. Suivre une commande ? `/order` marche tout de suite.',
  },

  /* —— tickets —— */
  ticketExists: { nl: 'Je hebt al een open ticket: {ch}', en: 'You already have an open ticket: {ch}',
    de: 'Du hast schon ein offenes Ticket: {ch}', fr: 'Tu as déjà un ticket ouvert : {ch}' },
  ticketReady: { nl: '✅ Je ticket staat klaar: {ch}', en: '✅ Your ticket is ready: {ch}',
    de: '✅ Dein Ticket ist bereit: {ch}', fr: '✅ Ton ticket est prêt : {ch}' },
  ticketFailed: {
    nl: '⚠️ Ik kon je ticket niet aanmaken — vraag een admin om mijn rechten te controleren.',
    en: '⚠️ I couldn\'t create your ticket — please ask an admin to check my permissions.',
    de: '⚠️ Ich konnte dein Ticket nicht erstellen — bitte einen Admin, meine Rechte zu prüfen.',
    fr: '⚠️ Je n\'ai pas pu créer ton ticket — demande à un admin de vérifier mes permissions.',
  },
  ticketHello: {
    nl: 'Hoi {user}, bedankt voor je bericht! Een teamlid kijkt er zo snel mogelijk naar.',
    en: 'Hi {user}, thanks for reaching out! A team member will look at this as soon as they can.',
    de: 'Hi {user}, danke für deine Nachricht! Ein Teammitglied schaut so bald wie möglich drauf.',
    fr: 'Salut {user}, merci pour ton message ! Un membre de l\'équipe s\'en occupe dès que possible.',
  },
  ticketAsk: {
    nl: '**Zo gaat het sneller:**\n• Je **bestelnummer** (als je er een hebt)\n• Een korte uitleg\n• Screenshots als dat helpt',
    en: '**To speed things up, please share:**\n• Your **order number** (if any)\n• A short description of the issue\n• Screenshots if relevant',
    de: '**So geht es schneller:**\n• Deine **Bestellnummer** (falls vorhanden)\n• Eine kurze Beschreibung\n• Screenshots, wenn hilfreich',
    fr: '**Pour aller plus vite :**\n• Ton **numéro de commande** (si tu en as un)\n• Une courte description\n• Des captures si utile',
  },
  ticketScreens: { nl: 'Screenshots toevoegen mag altijd.', en: 'Feel free to add screenshots if relevant.',
    de: 'Screenshots kannst du gern ergänzen.', fr: 'N\'hésite pas à ajouter des captures.' },
  closeTitle: { nl: 'Dit ticket sluiten?', en: 'Close this ticket?', de: 'Dieses Ticket schließen?', fr: 'Fermer ce ticket ?' },
  closeBody: {
    nl: 'Het kanaal wordt een paar seconden na het sluiten verwijderd. De eigenaar krijgt het transcript per DM en een kopie gaat naar #ticket-logs — maar het gesprek kan hier niet heropend worden.',
    en: 'The channel is deleted a few seconds after closing. The owner gets the transcript by DM and a copy goes to #ticket-logs — but the conversation cannot be reopened here.',
    de: 'Der Kanal wird ein paar Sekunden nach dem Schließen gelöscht. Der Ersteller bekommt das Protokoll per DM, eine Kopie geht an #ticket-logs — das Gespräch kann hier aber nicht wieder geöffnet werden.',
    fr: 'Le salon est supprimé quelques secondes après la fermeture. Le propriétaire reçoit la transcription en MP et une copie va dans #ticket-logs — mais la conversation ne peut pas être rouverte ici.',
  },
  closeYes: { nl: 'Ja, sluiten', en: 'Yes, close it', de: 'Ja, schließen', fr: 'Oui, fermer' },
  closeNo: { nl: 'Open laten', en: 'Keep it open', de: 'Offen lassen', fr: 'Laisser ouvert' },
  closing: {
    nl: '🔒 Ticket gesloten door {user} — transcript wordt bewaard. Het kanaal verdwijnt over een paar seconden.',
    en: '🔒 Ticket closed by {user} — saving a transcript. The channel disappears in a few seconds.',
    de: '🔒 Ticket geschlossen von {user} — Protokoll wird gespeichert. Der Kanal verschwindet in ein paar Sekunden.',
    fr: '🔒 Ticket fermé par {user} — transcription enregistrée. Le salon disparaît dans quelques secondes.',
  },
  transcriptDm: {
    nl: 'Hier is het transcript van je ForgeMarket-ticket (gesloten door {by}).\n\n**Hoe was onze support?** Geef hieronder een cijfer 👇',
    en: 'Here\'s the transcript of your ForgeMarket ticket (closed by {by}).\n\n**How was our support?** Tap a rating below 👇',
    de: 'Hier ist das Protokoll deines ForgeMarket-Tickets (geschlossen von {by}).\n\n**Wie war unser Support?** Bewerte unten 👇',
    fr: 'Voici la transcription de ton ticket ForgeMarket (fermé par {by}).\n\n**Comment était notre support ?** Note-nous ci-dessous 👇',
  },

  /* —— /vouch —— */
  vouchVerifyFirst: { nl: 'Accepteer eerst de regels in {verify} voordat je een vouch achterlaat 💚',
    en: 'Accept the rules in {verify} before leaving a vouch 💚',
    de: 'Akzeptiere zuerst die Regeln in {verify}, bevor du einen Vouch hinterlässt 💚',
    fr: 'Accepte d\'abord les règles dans {verify} avant de laisser un avis 💚' },
  vouchRecent: { nl: 'Je hebt net al een vouch geplaatst — dank je! Later kan het weer. 💚',
    en: 'You already vouched recently — thank you! You can vouch again in a bit. 💚',
    de: 'Du hast gerade schon einen Vouch hinterlassen — danke! Später geht es wieder. 💚',
    fr: 'Tu as déjà laissé un avis récemment — merci ! Tu pourras recommencer plus tard. 💚' },
  vouchThanksVerified: {
    nl: 'Bedankt! 💚 Je vouch staat in {ch} met het label **Geverifieerde aankoop** — we zagen een afgeronde bestelling op je gekoppelde account. Op de website verschijnt hij nadat een mens hem gelezen heeft.',
    en: 'Thanks! 💚 Your vouch is up in {ch}, labelled **Verified purchase** — we found a completed order on your linked account. It goes on the website once a person has read it.',
    de: 'Danke! 💚 Dein Vouch steht in {ch} mit dem Label **Verifizierter Kauf** — wir haben eine abgeschlossene Bestellung auf deinem verknüpften Konto gefunden. Auf der Website erscheint er, sobald ein Mensch ihn gelesen hat.',
    fr: 'Merci ! 💚 Ton avis est publié dans {ch} avec le label **Achat vérifié** — nous avons trouvé une commande terminée sur ton compte lié. Il apparaîtra sur le site une fois lu par une personne.',
  },
  vouchThanksCommunity: {
    nl: 'Bedankt! 💚 Je vouch staat in {ch} als **community vouch**. Koppel je Discord op de site en bestel eens, dan krijgen je volgende vouches het label "Geverifieerde aankoop".',
    en: 'Thanks! 💚 Your vouch is up in {ch} as a **community vouch**. Link Discord on the site and place an order, and your next vouches carry the "Verified purchase" label.',
    de: 'Danke! 💚 Dein Vouch steht in {ch} als **Community-Vouch**. Verknüpfe Discord auf der Website und bestelle, dann tragen deine nächsten Vouches das Label „Verifizierter Kauf“.',
    fr: 'Merci ! 💚 Ton avis est publié dans {ch} comme **avis de la communauté**. Lie Discord sur le site et passe une commande, et tes prochains avis porteront le label « Achat vérifié ».',
  },
  trustpilotAsk: { nl: '⭐ Wil je hem ook op Trustpilot zetten? Dat helpt echt: {url}',
    en: '⭐ Would you put it on Trustpilot too? It helps more than you\'d think: {url}',
    de: '⭐ Magst du ihn auch auf Trustpilot posten? Das hilft wirklich: {url}',
    fr: '⭐ Tu veux aussi le mettre sur Trustpilot ? Ça aide vraiment : {url}' },

  /* —— giveaways —— */
  gwEnded: { nl: 'Deze giveaway is afgelopen.', en: 'This giveaway has ended.', de: 'Dieses Giveaway ist beendet.', fr: 'Ce giveaway est terminé.' },
  gwVerifyFirst: { nl: 'Accepteer eerst de regels in {verify} om mee te doen. ✅', en: 'Accept the rules in {verify} first to enter. ✅',
    de: 'Akzeptiere zuerst die Regeln in {verify}, um mitzumachen. ✅', fr: 'Accepte d\'abord les règles dans {verify} pour participer. ✅' },
  gwTooYoung: {
    nl: 'Meedoen kan met een Discord-account van minstens 7 dagen oud (zie de actievoorwaarden in {terms}). Volgende keer ben je erbij!',
    en: 'Entry needs a Discord account at least 7 days old (see the terms in {terms}). You\'ll be in next time!',
    de: 'Teilnahme nur mit einem Discord-Konto, das mindestens 7 Tage alt ist (siehe Teilnahmebedingungen in {terms}). Nächstes Mal bist du dabei!',
    fr: 'Il faut un compte Discord d\'au moins 7 jours pour participer (voir le règlement dans {terms}). La prochaine fois, ce sera bon !',
  },
  gwLeft: { nl: 'Je doet niet meer mee. 👋', en: 'You left the giveaway. 👋', de: 'Du nimmst nicht mehr teil. 👋', fr: 'Tu as quitté le giveaway. 👋' },
  gwIn: { nl: '🎉 Je doet mee! Eén deelname per persoon, iedereen dezelfde kans. (Nog eens tikken = uitschrijven.)',
    en: '🎉 You\'re in! One entry per person, everyone has the same chance. (Tap again to leave.)',
    de: '🎉 Du bist dabei! Eine Teilnahme pro Person, alle haben dieselbe Chance. (Nochmal tippen = austreten.)',
    fr: '🎉 Tu participes ! Une participation par personne, tout le monde a la même chance. (Appuie encore pour te retirer.)' },

  /* —— limits —— */
  slowDown: { nl: '⏳ Even rustig aan — probeer het over {min} min opnieuw.', en: '⏳ Easy there — try again in {min} min.',
    de: '⏳ Langsam — versuch es in {min} Min. noch mal.', fr: '⏳ Doucement — réessaie dans {min} min.' },
  aiCap: {
    nl: 'De assistent heeft zijn limiet voor vandaag bereikt, dus hier het standaardantwoord. Morgen kan het weer — of open een ticket voor een mens.',
    en: 'The assistant has reached its limit for today, so here is the standard answer. It\'s back tomorrow — or open a ticket for a person.',
    de: 'Der Assistent hat sein Tageslimit erreicht, hier die Standardantwort. Morgen geht es wieder — oder öffne ein Ticket für einen Menschen.',
    fr: 'L\'assistant a atteint sa limite du jour, voici donc la réponse standard. Il revient demain — ou ouvre un ticket pour parler à une personne.',
  },
};

/** One string, in one language, with {placeholders} filled. Never undefined. */
export function t(key, lang = 'en', vars = {}) {
  const row = S[key];
  if (!row) return '';
  const text = row[botLang(lang)] ?? row.en ?? '';
  return text.replace(/\{(\w+)\}/g, (whole, k) => (k in vars ? String(vars[k]) : whole));
}

export const STRINGS = S;

/** /help, as data: the member blocks for each language. */
export const HELP = {
  nl: {
    author: 'ForgeMarket — wat ik kan', intro: 'Alles hieronder is een slash-commando: typ `/` en kies.',
    order: ['📦 Je bestelling', '`/order` — live status van een bestelling (zonder account)\n`/delivery` — hoe een product geleverd en ingewisseld wordt\n`/price` — actuele prijs van een product'],
    shop: ['🛒 Winkelen', '`/ask` — vraag me alles over producten of prijzen\n`/shop` — open de winkel\n`/drops` — komende drops & restocks\n`/ref` — je referral-link: 5% van elke bestelling die hij oplevert, als winkeltegoed'],
    community: ['💬 Community', '`/vouch` — laat een vouch achter\n`/suggest` — stel iets voor (de server stemt)\n`/rank` · `/daily` · `/leaderboard` — XP en streaks\n`/balance` — je Forge Coins & tegoed\n`/poll` · `/invite` · `/stats` · `/serverinfo`'],
    help: ['🆘 Gaat er iets mis?', 'Open een ticket in **#open-a-ticket** met je bestelnummer — een echt mens antwoordt. Komt een bestelling nooit aan, dan krijg je je geld terug.\n\n🛡️ Staff stuurt je nooit als eerste een DM en vraagt nooit om je wachtwoord.'],
    footer: 'Chatten en voice leveren XP op — levelrollen gaan automatisch',
  },
  en: {
    author: 'ForgeMarket — what I can do', intro: 'Everything below is a slash command: type `/` and pick it.',
    order: ['📦 Your order', '`/order` — live status of an order (works without an account)\n`/delivery` — how a product is delivered and redeemed\n`/price` — current price of any product'],
    shop: ['🛒 Shopping', '`/ask` — ask me anything about products or prices\n`/shop` — open the store\n`/drops` — upcoming drops & restocks\n`/ref` — your referral link: 5% of every order it brings, as store credit'],
    community: ['💬 Community', '`/vouch` — leave a vouch\n`/suggest` — suggest an idea (the server votes)\n`/rank` · `/daily` · `/leaderboard` — XP, streaks and the top members\n`/balance` — your Forge Coins & store credit\n`/poll` · `/invite` · `/stats` · `/serverinfo`'],
    help: ['🆘 Something wrong?', 'Open a ticket in **#open-a-ticket** with your order number — a real person answers. If an order never arrives, you get your money back.\n\n🛡️ Staff will **never** DM you first and never ask for your password.'],
    footer: 'Chat and voice both earn XP — level roles are automatic',
  },
  de: {
    author: 'ForgeMarket — was ich kann', intro: 'Alles unten ist ein Slash-Befehl: tippe `/` und wähle.',
    order: ['📦 Deine Bestellung', '`/order` — Live-Status einer Bestellung (ohne Konto)\n`/delivery` — wie ein Produkt geliefert und eingelöst wird\n`/price` — aktueller Preis eines Produkts'],
    shop: ['🛒 Einkaufen', '`/ask` — frag mich alles zu Produkten oder Preisen\n`/shop` — Shop öffnen\n`/drops` — kommende Drops & Restocks\n`/ref` — dein Empfehlungslink: 5 % jeder Bestellung darüber, als Guthaben'],
    community: ['💬 Community', '`/vouch` — Vouch hinterlassen\n`/suggest` — Idee vorschlagen (der Server stimmt ab)\n`/rank` · `/daily` · `/leaderboard` — XP und Streaks\n`/balance` — deine Forge Coins & dein Guthaben\n`/poll` · `/invite` · `/stats` · `/serverinfo`'],
    help: ['🆘 Stimmt etwas nicht?', 'Öffne ein Ticket in **#open-a-ticket** mit deiner Bestellnummer — ein echter Mensch antwortet. Kommt eine Bestellung nie an, bekommst du dein Geld zurück.\n\n🛡️ Das Team schreibt dir **nie** zuerst und fragt nie nach deinem Passwort.'],
    footer: 'Chat und Voice bringen XP — Level-Rollen kommen automatisch',
  },
  fr: {
    author: 'ForgeMarket — ce que je sais faire', intro: 'Tout ci-dessous est une commande slash : tape `/` et choisis.',
    order: ['📦 Ta commande', '`/order` — statut en direct d\'une commande (sans compte)\n`/delivery` — comment un produit est livré et utilisé\n`/price` — prix actuel d\'un produit'],
    shop: ['🛒 Boutique', '`/ask` — pose-moi tes questions sur les produits ou les prix\n`/shop` — ouvrir la boutique\n`/drops` — drops & réassorts à venir\n`/ref` — ton lien de parrainage : 5 % de chaque commande, en crédit boutique'],
    community: ['💬 Communauté', '`/vouch` — laisser un avis\n`/suggest` — proposer une idée (le serveur vote)\n`/rank` · `/daily` · `/leaderboard` — XP et séries\n`/balance` — tes Forge Coins & ton crédit\n`/poll` · `/invite` · `/stats` · `/serverinfo`'],
    help: ['🆘 Un problème ?', 'Ouvre un ticket dans **#open-a-ticket** avec ton numéro de commande — une vraie personne répond. Si une commande n\'arrive jamais, tu es remboursé.\n\n🛡️ L\'équipe ne t\'écrira **jamais** en premier et ne demande jamais ton mot de passe.'],
    footer: 'Le chat et le vocal rapportent de l\'XP — les rôles de niveau sont automatiques',
  },
};

export const helpFor = (lang) => HELP[botLang(lang)] || HELP.en;
