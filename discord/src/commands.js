/**
 * Every slash command, defined once.
 *
 * register-commands.js used to own this list and the bot never registered
 * anything itself, so a deploy that added a command shipped a handler nobody
 * could reach until someone remembered `npm run register`. Both now build from
 * here: the script for a manual run, the bot on every ClientReady (a PUT, so
 * registering the same list twice changes nothing).
 *
 * Names stay English — the README, the panels and the FAQ all say `/order`,
 * and a localized name would make every one of those wrong for a Dutch
 * member. Descriptions are what Discord shows in the picker, so those are
 * translated (nl/de/fr, English is the base).
 *
 * Default permissions hide staff and owner commands from members' pickers.
 * They are a UI default the server owner can change in Server Settings →
 * Integrations, NOT the security boundary — bot.js still checks every one.
 */
import { SlashCommandBuilder, PermissionFlagsBits, REST, Routes } from 'discord.js';

const OWNER = PermissionFlagsBits.ManageGuild;
const STAFF = PermissionFlagsBits.ManageMessages;

/** [name, en, {nl, de, fr}, permission?, build?] */
const DEFS = [
  ['help', 'How to use ForgeMarket & the assistant',
    { nl: 'Hoe ForgeMarket en de assistent werken', de: 'So funktionieren ForgeMarket & der Assistent', fr: 'Comment utiliser ForgeMarket et l’assistant' }],
  ['ask', 'Ask the ForgeMarket assistant anything',
    { nl: 'Stel de ForgeMarket-assistent een vraag', de: 'Frag den ForgeMarket-Assistenten', fr: 'Pose une question à l’assistant ForgeMarket' }, null,
    (c) => c.addStringOption((o) => o.setName('question').setDescription('Your question')
      .setDescriptionLocalizations({ nl: 'Je vraag', de: 'Deine Frage', fr: 'Ta question' }).setRequired(true))],
  ['recommend', 'Get a product recommendation',
    { nl: 'Krijg een productadvies', de: 'Hol dir eine Produktempfehlung', fr: 'Obtiens une recommandation de produit' }, null,
    (c) => c.addStringOption((o) => o.setName('game').setDescription('Which game? e.g. Roblox, Fortnite')
      .setDescriptionLocalizations({ nl: 'Welk spel? bv. Roblox, Fortnite', de: 'Welches Spiel? z. B. Roblox, Fortnite', fr: 'Quel jeu ? ex. Roblox, Fortnite' }))
      .addStringOption((o) => o.setName('budget').setDescription('Your budget, e.g. €20')
        .setDescriptionLocalizations({ nl: 'Je budget, bv. €20', de: 'Dein Budget, z. B. 20 €', fr: 'Ton budget, ex. 20 €' }))],
  ['order', 'Check the status of an order',
    { nl: 'Bekijk de status van een bestelling', de: 'Status einer Bestellung prüfen', fr: 'Vérifier le statut d’une commande' }, null,
    (c) => c.addStringOption((o) => o.setName('number').setDescription('Your order number, e.g. FM-2026-XXXX')
      .setDescriptionLocalizations({ nl: 'Je bestelnummer, bv. FM-2026-XXXX', de: 'Deine Bestellnummer, z. B. FM-2026-XXXX', fr: 'Ton numéro de commande, ex. FM-2026-XXXX' })
      .setRequired(true))],
  ['price', 'Look up a product’s live price',
    { nl: 'Zoek de actuele prijs van een product', de: 'Aktuellen Preis eines Produkts nachschlagen', fr: 'Voir le prix actuel d’un produit' }, null,
    (c) => c.addStringOption((o) => o.setName('product').setDescription('e.g. 1700 Robux, Nitro, Valorant')
      .setDescriptionLocalizations({ nl: 'bv. 1700 Robux, Nitro, Valorant', de: 'z. B. 1700 Robux, Nitro, Valorant', fr: 'ex. 1700 Robux, Nitro, Valorant' }).setRequired(true))],
  ['delivery', 'How a product is delivered (steps + what you need)',
    { nl: 'Hoe een product geleverd wordt (stappen + wat je nodig hebt)', de: 'Wie ein Produkt geliefert wird (Schritte + was du brauchst)', fr: 'Comment un produit est livré (étapes + ce qu’il te faut)' }, null,
    (c) => c.addStringOption((o) => o.setName('product').setDescription('e.g. Robux, V-Bucks')
      .setDescriptionLocalizations({ nl: 'bv. Robux, V-Bucks', de: 'z. B. Robux, V-Bucks', fr: 'ex. Robux, V-Bucks' }).setRequired(true))],
  ['drops', 'See upcoming drops, restocks & sales',
    { nl: 'Bekijk komende drops, restocks & acties', de: 'Kommende Drops, Restocks & Aktionen', fr: 'Voir les drops, réassorts & promos à venir' }],
  ['poll', 'Start a quick poll (👍/👎 or up to 4 options)',
    { nl: 'Start een snelle poll (👍/👎 of tot 4 opties)', de: 'Schnelle Umfrage starten (👍/👎 oder bis zu 4 Optionen)', fr: 'Lancer un sondage rapide (👍/👎 ou jusqu’à 4 options)' }, null,
    (c) => c.addStringOption((o) => o.setName('question').setDescription('The poll question')
      .setDescriptionLocalizations({ nl: 'De pollvraag', de: 'Die Umfragefrage', fr: 'La question du sondage' }).setRequired(true))
      .addStringOption((o) => o.setName('option1').setDescription('Option 1'))
      .addStringOption((o) => o.setName('option2').setDescription('Option 2'))
      .addStringOption((o) => o.setName('option3').setDescription('Option 3'))
      .addStringOption((o) => o.setName('option4').setDescription('Option 4'))],
  ['daily', 'Claim your daily XP bonus (build a streak!)',
    { nl: 'Haal je dagelijkse XP-bonus op (bouw een streak!)', de: 'Hol dir deinen täglichen XP-Bonus (bau eine Serie auf!)', fr: 'Récupère ton bonus d’XP quotidien (fais une série !)' }],
  ['vouch', 'Leave a vouch for ForgeMarket',
    { nl: 'Laat een vouch achter voor ForgeMarket', de: 'Hinterlasse einen Vouch für ForgeMarket', fr: 'Laisse un avis pour ForgeMarket' }, null,
    /* Stars are required: a default of 5 turned "I didn't pick" into a
       five-star rating. Required options must come before optional ones. */
    (c) => c.addIntegerOption((o) => o.setName('stars').setDescription('1–5 stars')
      .setDescriptionLocalizations({ nl: '1–5 sterren', de: '1–5 Sterne', fr: '1 à 5 étoiles' })
      .setMinValue(1).setMaxValue(5).setRequired(true))
      .addStringOption((o) => o.setName('message').setDescription('Your experience')
        .setDescriptionLocalizations({ nl: 'Je ervaring', de: 'Deine Erfahrung', fr: 'Ton expérience' }).setRequired(true))],
  ['giveaway', 'Staff: start a giveaway',
    { nl: 'Staff: start een giveaway', de: 'Team: Giveaway starten', fr: 'Équipe : lancer un giveaway' }, STAFF,
    (c) => c.addStringOption((o) => o.setName('prize').setDescription('What are you giving away? (a code or store credit)').setRequired(true))
      .addIntegerOption((o) => o.setName('minutes').setDescription('Duration in minutes (default 10, max 14 days)').setMinValue(1).setMaxValue(20160))
      .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners (default 1)').setMinValue(1).setMaxValue(20))],
  ['reroll', 'Staff: draw a new giveaway winner',
    { nl: 'Staff: trek een nieuwe giveaway-winnaar', de: 'Team: neuen Giveaway-Gewinner ziehen', fr: 'Équipe : tirer un nouveau gagnant' }, STAFF,
    (c) => c.addStringOption((o) => o.setName('message_id').setDescription('The giveaway message ID').setRequired(true))],
  ['rank', 'Show your level & XP',
    { nl: 'Toon je level & XP', de: 'Zeig dein Level & XP', fr: 'Affiche ton niveau & ton XP' }],
  ['balance', 'Check your Forge Coins, store credit & loyalty tier',
    { nl: 'Bekijk je Forge Coins, tegoed & loyaliteitsniveau', de: 'Forge Coins, Guthaben & Treuestufe ansehen', fr: 'Voir tes Forge Coins, ton crédit & ton palier' }],
  ['ref', 'Your referral link — earn a cut of every order you send',
    { nl: 'Je referral-link — verdien mee aan elke bestelling die je stuurt', de: 'Dein Empfehlungslink — verdiene an jeder Bestellung mit', fr: 'Ton lien de parrainage — gagne une part de chaque commande' }],
  ['leaderboard', 'Show the top members by XP',
    { nl: 'Toon de leden met de meeste XP', de: 'Top-Mitglieder nach XP', fr: 'Les membres avec le plus d’XP' }],
  ['suggest', 'Suggest an idea for ForgeMarket',
    { nl: 'Stel een idee voor ForgeMarket voor', de: 'Schlage eine Idee für ForgeMarket vor', fr: 'Propose une idée pour ForgeMarket' }, null,
    (c) => c.addStringOption((o) => o.setName('idea').setDescription('Your suggestion')
      .setDescriptionLocalizations({ nl: 'Je idee', de: 'Dein Vorschlag', fr: 'Ta suggestion' }).setRequired(true))],
  ['shop', 'Get a link to the ForgeMarket shop',
    { nl: 'Link naar de ForgeMarket-winkel', de: 'Link zum ForgeMarket-Shop', fr: 'Lien vers la boutique ForgeMarket' }],
  ['invite', 'Get the server invite link',
    { nl: 'Krijg de uitnodigingslink van de server', de: 'Einladungslink des Servers', fr: 'Lien d’invitation du serveur' }],
  ['stats', 'Show live server stats',
    { nl: 'Toon live serverstatistieken', de: 'Live-Serverstatistiken', fr: 'Statistiques du serveur en direct' }],
  ['close', 'Staff: close the current ticket',
    { nl: 'Staff: sluit dit ticket', de: 'Team: dieses Ticket schließen', fr: 'Équipe : fermer ce ticket' }, STAFF],
  ['coupon', 'Owner: post a discount code',
    { nl: 'Eigenaar: plaats een kortingscode', de: 'Inhaber: Rabattcode posten', fr: 'Propriétaire : publier un code promo' }, OWNER,
    (c) => c.addStringOption((o) => o.setName('code').setDescription('e.g. FORGE10').setRequired(true))
      .addIntegerOption((o) => o.setName('percent').setDescription('% off (1–90)').setRequired(true).setMinValue(1).setMaxValue(90))
      .addStringOption((o) => o.setName('expires').setDescription('Optional real end date, e.g. 2026-11-01 (shown on the post)'))
      .addStringOption((o) => o.setName('note').setDescription('Optional note'))],
  ['paylink', 'Owner: attach a payment link with the exact amount to an order',
    { nl: 'Eigenaar: koppel een betaallink met het exacte bedrag aan een bestelling', de: 'Inhaber: Zahlungslink mit genauem Betrag an eine Bestellung hängen', fr: 'Propriétaire : joindre un lien de paiement au montant exact' }, OWNER,
    (c) => c.addStringOption((o) => o.setName('order').setDescription('Order number, e.g. FM-2026-8KQ2R7XZ').setRequired(true))
      .addStringOption((o) => o.setName('link').setDescription('The payment request link from your bank app').setRequired(true))],
  ['digest', 'Owner: live store digest (revenue, orders, stock)',
    { nl: 'Eigenaar: live winkeloverzicht (omzet, bestellingen, voorraad)', de: 'Inhaber: Live-Shopübersicht', fr: 'Propriétaire : résumé de la boutique en direct' }, OWNER],
  ['stock', 'Owner: which products are low on codes',
    { nl: 'Eigenaar: welke producten bijna geen codes meer hebben', de: 'Inhaber: Produkte mit wenig Codes', fr: 'Propriétaire : produits à court de codes' }, OWNER],
  ['launch', 'Owner: live ready-to-sell checklist',
    { nl: 'Eigenaar: live checklist klaar-om-te-verkopen', de: 'Inhaber: Live-Checkliste verkaufsbereit', fr: 'Propriétaire : checklist prêt à vendre' }, OWNER],
  ['flashsale', 'Staff: post a limited-time deal with a live countdown',
    { nl: 'Staff: plaats een tijdelijke deal met aftelling', de: 'Team: zeitlich begrenzten Deal mit Countdown posten', fr: 'Équipe : publier une offre limitée avec compte à rebours' }, STAFF,
    (c) => c.addStringOption((o) => o.setName('deal').setDescription('e.g. 20% OFF all Robux').setRequired(true))
      .addIntegerOption((o) => o.setName('minutes').setDescription('How long it runs (default 60, max 1440)'))
      .addStringOption((o) => o.setName('code').setDescription('Optional checkout code, e.g. FLASH20'))],
  ['announce', 'Owner: post an announcement',
    { nl: 'Eigenaar: plaats een aankondiging', de: 'Inhaber: Ankündigung posten', fr: 'Propriétaire : publier une annonce' }, OWNER,
    (c) => c.addStringOption((o) => o.setName('message').setDescription('What to announce').setRequired(true))],
  ['clearpins', 'Staff: delete all "pinned a message" notices across the server',
    { nl: 'Staff: verwijder alle "bericht vastgezet"-meldingen', de: 'Team: alle „Nachricht angeheftet“-Hinweise löschen', fr: 'Équipe : supprimer les notifications « message épinglé »' }, STAFF,
    (c) => c.addBooleanOption((o) => o.setName('here').setDescription('Only this channel (default: every channel)'))],
  ['serverinfo', 'Show server statistics',
    { nl: 'Toon serverstatistieken', de: 'Serverstatistiken anzeigen', fr: 'Afficher les statistiques du serveur' }],
];

/** Command names gated as owner-level / staff-level, for tests and docs. */
export const OWNER_COMMANDS = DEFS.filter((d) => d[3] === OWNER).map((d) => d[0]);
export const STAFF_COMMANDS = DEFS.filter((d) => d[3] === STAFF).map((d) => d[0]);

export function buildCommands() {
  return DEFS.map(([name, en, loc, perm, build]) => {
    let c = new SlashCommandBuilder().setName(name).setDescription(en)
      .setDescriptionLocalizations(loc).setDMPermission(false);
    if (perm) c = c.setDefaultMemberPermissions(perm);
    if (build) c = build(c);
    return c.toJSON();
  });
}

/**
 * PUT the full list. Idempotent: Discord replaces the set with exactly this,
 * so running it on every boot cannot duplicate anything.
 *
 * With a guild id the commands appear instantly in that guild; without one
 * they register globally and can take up to an hour to show.
 */
export async function registerCommands({ token, appId, guildId, rest } = {}) {
  const r = rest || new REST({ version: '10' }).setToken(token);
  const body = buildCommands();
  const route = guildId
    ? Routes.applicationGuildCommands(appId, guildId)
    : Routes.applicationCommands(appId);
  await r.put(route, { body });
  return { count: body.length, scope: guildId ? `guild ${guildId}` : 'global' };
}
