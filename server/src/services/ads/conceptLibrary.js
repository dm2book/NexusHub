/**
 * The ad concept library: 100 TikTok concepts across seven formats.
 *
 * What the old engine produced was a line of text per hook. A TikTok ad is not
 * a line: it is a first frame that stops a thumb, a beat sheet a phone can film
 * in one take, words on screen timed to the cuts, a sound, and a caption. Each
 * concept here is that — a shooting script — written in the register the feed
 * actually speaks (lo-fi, first person, self-aware), not in a brand voice.
 *
 * The patterns borrowed, by format:
 *   ugc         a real person filming their own real order (Revolut's creator
 *               demos, G2A/Eneba creator deals) — never an invented review
 *   story       a 3-act micro story told in captions over one continuous shot
 *   pov         the "POV:" first-person scene, the feed's oldest native format
 *   comparison  side by side, numbers on screen (Revolut's in-app screen
 *               recordings) — only numbers the shop can prove
 *   meme        text-on-screen formats a gamer already reads fluently
 *   reddit      a forum-thread layout from the SHOP's own account, never a
 *               pretend stranger's post and never Reddit's logo
 *   native      a brand persona replying to comments, green-screening its own
 *               FAQ, self-deprecating (Duolingo's mascot, Ryanair's replies)
 *
 * The persona: "Bolt", the shop's lightning-bolt logo as an unhinged character
 * (a paper cut-out, a sticker on a cup, a face filter — whatever the owner can
 * film), and "de baas", the one person in the Netherlands who runs the shop.
 * Both are true: there is one person, and the bolt is the logo.
 *
 * Every visible or spoken string is rendered from facts and goes through the
 * same claim gate as every other advert (adScriptService.gate): a price, a
 * delivery time, a sales count or a competitor comparison appears only when
 * the facts behind it exist. `needs` keeps a concept away from a product it
 * cannot be true for. Nothing here invents a customer, a review or a number.
 */

/* ── small helpers over the facts (see adScriptService.factsFor) ─────────── */
const GAME = {
  robux: 'Roblox', 'v-bucks': 'Fortnite', eafc: 'FC', valorant: 'Valorant', cod: 'Warzone', apex: 'Apex',
  brawl: 'Brawl Stars', clash: 'Clash of Clans', clashroyale: 'Clash Royale', genshin: 'Genshin', league: 'League',
  pokemongo: 'Pokémon GO', pubg: 'PUBG', freefire: 'Free Fire', mlbb: 'Mobile Legends', minecraft: 'Minecraft',
  gta: 'GTA', 'discord-nitro': 'Discord', gamepass: 'Game Pass', spotify: 'Spotify',
};
const BRAND = [[/steam/i, 'Steam'], [/playstation|psn/i, 'PlayStation'], [/xbox/i, 'Xbox'], [/nintendo/i, 'Nintendo'],
  [/netflix/i, 'Netflix'], [/google play/i, 'Google Play'], [/app store|itunes/i, 'App Store'], [/amazon/i, 'Amazon']];
export const game = (f) => GAME[f.product.category]
  || (BRAND.find(([re]) => re.test(f.product.name)) || [])[1] || f.product.name;
export const thing = (f) => f.amountText || f.product.name;
export const unit = (f) => f.pack?.unit || game(f);
const isGift = (f) => f.product.category === 'giftcard';

/* What a concept may need — each one a fact that must exist. */
export const NEEDS = {
  any: { test: () => true, label: '—' },
  mail: { test: (f) => f.codeByMail, label: 'delivered as a code by mail' },
  account: { test: (f) => !!f.accountField, label: 'delivered onto an account by username' },
  perK: { test: (f) => !!f.perThousand, label: 'a countable pack (price per 1.000)' },
  sizes: { test: (f) => !!f.sibling && !!f.perThousand, label: 'another pack size of the same thing' },
  market: { test: (f) => !!f.market?.cheaper, label: 'a competitor price observed above ours (last 7 days)' },
  sold: { test: (f) => f.sold.total >= 3, label: '3+ real completed sales' },
  week: { test: (f) => f.sold.last7 >= 2, label: '2+ real sales this week' },
  last: { test: (f) => !!f.sold.lastAgo && !!f.delivery.latest, label: 'a measured recent delivery' },
  measured: { test: (f) => f.delivery.n >= 3, label: '3+ measured deliveries' },
  redeem: { test: (f) => !!f.redeemWhere, label: 'known redeem steps' },
  region: { test: (f) => !!f.region, label: 'a region in the product name' },
  stock: { test: (f) => !!f.stockLeft, label: 'real low stock' },
  gift: { test: (f) => f.codeByMail, label: 'giftable as a code' },
  giftcard: { test: (f) => isGift(f), label: 'a gift card' },
  game: { test: (f) => !!GAME[f.product.category] && !isGift(f), label: 'an in-game currency' },
};

export const FORMATS = ['ugc', 'story', 'pov', 'comparison', 'meme', 'reddit', 'native'];
export const FORMAT_LABEL = {
  ugc: 'UGC', story: 'Story', pov: 'POV', comparison: 'Comparison', meme: 'Meme', reddit: 'Reddit-style', native: 'TikTok native',
};
/* Made by a creator or as a creator would: the caption must say it is an ad
   (Reclamecode Social Media). Brand-account formats are labelled by TikTok. */
export const DISCLOSE = new Set(['ugc', 'reddit']);

const URL = 'forgemarket.nl';
const c = (id, format, title, o) => ({ id, format, title, needs: ['any'], persona: 'maker', sound: 'eigen stem', ...o });

export const CONCEPTS = [
  /* ═══ UGC — a real person, a real order, filmed on a phone ═══════════════ */
  c('ugc-film-everything', 'ugc', 'Ik film de hele bestelling', {
    angle: 'Transparantie: niets weggeknipt, van betalen tot code.', sound: 'eigen stem, geen muziek',
    hook: (f) => `ik koop ${thing(f)} en ik knip NIKS weg`,
    beats: (f) => [['0–2s', 'selfie, telefoon omhoog', `ik koop ${thing(f)} en ik knip NIKS weg`],
      ['2–8s', 'schermopname: product → afrekenen', `${f.priceText}. geen account nodig`],
      ['8–14s', 'schermopname: betaalapp, bestelnummer als omschrijving', 'bestelnummer erbij. dat is de hele truc'],
      ['14–20s', 'selfie, mail open', f.codeByMail ? 'en daar is de code' : `staat op mijn ${f.accountField}`]],
    vo: (f) => `Ik koop ${thing(f)} en ik laat alles zien. Geen account, gewoon betalen met je bestelnummer erbij.`,
    caption: (f) => `hele bestelling ${thing(f)}, ongeknipt`, cta: () => `${URL} — link in bio` }),
  c('ugc-first-time-nerves', 'ugc', 'Eerste keer bij een nieuwe shop', {
    angle: 'Erkent de twijfel van een onbekende shop en laat de vangnetten zien.',
    hook: () => 'eerste keer bij een shop die ik niet ken. dit check ik eerst',
    beats: () => [['0–2s', 'selfie, kritisch gezicht', 'eerste keer hier. dit check ik eerst'],
      ['2–7s', 'scroll naar footer: naam + Nederland', '1. wie zit erachter → staat er gewoon'],
      ['7–12s', 'scroll naar /refunds', '2. niet geleverd = geld terug, op papier'],
      ['12–17s', 'checkout: geen kaartgegevens', '3. je betaalt pas NA bestellen'],
      ['17–20s', 'selfie, knikt', 'oké. ik doe het']],
    vo: () => 'Nieuwe shop, dus ik check drie dingen. Wie erachter zit, wat er gebeurt als het misgaat, en hoe je betaalt.',
    caption: () => 'mijn 3-checks voor een shop die ik niet ken', cta: () => `${URL}` }),
  c('ugc-username-only', 'ugc', 'Ze vroegen alleen mijn username', {
    needs: ['account'], angle: 'De angst: account kwijt. Laat zien wat er écht gevraagd wordt.',
    hook: (f) => `ze vroegen mijn ${f.accountField}. en verder? niks.`,
    beats: (f) => [['0–2s', 'selfie, wijst naar scherm', `ze vroegen mijn ${f.accountField}`],
      ['2–8s', 'schermopname checkout, cursor op het veld', 'geen wachtwoord. geen inlog. niks'],
      ['8–14s', 'in-game, saldo zichtbaar', `${thing(f)} erop`],
      ['14–18s', 'selfie', 'wachtwoord geven aan wie dan ook? nooit doen']],
    vo: (f) => `Ze vragen alleen je ${f.accountField}. Nooit je wachtwoord. Als iemand daarom vraagt: wegwezen.`,
    caption: (f) => `${game(f)} top-up zonder je wachtwoord weg te geven`, cta: () => `${URL}` }),
  c('ugc-gift-prank', 'ugc', 'Cadeau zonder iets te versturen', {
    needs: ['gift'], angle: 'Last-minute cadeau: een code in een kaartje of appje.',
    hook: (f) => `vergeten dat mijn broertje jarig was. ${f.priceText} later:`,
    beats: (f) => [['0–2s', 'selfie paniek, agenda-notificatie', 'vergeten dat hij jarig is 💀'],
      ['2–7s', 'schermopname bestelling', `${f.product.name}, ${f.priceText}`],
      ['7–12s', 'code overschrijven op een kaartje / in appje', 'code in een kaartje. klaar'],
      ['12–18s', 'reactie broertje (alleen met toestemming)', '…ik ben weer zijn favoriet']],
    vo: () => 'Verjaardag vergeten. Code gekocht, in een kaartje geschreven, crisis afgewend.',
    caption: (f) => `last minute ${game(f)} cadeau, geen verzending`, cta: () => `${URL}` }),
  c('ugc-price-per-1000', 'ugc', 'Ik reken het voor je uit', {
    needs: ['perK'], angle: 'Rekenmachine-content: de prijs per 1.000 als wapen.',
    hook: (f) => `wat kost 1.000 ${f.pack.unit} nou ECHT`,
    beats: (f) => [['0–2s', 'rekenmachine-app in beeld', `wat kost 1.000 ${f.pack.unit}?`],
      ['2–8s', 'typen: prijs ÷ aantal × 1000', `${f.priceText} ÷ ${thing(f)}`],
      ['8–12s', 'uitkomst groot', `${f.perThousand} per 1.000`],
      ['12–16s', 'selfie', 'reken het voortaan zelf even uit']],
    vo: (f) => `${thing(f)} voor ${f.priceText}. Dat is ${f.perThousand} per duizend. Reken het altijd even uit.`,
    caption: (f) => `${f.pack.unit} rekenles in 15 sec`, cta: () => `${URL}` }),
  c('ugc-pack-pick', 'ugc', 'Welk pakket neem ik?', {
    needs: ['sizes'], angle: 'Twijfel hardop: klein of groot pakket, met de echte getallen.',
    hook: (f) => `${f.amountText} of ${f.sibling.amountText}? ik twijfel live`,
    beats: (f) => [['0–3s', 'twee tabs open, kijkt heen en weer', `${f.amountText} of ${f.sibling.amountText}?`],
      ['3–9s', 'zoom op prijzen', `${f.priceText} vs ${f.sibling.price}`],
      ['9–14s', 'rekenmachine', `per 1.000: ${f.perThousand} vs ${f.sibling.perThousand}`],
      ['14–18s', 'selfie, beslist', `scheelt ${f.sibling.diff} per 1.000. beslist.`]],
    vo: (f) => `Per duizend is het ${f.perThousand} tegen ${f.sibling.perThousand}. Dat scheelt ${f.sibling.diff}.`,
    caption: () => 'klein of groot pakket? doe de som', cta: () => `${URL}` }),
  c('ugc-redeem-tutorial', 'ugc', 'Zo wissel je het in (30 sec)', {
    needs: ['redeem'], angle: 'Echte hulp: het inwisselen zelf, stap voor stap.',
    hook: (f) => `${f.product.name} gekocht en geen idee waar je hem invoert?`,
    beats: (f) => [['0–2s', 'selfie', 'code gekocht, en nu?'],
      ['2–12s', `schermopname ${f.redeemWhere}`, `ga naar ${f.redeemWhere}`],
      ['12–18s', 'code plakken (vervaagd)', `${f.redeemSteps} stappen. that’s it`],
      ['18–22s', 'saldo zichtbaar', 'save dit voor later']],
    vo: (f) => `Je code invoeren doe je op ${f.redeemWhere}. ${f.redeemSteps} stappen, klaar.`,
    caption: (f) => `zo wissel je ${game(f)} in, save dit`, cta: () => `${URL}` }),
  c('ugc-no-account', 'ugc', 'Afrekenen zonder account', {
    angle: 'Frictie weg: geen account, geen wachtwoord, geen nieuwsbrief.',
    hook: () => 'shops die je dwingen een account te maken 🙄 deze niet',
    beats: (f) => [['0–2s', 'selfie, rollende ogen', 'weer een account maken? nee'],
      ['2–9s', 'schermopname: alleen e-mail invullen', 'alleen je mail. that’s it'],
      ['9–14s', 'bestelling geplaatst', `${f.product.name} besteld`],
      ['14–17s', 'selfie', 'eindelijk']],
    vo: () => 'Geen account nodig. Je mail, je betaling, klaar.', caption: () => 'geen account, geen gezeur', cta: () => `${URL}` }),
  c('ugc-track-it', 'ugc', 'Ik volg mijn bestelling live', {
    angle: 'De statuspagina als geruststelling.',
    hook: () => 'die paar uur wachten, maar ik zie precies waar hij is',
    beats: () => [['0–3s', 'selfie, telefoon', 'betaald. en nu?'],
      ['3–10s', 'schermopname /track met status', 'statuspagina werkt zichzelf bij'],
      ['10–15s', 'notificatie / mail', 'en dan is het er'],
      ['15–18s', 'selfie', 'geen "waar blijft mijn bestelling"-mail nodig']],
    vo: () => 'Je volgt je bestelling op de statuspagina. Die werkt zichzelf bij.', caption: () => 'bestelling volgen zonder te mailen', cta: () => `${URL}/track` }),
  c('ugc-last-delivery', 'ugc', 'De vorige levering, met tijd erbij', {
    needs: ['last'], angle: 'Een echte, gemeten levering als bewijs.',
    hook: (f) => `de laatste ${game(f)}-bestelling hier: ${f.delivery.latest} van betaling tot levering`,
    beats: (f) => [['0–3s', 'selfie, wijst omhoog naar tekst', `laatste bestelling: ${f.sold.lastAgo}`],
      ['3–9s', 'tekst groot', `${f.delivery.latest} van betaald tot geleverd`],
      ['9–14s', 'selfie', 'gemeten, niet beloofd']],
    vo: (f) => `De laatste bestelling: ${f.delivery.latest} van betaling tot levering. Gemeten.`, caption: () => 'gemeten, niet beloofd', cta: () => `${URL}` }),
  c('ugc-parent-explains', 'ugc', 'Ouder legt het uit', {
    needs: ['game'], angle: 'Ouders kopen in-game valuta voor hun kind: maak het begrijpelijk.',
    hook: (f) => `mijn kind wil ${unit(f)}. dus ik zocht uit hoe dat veilig moet`,
    beats: (f) => [['0–3s', 'ouder aan keukentafel', `mijn kind wil ${unit(f)}`],
      ['3–9s', 'telefoon: checkout', 'geen wachtwoord van mijn kind delen'],
      ['9–15s', 'telefoon: betalen na bestellen', 'pas betalen als de bestelling staat'],
      ['15–20s', 'ouder knikt', 'en als het misgaat: geld terug']],
    vo: (f) => `Mijn kind wilde ${unit(f)}. Ik deel geen wachtwoord, ik betaal pas na het bestellen, en als het misgaat krijg ik mijn geld terug.`,
    caption: (f) => `${game(f)} kopen als ouder zonder stress`, cta: () => `${URL}` }),
  c('ugc-duet-question', 'ugc', 'Duet: “is dit legit?”', {
    angle: 'Duet/stitch op de vraag die iedereen stelt, met bewijs in beeld.', sound: 'origineel geluid van de vraag',
    hook: () => '“is dit legit?” laat me je zien wat ik zou checken',
    beats: () => [['0–3s', 'stitch: de vraag', '“is dit legit?”'],
      ['3–10s', 'schermopname footer + refundpagina', 'naam, Nederland, geld-terug op papier'],
      ['10–15s', 'checkout', 'je betaalt pas na bestellen, geen kaartgegevens'],
      ['15–18s', 'selfie', 'check het zelf, niet op mijn woord']],
    vo: () => 'Check zelf: wie erachter zit, de terugbetaalregels, en of je eerst moet betalen.', caption: () => 'check het zelf', cta: () => `${URL}/trust` }),
  c('ugc-desk-setup', 'ugc', 'Setup-tour met een twist', {
    needs: ['game'], angle: 'Setup-tour-format, eindigt bij het saldo.',
    hook: () => 'setup tour maar het duurste item is onzichtbaar',
    beats: (f) => [['0–4s', 'pan over bureau/console', 'setup tour'],
      ['4–9s', 'close-ups gear', 'stoel. headset. lampje'],
      ['9–14s', 'scherm: in-game saldo', `en het onzichtbare item: ${thing(f)}`],
      ['14–17s', 'selfie', `${f.priceText} btw`]],
    vo: (f) => `Het onzichtbare item van mijn setup: ${thing(f)}. ${f.priceText}.`, caption: () => 'het item dat je niet ziet', cta: () => `${URL}` }),
  c('ugc-receipt-read', 'ugc', 'Ik lees mijn bevestigingsmail voor', {
    angle: 'ASMR-achtig voorlezen van de bevestiging: rust, duidelijkheid.', sound: 'fluisterstem',
    hook: () => '*fluistert* de bevestigingsmail',
    beats: (f) => [['0–3s', 'close-up mail', 'de bevestigingsmail'],
      ['3–10s', 'vinger volgt regels', `${f.product.name} · ${f.priceText}`],
      ['10–15s', 'link naar statuspagina', 'met een link om te volgen'],
      ['15–18s', 'selfie', 'zo hoort een mail eruit te zien']],
    vo: () => 'Bestelnummer. Bedrag. Een link om te volgen. Meer hoeft niet.', caption: () => 'rustgevend: een duidelijke bevestigingsmail', cta: () => `${URL}` }),
  c('ugc-before-weekend', 'ugc', 'Vrijdag 17:00 check', {
    needs: ['game'], angle: 'Ritueel/moment: het weekend begint, saldo erop.',
    hook: (f) => `vrijdag 17:00. eerst ${unit(f)}, dan weekend`,
    beats: (f) => [['0–3s', 'laptop dicht, jas aan', 'vrijdag 17:00'],
      ['3–9s', 'telefoon: bestelling', `${thing(f)} · ${f.priceText}`],
      ['9–14s', 'bank: avondlicht, controller', 'weekend geladen'],
      ['14–17s', 'selfie', 'priorities']],
    vo: (f) => `Vrijdag vijf uur. Eerst ${thing(f)}, dan weekend.`, caption: () => 'weekend ritueel', cta: () => `${URL}` }),

  /* ═══ STORY — one shot, three acts in captions ════════════════════════════ */
  c('story-midnight', 'story', 'Om 00:13 besteld', {
    persona: 'de baas', angle: 'Eerlijk over handwerk: ’s nachts besteld = ’s ochtends geleverd.',
    hook: () => '00:13. iemand bestelt. ik slaap.',
    beats: (f) => [['0–3s', 'donkere kamer, telefoon licht op', '00:13 — nieuwe bestelling'],
      ['3–8s', 'ochtend, koffie, laptop open', '07:40 — eerste wat ik doe'],
      ['8–14s', 'scherm: bestelling naar geleverd', `${f.product.name} → geleverd`],
      ['14–18s', 'selfie de baas', 'één persoon. eerlijke tijden.']],
    vo: () => 'Bestel je om middernacht, dan lever ik ’s ochtends. Ik ben één persoon, geen robot.',
    caption: () => 'eerlijke levertijden van een eenmanszaak', cta: () => `${URL}` }),
  c('story-one-person', 'story', 'Er zit één persoon achter', {
    persona: 'de baas', angle: 'Founder-led: wie er achter de winkel zit.',
    hook: () => 'je denkt dat hier een heel team zit. het is mijn bureau.',
    beats: () => [['0–3s', 'wijde shot klein bureau', 'het “hoofdkantoor”'],
      ['3–9s', 'handen typen, bestellingen', 'elke bestelling: ik'],
      ['9–14s', 'Discord-ticket beantwoorden', 'elk ticket: ook ik'],
      ['14–18s', 'selfie', 'vandaar die naam onderaan de site']],
    vo: () => 'Geen team, geen callcenter. Ik. Mijn naam staat onderaan de site.',
    caption: () => 'de hele winkel = één bureau', cta: () => `${URL}/about` }),
  c('story-stopwatch', 'story', 'Stopwatch vanaf betalen', {
    needs: ['last'], angle: 'Spanning: de echte, gemeten levering als ontknoping.',
    hook: () => 'ik zette een stopwatch aan toen ik betaalde',
    beats: (f) => [['0–3s', 'stopwatch start', 'betaald. stopwatch aan.'],
      ['3–10s', 'tijd loopt, jump cuts', '…'],
      ['10–15s', 'stopwatch stop', `${f.delivery.latest}`],
      ['15–18s', 'tekst', 'zo lang duurde de laatste levering echt']],
    vo: (f) => `De laatste levering: ${f.delivery.latest}. Ik heb het gemeten.`, caption: () => 'gemeten met een stopwatch', cta: () => `${URL}` }),
  c('story-mistake-other-site', 'story', 'Wat er misging, vorig jaar', {
    angle: 'Herkenbaar verhaal over een wachtwoord-scam, eindigt bij hoe het hoort.',
    hook: (f) => `vorig jaar gaf ik mijn wachtwoord voor ${unit(f)}. spoiler:`,
    beats: (f) => [['0–3s', 'tekst op zwart', `vorig jaar: wachtwoord gegeven voor ${unit(f)}`],
      ['3–8s', 'scherm: “inlog vanaf onbekend apparaat”', 'spoiler: account weg'],
      ['8–14s', 'scherm: checkout hier', f.accountField ? `nu: alleen mijn ${f.accountField}` : 'nu: een code per mail'],
      ['14–18s', 'tekst', 'les geleerd. jij hoeft hem niet te leren']],
    vo: () => 'Geef nooit je wachtwoord voor in-game geld. Een eerlijke shop vraagt daar niet om.',
    caption: () => 'storytime: hoe ik mijn account kwijtraakte (niet hier)', cta: () => `${URL}` }),
  c('story-gift-chain', 'story', 'Code → kaartje → reactie', {
    needs: ['gift'], angle: 'Mini-vlog van een cadeau, van bestelling tot reactie.',
    hook: () => 'cadeau voor iemand die “niks wil”',
    beats: (f) => [['0–3s', 'tekst', 'cadeau voor iemand die “niks wil”'],
      ['3–8s', 'bestelling', `${f.product.name}`],
      ['8–13s', 'kaartje schrijven', 'code erin'],
      ['13–18s', 'reactie (met toestemming)', 'blijkt toch iets te willen']],
    vo: () => 'Iemand die niks wil, wil stiekem gewoon tegoed.', caption: () => 'cadeau-idee voor mensen die niks willen', cta: () => `${URL}` }),
  c('story-week-in-numbers', 'story', 'Deze week in echte cijfers', {
    needs: ['week'], persona: 'de baas', angle: 'Transparant weekoverzicht met echte verkopen.',
    hook: (f) => `deze week: ${f.sold.last7}× ${f.product.name}. zonder poespas`,
    beats: (f) => [['0–3s', 'whiteboard / notitie-app', 'deze week, echte cijfers'],
      ['3–9s', 'getal groot', `${f.sold.last7}× ${f.product.name}`],
      ['9–15s', 'selfie de baas', 'niet veel, wel echt'],
      ['15–18s', 'tekst', 'volgende week meer?']],
    vo: (f) => `Deze week ${f.sold.last7} keer ${f.product.name}. Echt geteld.`, caption: () => 'echte cijfers, kleine shop', cta: () => `${URL}` }),
  c('story-refund-real', 'story', 'Toen ik een keer niet kon leveren', {
    persona: 'de baas', angle: 'Wat er gebeurt als het misgaat: het beleid als verhaal.',
    hook: () => 'wat ik doe als ik iets NIET kan leveren',
    beats: () => [['0–3s', 'selfie de baas, serieus', 'als ik niet kan leveren:'],
      ['3–9s', 'scherm /refunds', 'geld terug. volledig.'],
      ['9–14s', 'tekst', 'zolang het niet geleverd is: annuleren mag'],
      ['14–18s', 'selfie', 'staat er gewoon, op papier']],
    vo: () => 'Kan ik niet leveren, dan krijg je je geld terug. Volledig. Het staat op de refundpagina.',
    caption: () => 'de saaie regel die het verschil maakt', cta: () => `${URL}/refunds` }),
  c('story-first-sale', 'story', 'De eerste bestelling ooit', {
    persona: 'de baas', angle: 'Underdog-verhaal: een nieuwe winkel, eerlijk verteld.',
    hook: () => 'ik ben een nieuwe winkel en dat ga ik niet verbergen',
    beats: () => [['0–3s', 'selfie', 'nieuwe winkel. geen nep-reviews.'],
      ['3–9s', 'scherm: lege reviewsectie bestaat niet', 'reviews pas als echte kopers ze schrijven'],
      ['9–15s', 'Discord', 'twijfel? vraag het in de Discord'],
      ['15–18s', 'selfie', 'zo bouw je het eerlijk op']],
    vo: () => 'Ik ben nieuw. Ik ga geen reviews verzinnen. Vraag gerust alles in de Discord.',
    caption: () => 'nieuwe shop, eerlijk begin', cta: () => `${URL}/discord` }),
  c('story-pack-regret', 'story', 'Spijt van het kleine pakket', {
    needs: ['sizes'], angle: 'Verhaal over te klein kopen; ontknoping met de som.',
    hook: (f) => `kocht ${f.amountText}. twee dagen later weer. en toen deed ik de som`,
    beats: (f) => [['0–3s', 'tekst', `dag 1: ${f.amountText}`], ['3–6s', 'tekst', 'dag 3: weer'],
      ['6–12s', 'rekenmachine', `${f.perThousand} vs ${f.sibling.perThousand} per 1.000`],
      ['12–16s', 'tekst', `scheelt ${f.sibling.diff} per 1.000`]],
    vo: (f) => `Twee keer klein kopen, of één keer groter. Per duizend scheelt het ${f.sibling.diff}.`, caption: () => 'doe de som vóór je koopt', cta: () => `${URL}` }),
  c('story-region-saga', 'story', 'De regio-saga', {
    needs: ['region'], angle: 'Verhaal over de verkeerde regio kopen, ontknoping: check het label.',
    hook: () => 'ik kocht de verkeerde regio. één keer.',
    beats: (f) => [['0–3s', 'tekst', 'verkeerde regio gekocht'], ['3–8s', 'foutmelding (nagespeeld)', '“niet beschikbaar in jouw regio”'],
      ['8–14s', 'productpagina met regio-label', `deze is ${f.region}. staat erop.`], ['14–17s', 'tekst', 'check het label, altijd']],
    vo: (f) => `Check altijd de regio. Deze is ${f.region}.`, caption: () => 'les: check de regio', cta: () => `${URL}` }),
  c('story-discord-saved', 'story', 'Vraag gesteld, antwoord gekregen', {
    persona: 'de baas', angle: 'Support als verhaal: een echte persoon antwoordt.',
    hook: () => '“waar voer ik deze code in??” — 23:41',
    beats: () => [['0–3s', 'Discord-melding (naam vervaagd)', '“waar voer ik deze code in??”'],
      ['3–9s', 'de baas typt antwoord', 'stap 1, stap 2…'], ['9–14s', 'duimpje terug', '“gelukt!!”'],
      ['14–17s', 'selfie', 'geen bot. ik.']],
    vo: () => 'Een vraag in de Discord krijgt antwoord van mij. Geen bot.', caption: () => 'support = een mens', cta: () => `${URL}/discord` }),
  c('story-budget-month', 'story', 'Gamebudget van een maand', {
    needs: ['game'], angle: 'Budget-content: plannen in plaats van impulsief kopen.',
    hook: (f) => `mijn ${game(f)}-budget voor deze maand, gepland`,
    beats: (f) => [['0–3s', 'notitie-app', `${game(f)} budget`], ['3–9s', 'bedrag', `${f.priceText} → ${thing(f)}`],
      ['9–14s', 'tekst', 'één aankoop, geen 5 kleine'], ['14–17s', 'selfie', 'volwassen gamer moment']],
    vo: (f) => `Eén keer ${thing(f)} voor ${f.priceText}. Gepland, niet impulsief.`, caption: () => 'gamen met een budget', cta: () => `${URL}` }),
  c('story-two-tabs', 'story', 'Twee tabbladen open', {
    needs: ['market'], angle: 'Echte, geobserveerde prijsvergelijking als verhaal.',
    hook: (f) => `twee tabs open voor ${f.product.name}. dit zag ik`,
    beats: (f) => [['0–3s', 'twee tabs', 'twee tabs open'],
      ['3–9s', 'getallen', `hier ${f.priceText} · ${f.market.source} vroeg ${f.market.price} (${f.market.date})`],
      ['9–14s', 'tekst', 'gecheckt, niet geschat'], ['14–17s', 'selfie', 'check zelf ook even']],
    vo: (f) => `Hier ${f.priceText}. ${f.market.source} vroeg ${f.market.price} op ${f.market.date}.`, caption: () => 'twee tabs, één conclusie', cta: () => `${URL}` }),
  c('story-sunday-reset', 'story', 'Zondagavond reset', {
    angle: 'Cozy-format: zondagavond, alles klaar voor de week.', sound: 'lo-fi beat (rechtenvrij)',
    hook: () => 'sunday reset maar dan voor gamers',
    beats: (f) => [['0–3s', 'kaars, deken, controller', 'sunday reset'], ['3–8s', 'headset opladen', 'headset ✔'],
      ['8–13s', 'telefoon: bestelling', `${thing(f)} ✔`], ['13–17s', 'tekst', 'maandag kan komen']],
    vo: () => 'Headset geladen, saldo erop. Maandag kan komen.', caption: () => 'gamer sunday reset', cta: () => `${URL}` }),

  /* ═══ POV — the feed's native first-person scene ══════════════════════════ */
  c('pov-pay-after', 'pov', 'POV: je betaalt pas als het besteld is', {
    angle: 'Het betaalmodel als geruststelling.',
    hook: () => 'POV: je betaalt pas NADAT je bestelling er staat',
    beats: (f) => [['0–3s', 'POV: hand met telefoon', 'POV: eerst bestellen'], ['3–8s', 'bestelnummer in beeld', 'dan betalen met dit nummer'],
      ['8–13s', 'betaalapp', `${f.priceText}, omschrijving: je bestelnummer`], ['13–16s', 'tekst', 'geen kaart opgeslagen. nergens.']],
    vo: () => 'Eerst bestellen, dan betalen met je bestelnummer. Er wordt niks opgeslagen.', caption: () => 'zo werkt betalen hier', cta: () => `${URL}/how-it-works` }),
  c('pov-username-not-password', 'pov', 'POV: ze vragen je username, niet je wachtwoord', {
    needs: ['account'], angle: 'Één zin die de grootste angst wegneemt.',
    hook: (f) => `POV: ze vragen je ${f.accountField}. niet je wachtwoord.`,
    beats: (f) => [['0–3s', 'POV: invulveld', `${f.accountField}: ____`], ['3–7s', 'zoekt wachtwoordveld', 'wachtwoord: … bestaat niet'],
      ['7–12s', 'in-game saldo', `${thing(f)} erop`], ['12–15s', 'tekst', 'zo hoort het']],
    vo: () => 'Geen wachtwoordveld. Omdat het niet nodig is.', caption: (f) => `${game(f)} zonder wachtwoord`, cta: () => `${URL}` }),
  c('pov-code-in-mail', 'pov', 'POV: het is gewoon een code in je mail', {
    needs: ['mail'], angle: 'Eenvoud: geen gedoe, een code.',
    hook: (f) => `POV: je betaalt ${f.priceText} en ${f.product.name} is gewoon een code in je mail`,
    beats: (f) => [['0–3s', 'POV: inbox', 'nieuwe mail'], ['3–8s', 'mail open, code vervaagd', 'je code'],
      ['8–13s', f.redeemWhere ? `invoeren op ${f.redeemWhere}` : 'invoeren', 'plakken, klaar'], ['13–15s', 'tekst', 'dat was het']],
    vo: () => 'Een code in je mail. Plakken. Klaar.', caption: () => 'geen gedoe, een code', cta: () => `${URL}` }),
  c('pov-math-first', 'pov', 'POV: je rekent eerst', {
    needs: ['perK'], angle: 'Slimme koper: de prijs per 1.000 eerst.',
    hook: (f) => `POV: je bent het type dat eerst uitrekent wat 1.000 ${f.pack.unit} kost`,
    beats: (f) => [['0–3s', 'POV: rekenmachine', 'eerst de som'], ['3–8s', 'typen', `${f.priceText} ÷ ${thing(f)} × 1000`],
      ['8–12s', 'uitkomst', `${f.perThousand}`], ['12–15s', 'tekst', 'nu pas kopen']],
    vo: (f) => `${f.perThousand} per duizend. Nu pas kopen.`, caption: () => 'rekenmeester-energie', cta: () => `${URL}` }),
  c('pov-forgot-birthday', 'pov', 'POV: verjaardag vergeten, 20:47', {
    needs: ['gift'], angle: 'Urgentie zonder nepschaarste: de klok van je eigen leven.',
    hook: () => 'POV: het is 20:47 en je bent een verjaardag vergeten',
    beats: (f) => [['0–3s', 'POV: agenda-melding', 'verjaardag. vandaag.'], ['3–8s', 'snel bestellen', `${f.product.name}`],
      ['8–13s', 'code overschrijven', 'in een appje, met een hartje'], ['13–15s', 'tekst', 'gered']],
    vo: () => 'Een code in een appje. Niemand hoeft te weten dat je het vergeten was.', caption: () => 'gered door een code', cta: () => `${URL}` }),
  c('pov-sale-week', 'pov', 'POV: anderen kochten dit al deze week', {
    needs: ['week'], angle: 'Echte sociale bewijskracht, alleen met echte verkopen.',
    hook: (f) => `POV: ${f.sold.last7} mensen kochten deze week ${f.product.name}. jij twijfelt nog.`,
    beats: (f) => [['0–3s', 'POV: twijfelend scrollen', 'nog twijfelen…'], ['3–8s', 'getal', `${f.sold.last7}× deze week`],
      ['8–12s', 'tekst', 'echt geteld'], ['12–15s', 'tekst', 'jij bent de volgende?']],
    vo: (f) => `${f.sold.last7} keer deze week. Echt geteld.`, caption: () => 'echt geteld, niet verzonnen', cta: () => `${URL}` }),
  c('pov-tiny-shop', 'pov', 'POV: je koopt bij één persoon', {
    persona: 'de baas', angle: 'Kleine-ondernemer-sympathie.',
    hook: () => 'POV: je bestelling gaat niet naar een warehouse maar naar één persoon in Nederland',
    beats: () => [['0–3s', 'POV: melding op telefoon van de baas', 'nieuwe bestelling 🔔'], ['3–9s', 'de baas pakt het op', 'meteen opgepakt'],
      ['9–13s', 'statusupdate', 'jij ziet het ook'], ['13–15s', 'tekst', 'support: dezelfde persoon']],
    vo: () => 'Je bestelling komt bij één persoon terecht. Dezelfde die je vragen beantwoordt.', caption: () => 'kleine shop, korte lijnen', cta: () => `${URL}/about` }),
  c('pov-track-without-mail', 'pov', 'POV: je hoeft niet te mailen waar het blijft', {
    angle: 'Statuspagina als feature.',
    hook: () => 'POV: je wilt mailen “waar blijft mijn bestelling” maar de pagina zegt het al',
    beats: () => [['0–3s', 'POV: mail typen', '“waar blijft m…”'], ['3–8s', 'statuspagina open', 'oh. staat hier al.'],
      ['8–12s', 'status verandert', 'geleverd'], ['12–15s', 'mail verwijderen', 'concept verwijderd']],
    vo: () => 'De statuspagina laat zien waar je bestelling is. Zonder mailen.', caption: () => 'concept verwijderd 😌', cta: () => `${URL}/track` }),
  c('pov-region-check', 'pov', 'POV: je checkt de regio eerst', {
    needs: ['region'], angle: 'Slimme-koper POV over regio.',
    hook: (f) => `POV: je checkt de regio vóór je koopt. ${f.region}. ✔`,
    beats: (f) => [['0–3s', 'POV: productpagina', 'eerst de regio'], ['3–7s', 'zoom op label', f.region], ['7–11s', 'eigen account-regio', 'match ✔'], ['11–14s', 'tekst', 'dán pas afrekenen']],
    vo: (f) => `Eerst de regio: ${f.region}. Klopt. Dan pas kopen.`, caption: () => 'regio-check, altijd', cta: () => `${URL}` }),
  c('pov-parent-panic', 'pov', 'POV: je kind vraagt om je wachtwoord', {
    needs: ['account'], angle: 'Ouders: wat je wél en niet geeft.',
    hook: (f) => `POV: je kind zegt “die site wil je wachtwoord voor ${unit(f)}”`,
    beats: (f) => [['0–3s', 'POV: kind met tablet', '“ze willen je wachtwoord”'], ['3–8s', 'ouder schudt hoofd', 'nope'],
      ['8–13s', 'checkout hier', `alleen ${f.accountField}`], ['13–16s', 'tekst', 'zo hoort het']],
    vo: (f) => `Een eerlijke shop vraagt alleen je ${f.accountField}. Nooit een wachtwoord.`, caption: () => 'tip voor ouders', cta: () => `${URL}` }),
  c('pov-stock-few', 'pov', 'POV: er staan er nog maar een paar', {
    needs: ['stock'], angle: 'Echte, lage voorraad — alleen als het écht zo is.',
    hook: (f) => `POV: nog ${f.stockLeft} op voorraad van ${f.product.name}`,
    beats: (f) => [['0–3s', 'POV: productpagina', `nog ${f.stockLeft} op voorraad`], ['3–8s', 'tekst', 'echte voorraad, geen timer'], ['8–12s', 'tekst', 'daarna: op bestelling']],
    vo: (f) => `Nog ${f.stockLeft} op voorraad. Daarna op bestelling.`, caption: () => 'echte voorraad, geen afteltimer', cta: () => `${URL}` }),
  c('pov-checkout-3-taps', 'pov', 'POV: afrekenen in drie stappen', {
    angle: 'Snelheid van het proces (niet van levering): weinig stappen.',
    hook: () => 'POV: afrekenen zonder 6 formulieren',
    beats: () => [['0–3s', 'POV: checkout', 'mailadres'], ['3–6s', 'vinkje', 'vinkje'], ['6–9s', 'knop', 'bestellen'], ['9–13s', 'tekst', 'dat was het formulier']],
    vo: () => 'Mail, vinkje, bestellen. Dat was het formulier.', caption: () => 'kortste checkout van je leven?', cta: () => `${URL}` }),
  c('pov-discord-answer', 'pov', 'POV: je vraag wordt door een mens beantwoord', {
    angle: 'Support-POV.',
    hook: () => 'POV: je stelt een vraag en er antwoordt een MENS',
    beats: () => [['0–3s', 'POV: Discord typen', 'vraag gesteld'], ['3–8s', 'typing indicator', '…'], ['8–12s', 'antwoord', 'echt antwoord, geen script'], ['12–15s', 'tekst', 'wild']],
    vo: () => 'Een vraag stellen en een mens terugkrijgen. Wild.', caption: () => 'geen chatbot-doolhof', cta: () => `${URL}/discord` }),
  c('pov-pack-upgrade', 'pov', 'POV: je ziet het grotere pakket per 1.000', {
    needs: ['sizes'], angle: 'Upsell als ontdekking.',
    hook: (f) => `POV: je ziet dat ${f.sibling.amountText} per 1.000 anders uitvalt`,
    beats: (f) => [['0–3s', 'POV: pakketkeuze', `${f.amountText}`], ['3–8s', 'scroll', `${f.sibling.amountText}`],
      ['8–12s', 'per 1.000', `${f.perThousand} vs ${f.sibling.perThousand}`], ['12–15s', 'tekst', `${f.sibling.diff} verschil per 1.000`]],
    vo: (f) => `Per duizend: ${f.perThousand} tegen ${f.sibling.perThousand}.`, caption: () => 'altijd per 1.000 kijken', cta: () => `${URL}` }),
  c('pov-giftcard-host', 'pov', 'POV: je bent de host van het weekend', {
    needs: ['giftcard'], angle: 'Gift card als groepsmoment.',
    hook: (f) => `POV: jij regelt ${game(f)} voor de hele groep`,
    beats: (f) => [['0–3s', 'POV: groepsapp', '“wie regelt het?”'], ['3–8s', 'bestelling', `${f.product.name}`], ['8–12s', 'code in app', 'geregeld'], ['12–15s', 'tekst', 'held van de groep']],
    vo: () => 'Iemand moet het regelen. Vandaag ben jij dat.', caption: () => 'groepsapp-held', cta: () => `${URL}` }),

  /* ═══ COMPARISON — side by side, numbers the shop can prove ════════════════ */
  c('cmp-two-packs', 'comparison', 'Klein vs groot pakket', {
    needs: ['sizes'], angle: 'Split-screen met prijs per 1.000.', sound: 'trending “this or that”-geluid (rechtenvrij)',
    hook: (f) => `${f.amountText} vs ${f.sibling.amountText}`,
    beats: (f) => [['0–2s', 'split screen', `${f.amountText} | ${f.sibling.amountText}`], ['2–6s', 'prijs onder elk', `${f.priceText} | ${f.sibling.price}`],
      ['6–10s', 'per 1.000', `${f.perThousand} | ${f.sibling.perThousand}`], ['10–13s', 'winnaar oplichten', `verschil: ${f.sibling.diff} per 1.000`]],
    vo: (f) => `Per duizend: ${f.perThousand} tegen ${f.sibling.perThousand}.`, caption: () => 'welke zou jij nemen?', cta: () => `${URL}` }),
  c('cmp-observed-price', 'comparison', 'Hier vs elders, met datum', {
    needs: ['market'], angle: 'Alleen een echt geobserveerde concurrentprijs, met bron en datum.',
    hook: (f) => `${f.product.name}: hier vs ${f.market.source}`,
    beats: (f) => [['0–2s', 'twee kolommen', `hier | ${f.market.source}`], ['2–7s', 'prijzen', `${f.priceText} | ${f.market.price}`],
      ['7–11s', 'kleine tekst', `gezien op ${f.market.date}`], ['11–14s', 'tekst', 'prijzen veranderen, check zelf']],
    vo: (f) => `Hier ${f.priceText}. ${f.market.source} vroeg ${f.market.price} op ${f.market.date}.`, caption: () => 'met datum, want prijzen veranderen', cta: () => `${URL}` }),
  c('cmp-account-vs-code', 'comparison', 'Wachtwoord geven vs zo', {
    angle: 'Gevaarlijke manier vs veilige manier (geen concurrent genoemd).',
    hook: () => 'in-game geld kopen: ❌ vs ✅',
    beats: (f) => [['0–3s', 'split: rood | groen', '❌ | ✅'], ['3–8s', 'links', '❌ je wachtwoord aan een “verkoper”'],
      ['8–13s', 'rechts', f.accountField ? `✅ alleen je ${f.accountField}` : '✅ een code in je mail'], ['13–16s', 'tekst', 'kies rechts. altijd.']],
    vo: (f) => (f.accountField ? `Nooit je wachtwoord. Alleen je ${f.accountField}.` : 'Nooit je wachtwoord. Gewoon een code in je mail.'), caption: () => 'rood of groen?', cta: () => `${URL}` }),
  c('cmp-pay-first-vs-after', 'comparison', 'Vooruit betalen vs na bestellen', {
    angle: 'Het betaalmodel naast het gangbare.',
    hook: () => 'eerst betalen en hopen ❌ vs eerst bestellen ✅',
    beats: () => [['0–3s', 'split', 'eerst betalen | eerst bestellen'], ['3–8s', 'links', 'kaartgegevens, hopen'],
      ['8–13s', 'rechts', 'bestelnummer, dan betalen'], ['13–16s', 'tekst', 'niet geleverd = geld terug']],
    vo: () => 'Hier bestel je eerst. Dan betaal je met je bestelnummer. Niet geleverd, geld terug.', caption: () => 'welke voelt veiliger?', cta: () => `${URL}/how-it-works` }),
  c('cmp-discord-seller', 'comparison', 'Random Discord-seller vs een winkel met naam', {
    angle: 'Anonieme verkoper vs aanspreekbare winkel (niemand bij naam genoemd).',
    hook: () => 'random seller in je DM vs een winkel met een naam',
    beats: () => [['0–3s', 'split', 'DM-seller | winkel'], ['3–8s', 'links', 'geen naam, “trust me bro”'],
      ['8–13s', 'rechts', 'naam + Nederland + geld-terug-regels'], ['13–16s', 'tekst', 'jouw geld, jouw keuze']],
    vo: () => '“Trust me bro” is geen garantie. Een naam en regels op papier wel.', caption: () => 'trust me bro ≠ garantie', cta: () => `${URL}/trust` }),
  c('cmp-guest-vs-account', 'comparison', 'Account verplicht vs gast', {
    angle: 'Frictie vergelijken.',
    hook: () => 'checkout met account vs zonder',
    beats: () => [['0–3s', 'split', 'met | zonder'], ['3–8s', 'links: formulierwaterval', '8 velden + wachtwoord + bevestigen'],
      ['8–12s', 'rechts', 'je mail'], ['12–15s', 'tekst', 'rechts wint']],
    vo: () => 'Acht velden of één. Hier is het één.', caption: () => 'formulier-moeheid is echt', cta: () => `${URL}` }),
  c('cmp-per-1000-ladder', 'comparison', 'De per-1.000-ladder', {
    needs: ['sizes'], angle: 'Alle pakketten op één ladder (de twee die de feiten kennen).',
    hook: (f) => `${f.pack.unit}: hoeveel betaal je per 1.000?`,
    beats: (f) => [['0–3s', 'ladder-graphic', `${f.pack.unit} per 1.000`], ['3–8s', 'trede 1', `${f.amountText}: ${f.perThousand}`],
      ['8–12s', 'trede 2', `${f.sibling.amountText}: ${f.sibling.perThousand}`], ['12–15s', 'tekst', 'kies je trede']],
    vo: (f) => `${f.amountText}: ${f.perThousand} per duizend. ${f.sibling.amountText}: ${f.sibling.perThousand}.`, caption: () => 'per 1.000 is de enige eerlijke vergelijking', cta: () => `${URL}` }),
  c('cmp-gift-vs-cash', 'comparison', 'Geld geven vs een code geven', {
    needs: ['gift'], angle: 'Cadeau-vergelijking.',
    hook: () => '€ overmaken als cadeau vs een code die ze wél gebruiken',
    beats: (f) => [['0–3s', 'split', 'tikkie | code'], ['3–8s', 'links', 'wordt uitgegeven aan… boodschappen'],
      ['8–12s', 'rechts', `${f.product.name}: wordt gespeeld`], ['12–15s', 'tekst', 'cadeau voelt als cadeau']],
    vo: () => 'Geld wordt boodschappen. Een code wordt een cadeau.', caption: () => 'cadeau dat als cadeau voelt', cta: () => `${URL}` }),
  c('cmp-night-vs-day', 'comparison', 'Overdag vs ’s nachts bestellen', {
    persona: 'de baas', angle: 'Eerlijke verwachting: handwerk heeft werktijden.',
    hook: () => 'overdag bestellen vs om 3 uur ’s nachts',
    beats: () => [['0–3s', 'split zon | maan', 'overdag | 03:00'], ['3–8s', 'links', 'meestal binnen een paar uur'],
      ['8–12s', 'rechts', '’s ochtends als eerste'], ['12–15s', 'tekst', 'één persoon, eerlijke tijden']],
    vo: () => 'Overdag meestal binnen een paar uur. ’s Nachts: als eerste in de ochtend.', caption: () => 'eerlijk over levertijden', cta: () => `${URL}` }),
  c('cmp-scam-signs', 'comparison', '5 scam-signalen vs wat je hier ziet', {
    angle: 'Educatief checklijstje.',
    hook: () => '5 scam-signalen bij game-tegoed (en wat je hier ziet)',
    beats: () => [['0–3s', 'checklist', '5 scam-signalen'], ['3–6s', '1', 'wachtwoord gevraagd ❌'], ['6–9s', '2', 'geen naam ❌'],
      ['9–12s', '3', 'geen terugbetaalregels ❌'], ['12–15s', '4', 'alleen crypto/gift cards ❌'], ['15–18s', '5', '“alleen vandaag” ❌'], ['18–21s', 'tekst', 'hier: geen van de vijf']],
    vo: () => 'Vijf signalen. Check ze bij elke shop. Ook hier.', caption: () => 'save dit voor je kleine broertje', cta: () => `${URL}/trust` }),
  c('cmp-sticker-price', 'comparison', 'De prijs op het scherm vs bij afrekenen', {
    angle: 'Geen verrassingen bij het afrekenen.',
    hook: () => 'prijs op het product vs prijs bij afrekenen',
    beats: (f) => [['0–3s', 'split', 'product | checkout'], ['3–8s', 'beide', `${f.priceText} | ${f.priceText}`], ['8–12s', 'tekst', 'geen servicekosten erbij'], ['12–15s', 'tekst', 'zo simpel kan het']],
    vo: (f) => `${f.priceText} op het product. ${f.priceText} bij afrekenen.`, caption: () => 'geen “servicekosten” verrassing', cta: () => `${URL}` }),
  c('cmp-tutorial-vs-guess', 'comparison', 'Gokken vs de stappen hebben', {
    needs: ['redeem'], angle: 'Inwissel-onzekerheid vs uitleg.',
    hook: () => 'code gekocht: gokken waar je hem invoert vs dit',
    beats: (f) => [['0–3s', 'split', 'gokken | stappen'], ['3–8s', 'links', 'googlen, 4 tabs'], ['8–12s', 'rechts', `${f.redeemWhere}, ${f.redeemSteps} stappen, in je mail`], ['12–15s', 'tekst', 'rechts']],
    vo: (f) => `De stappen zitten in je mail. ${f.redeemSteps} stappen op ${f.redeemWhere}.`, caption: () => 'de uitleg zit erbij', cta: () => `${URL}` }),
  c('cmp-faces', 'comparison', 'Gezichtsloos vs een gezicht', {
    persona: 'de baas', angle: 'De baas laat zijn gezicht zien.',
    hook: () => 'de meeste shops: 🏢 · deze: 🙋',
    beats: () => [['0–3s', 'split', '🏢 | 🙋'], ['3–8s', 'links: stock kantoor-graphic (getekend)', '“ons team staat voor u klaar”'],
      ['8–13s', 'rechts: de baas, echt', 'ik dus'], ['13–16s', 'tekst', 'vragen? die komen bij mij']],
    vo: () => 'Geen anoniem team. Ik.', caption: () => 'gezicht bij de winkel', cta: () => `${URL}/about` }),
  c('cmp-platforms', 'comparison', 'Verkeerd platform vs goed platform', {
    needs: ['game'], angle: 'Platform-check als vergelijking.',
    hook: (f) => `${game(f)} op het verkeerde platform kopen vs dit`,
    beats: () => [['0–3s', 'split', '❌ verkeerd | ✅ goed'], ['3–8s', 'links', 'code werkt niet op je console'],
      ['8–12s', 'rechts', 'platform staat groot op het product'], ['12–15s', 'tekst', 'check: PlayStation / Xbox / PC']],
    vo: () => 'Check het platform. Het staat groot op het product.', caption: () => 'platform-check, 2 seconden', cta: () => `${URL}` }),

  /* ═══ MEME — text formats a gamer reads without thinking ═════════════════ */
  c('meme-nobody-me', 'meme', 'nobody: / me:', {
    angle: 'Het oudste tekstformat, eerlijk ingevuld.', sound: 'trending meme-geluid (rechtenvrij)',
    hook: (f) => `nobody:\nme om 23:00: ${thing(f)} rekenen per 1.000`,
    needs: ['perK'],
    beats: (f) => [['0–3s', 'tekst op zwart', 'nobody:'], ['3–7s', 'gezicht in focus, rekenmachine', `me: ${f.perThousand} per 1.000??`], ['7–10s', 'zoom-in', 'oké ik koop']],
    vo: () => '', caption: () => 'rekenen > slapen', cta: () => `${URL}` }),
  c('meme-expectation-reality', 'meme', 'Verwachting vs werkelijkheid', {
    angle: 'Inverted: de werkelijkheid is hier saai-goed.',
    hook: () => 'verwachting: gedoe · werkelijkheid: een mail',
    beats: () => [['0–3s', 'verwachting: chaos-montage (zelf gefilmd)', 'verwachting: 6 formulieren, account, captcha'],
      ['3–7s', 'werkelijkheid: één mail', 'werkelijkheid: een mail'], ['7–10s', 'tekst', 'saai. perfect.']],
    vo: () => '', caption: () => 'saai is goed', cta: () => `${URL}` }),
  c('meme-gamer-math', 'meme', 'Gamer math', {
    needs: ['perK'], angle: '“Gamer math”-trope, maar met echte som.',
    hook: () => 'gamer math vs echte math',
    beats: (f) => [['0–3s', 'tekst', 'gamer math: “het is maar een paar euro”'], ['3–7s', 'rekenmachine', `echte math: ${f.perThousand} per 1.000`], ['7–10s', 'tekst', 'nu weet je het']],
    vo: () => '', caption: () => 'gamer math is geen math', cta: () => `${URL}` }),
  c('meme-starter-pack', 'meme', 'Starter pack', {
    needs: ['game'], angle: '“X starter pack”-collage, zelf gefotografeerd.',
    hook: (f) => `${game(f)} weekend starter pack`,
    beats: (f) => [['0–4s', 'collage: snacks, headset, controller', `${game(f)} weekend starter pack`], ['4–8s', 'laatste vakje', thing(f)], ['8–10s', 'tekst', 'compleet']],
    vo: () => '', caption: () => 'wat ontbreekt er?', cta: () => `${URL}` }),
  c('meme-npc-seller', 'meme', 'NPC-verkoper', {
    angle: 'Skit: de scam-verkoper als NPC met één dialoogregel.', persona: 'de baas',
    hook: () => 'de scam-seller is letterlijk een NPC',
    beats: () => [['0–3s', 'de baas als NPC, stijve beweging', 'NPC: “stuur even je wachtwoord”'], ['3–6s', 'herhaalt', 'NPC: “stuur even je wachtwoord”'],
      ['6–10s', 'cut naar normaal', 'wij: alleen je username of een code'], ['10–12s', 'tekst', 'praat niet met NPCs']],
    vo: () => '', caption: () => 'NPC-dialoog: 1 regel', cta: () => `${URL}` }),
  c('meme-dont-talk-to-me', 'meme', 'Don’t talk to me until…', {
    needs: ['game'], angle: 'Ochtend-humeur-meme.',
    hook: (f) => `don’t talk to me until ${thing(f)} erop staat`,
    beats: (f) => [['0–3s', 'chagrijnig, deken', 'don’t talk to me'], ['3–6s', 'bestelling geplaatst', 'until…'], ['6–10s', 'blij', `${thing(f)} ✔`]],
    vo: () => '', caption: () => 'humeur: hersteld', cta: () => `${URL}` }),
  c('meme-red-flags', 'meme', 'Red flags / green flags', {
    angle: 'Red/green flag-format, puur informatief.',
    hook: () => 'green flags bij een game-shop 🟢',
    beats: () => [['0–3s', 'groene vlaggetjes', 'green flags'], ['3–6s', '🟢', 'naam + land op de site'], ['6–9s', '🟢', 'geld terug op papier'],
      ['9–12s', '🟢', 'je betaalt na bestellen'], ['12–15s', '🟢', 'geen wachtwoord nodig']],
    vo: () => '', caption: () => 'jij mag de red flags in de comments zetten', cta: () => `${URL}/trust` }),
  c('meme-two-buttons', 'meme', 'Twee knoppen-dilemma', {
    needs: ['sizes'], angle: 'Zwetende-knoppen-meme, opgelost met de som.',
    hook: (f) => `${f.amountText} 🔴  ${f.sibling.amountText} 🔵`,
    beats: (f) => [['0–3s', 'twee knoppen, zweet', `${f.amountText} | ${f.sibling.amountText}`], ['3–7s', 'rekenmachine', `${f.perThousand} | ${f.sibling.perThousand} per 1.000`], ['7–10s', 'tekst', 'dilemma opgelost']],
    vo: () => '', caption: () => 'welke knop?', cta: () => `${URL}` }),
  c('meme-pov-loading', 'meme', 'Loading screen tips', {
    needs: ['game'], angle: 'Game-laadscherm met “tips”.',
    hook: () => 'TIP: deel nooit je wachtwoord voor in-game geld',
    beats: (f) => [['0–3s', 'nep-laadbalk (eigen graphic)', 'LOADING…'], ['3–7s', 'tip-tekst', 'TIP: deel nooit je wachtwoord'],
      ['7–10s', 'tip 2', f.accountField ? `TIP: alleen je ${f.accountField} is genoeg` : 'TIP: een code is genoeg'], ['10–12s', 'balk vol', '100%']],
    vo: () => '', caption: () => 'loading screen tips die wél kloppen', cta: () => `${URL}` }),
  c('meme-me-explaining', 'meme', 'Ik die het uitlegt aan mijn moeder', {
    angle: 'Skit: uitleggen wat in-game geld is.', persona: 'de baas',
    hook: (f) => `ik die aan mijn moeder uitlegt wat ${unit(f)} zijn`,
    beats: (f) => [['0–3s', 'twee rollen, zelfde persoon', `“wat zijn ${unit(f)}?”`], ['3–7s', 'uitleg', '“geld… maar in een game”'],
      ['7–10s', 'moeder', '“en dat koop je met écht geld?”'], ['10–13s', 'tekst', 'ja mam. met je bestelnummer erbij.']],
    vo: () => '', caption: () => 'tag iemand die dit gesprek had', cta: () => `${URL}` }),
  c('meme-it-is-what-it-is', 'meme', 'Handwerk-meme', {
    persona: 'de baas', angle: 'Zelfspot over handmatige levering.',
    hook: () => 'mijn “automatisering”:',
    beats: () => [['0–3s', 'tekst', 'mijn “automatisering”:'], ['3–6s', 'de baas met koffie achter laptop', 'ik'], ['6–10s', 'tekst', 'wel snel. wel eerlijk.']],
    vo: () => '', caption: () => 'de server ben ik', cta: () => `${URL}` }),
  c('meme-tier-list', 'meme', 'Tier list: manieren om tegoed te kopen', {
    angle: 'Tier-list-format, eerlijk ingedeeld.',
    hook: () => 'tier list: manieren om game-tegoed te kopen',
    beats: () => [['0–3s', 'tier-list-graphic', 'S A B F'], ['3–6s', 'F', 'F: wachtwoord aan een DM-seller'], ['6–9s', 'B', 'B: geen naam, wel “reviews”'],
      ['9–13s', 'S', 'S: code of username, geld-terug-regels, betaal na bestellen'], ['13–15s', 'tekst', 'jouw tier list?']],
    vo: () => '', caption: () => 'zet jouw S-tier in de comments', cta: () => `${URL}` }),
  c('meme-rizz', 'meme', 'Cadeau-rizz', {
    needs: ['gift'], angle: 'Rizz-humor met een cadeau.',
    hook: () => 'rizz is een code sturen op haar verjaardag',
    beats: (f) => [['0–3s', 'tekst', 'rizz is:'], ['3–7s', 'appje met code (vervaagd)', `${f.product.name} 🎁`], ['7–10s', 'tekst', 'W']],
    vo: () => '', caption: () => 'W rizz', cta: () => `${URL}` }),
  c('meme-patience', 'meme', 'Geduld-level', {
    persona: 'de baas', angle: 'Eerlijk over “een paar uur”.',
    hook: () => 'mijn geduld als ik iets bestel bij een mens i.p.v. een robot:',
    beats: () => [['0–3s', 'tekst', 'geduld-meter'], ['3–7s', 'meter vol', 'want ik zie de status'], ['7–10s', 'tekst', 'en een mens als het misgaat']],
    vo: () => '', caption: () => 'mens > robot als het misgaat', cta: () => `${URL}/track` }),

  /* ═══ REDDIT-STYLE — the shop's own thread, clearly from the shop ═════════ */
  c('rd-ama', 'reddit', 'AMA: ik run een game-shop in mijn eentje', {
    persona: 'de baas', angle: 'AMA-layout vanaf het eigen account, met echte antwoorden.',
    hook: () => 'AMA: ik run in mijn eentje een game-shop. vraag maar.',
    beats: () => [['0–3s', 'thread-layout (eigen design, u/ForgeMarket_NL)', 'AMA: één persoon, één shop'],
      ['3–8s', 'vraag 1 + antwoord', '“waarom handwerk?” → zodat ik elke bestelling zie'],
      ['8–13s', 'vraag 2', '“wat als het misgaat?” → geld terug, op papier'], ['13–16s', 'tekst', 'meer vragen? comments']],
    vo: () => 'Vraag me alles. Echt.', caption: () => 'AMA, comments open', cta: () => `${URL}/discord` }),
  c('rd-eli5', 'reddit', 'ELI5: hoe werkt betalen hier', {
    angle: 'Explain Like I’m 5 over het betaalmodel.',
    hook: () => 'ELI5: waarom betaal je hier pas NA het bestellen?',
    beats: () => [['0–3s', 'thread-layout', 'ELI5: betalen na bestellen'], ['3–9s', 'antwoord', 'je krijgt eerst een nummer'],
      ['9–14s', 'vervolg', 'dat zet je bij je betaling, zo weet ik dat jij het bent'], ['14–17s', 'tekst', 'geen kaart opgeslagen']],
    vo: () => 'Eerst een nummer, dan betalen met dat nummer. Zo simpel.', caption: () => 'ELI5 editie', cta: () => `${URL}/how-it-works` }),
  c('rd-psa-password', 'reddit', 'PSA: niemand heeft je wachtwoord nodig', {
    angle: 'PSA-post, puur publieksdienst.',
    hook: (f) => `PSA: niemand heeft je wachtwoord nodig voor ${unit(f)}`,
    beats: (f) => [['0–3s', 'thread-layout', 'PSA'], ['3–8s', 'body', `voor ${unit(f)} heb je nooit je wachtwoord nodig`],
      ['8–13s', 'body', f.accountField ? `alleen je ${f.accountField}` : 'een code in je mail is genoeg'], ['13–16s', 'tekst', 'deel dit met je squad']],
    vo: () => 'Niemand heeft je wachtwoord nodig. Niemand.', caption: () => 'PSA, deel het', cta: () => `${URL}` }),
  c('rd-til-per-1000', 'reddit', 'TIL: prijs per 1.000', {
    needs: ['perK'], angle: 'Today I Learned-format met de eigen som.',
    hook: (f) => `TIL: ${thing(f)} voor ${f.priceText} is ${f.perThousand} per 1.000`,
    beats: (f) => [['0–3s', 'thread-layout', 'TIL'], ['3–9s', 'body', `${thing(f)} · ${f.priceText} → ${f.perThousand} per 1.000`], ['9–13s', 'tekst', 'vergelijk altijd per 1.000']],
    vo: () => '', caption: () => 'TIL editie', cta: () => `${URL}` }),
  c('rd-aita-gift', 'reddit', 'AITA dat ik een code gaf als cadeau?', {
    needs: ['gift'], angle: 'AITA-format, licht en grappig, verzonnen situatie als sketch gemarkeerd.',
    hook: () => 'AITA dat ik een code gaf als verjaardagscadeau? (sketch)',
    beats: (f) => [['0–3s', 'thread-layout, label “sketch”', 'AITA? (sketch)'], ['3–9s', 'body', `ik gaf ${f.product.name}. tante vond het “onpersoonlijk”`],
      ['9–14s', 'top comment (eigen account)', 'NTA. hij speelt het nog steeds'], ['14–16s', 'tekst', 'verdict?']],
    vo: () => '', caption: () => 'verdict in de comments 👇 (sketch)', cta: () => `${URL}` }),
  c('rd-hot-take', 'reddit', 'Unpopular opinion', {
    persona: 'de baas', angle: 'Mening-post over nep-reviews.',
    hook: () => 'unpopular opinion: een nieuwe shop zonder reviews is eerlijker dan één met 5.000 nep-reviews',
    beats: () => [['0–3s', 'thread-layout', 'unpopular opinion'], ['3–9s', 'body', 'liever 0 echte reviews dan 5.000 gekochte'],
      ['9–14s', 'body', 'reviews hier: alleen van geleverde bestellingen'], ['14–16s', 'tekst', 'agree / disagree?']],
    vo: () => '', caption: () => 'agree of disagree?', cta: () => `${URL}` }),
  c('rd-ask-region', 'reddit', 'Vraag: werkt een EU-code op mijn account?', {
    needs: ['region'], angle: 'Q&A-thread over regio.',
    hook: (f) => `“werkt een ${f.region}-code op mijn account?” — goed antwoord in de comments`,
    beats: (f) => [['0–3s', 'thread-layout', 'vraag over regio'], ['3–9s', 'antwoord (eigen account)', `kijk welke regio je account heeft. deze is ${f.region}`],
      ['9–13s', 'tekst', 'match = werkt'], ['13–15s', 'tekst', 'twijfel? vraag het vóór je koopt']],
    vo: () => '', caption: () => 'regio-vraag beantwoord', cta: () => `${URL}/discord` }),
  c('rd-update-edit', 'reddit', 'EDIT: hij is geleverd', {
    needs: ['last'], angle: 'De “EDIT:” onderaan een post als ontknoping, met echte meettijd.',
    hook: () => 'post: “eerste keer hier besteld, spannend” …EDIT onderaan',
    beats: (f) => [['0–3s', 'thread-layout (sketch-label)', 'eerste keer hier besteld (sketch)'], ['3–8s', 'scroll', '…'],
      ['8–12s', 'EDIT', `EDIT: de laatste echte levering duurde ${f.delivery.latest}`], ['12–14s', 'tekst', 'gemeten']],
    vo: () => '', caption: () => 'de EDIT die je wilt lezen', cta: () => `${URL}` }),
  c('rd-tldr', 'reddit', 'TL;DR van de refund-regels', {
    angle: 'Lange regels, korte TL;DR.',
    hook: () => 'TL;DR van de refund-regels die niemand leest',
    beats: () => [['0–3s', 'lange tekst scrolt', 'refund-regels…'], ['3–7s', 'TL;DR blok', 'TL;DR: niet geleverd = geld terug'],
      ['7–11s', 'TL;DR 2', 'nog niet geleverd? annuleren mag'], ['11–13s', 'tekst', 'that’s it']],
    vo: () => '', caption: () => 'TL;DR editie', cta: () => `${URL}/refunds` }),
  c('rd-megathread', 'reddit', 'Megathread: alles over inwisselen', {
    needs: ['redeem'], angle: 'Pinned megathread-look.',
    hook: (f) => `📌 megathread: ${game(f)} inwisselen, alles op één plek`,
    beats: (f) => [['0–3s', 'pinned-layout', 'megathread'], ['3–9s', 'stap-lijst', `waar: ${f.redeemWhere}`], ['9–13s', 'stappen', `${f.redeemSteps} stappen`], ['13–15s', 'tekst', 'save']],
    vo: () => '', caption: () => 'save de megathread', cta: () => `${URL}` }),
  c('rd-weekly-thread', 'reddit', 'Weekly “wat heb je gekocht” thread', {
    needs: ['week'], persona: 'de baas', angle: 'Wekelijkse thread met echte aantallen.',
    hook: (f) => `weekly thread: deze week ging ${f.product.name} ${f.sold.last7}× de deur uit`,
    beats: (f) => [['0–3s', 'thread-layout', 'weekly thread'], ['3–8s', 'getal', `${f.sold.last7}× ${f.product.name}`], ['8–12s', 'tekst', 'wat speel jij dit weekend?']],
    vo: () => '', caption: () => 'wat speel jij dit weekend?', cta: () => `${URL}` }),
  c('rd-mod-note', 'reddit', 'Mod-note: dit zijn de regels', {
    angle: 'Moderator-notitie-stijl voor de huisregels.',
    hook: () => '🛡 mod note: zo werkt het hier',
    beats: () => [['0–3s', 'mod-note-layout', 'mod note'], ['3–7s', 'regel 1', 'je betaalt na bestellen'], ['7–10s', 'regel 2', 'geen wachtwoorden, ooit'],
      ['10–13s', 'regel 3', 'niet geleverd = geld terug'], ['13–15s', 'tekst', 'vragen → Discord']],
    vo: () => '', caption: () => 'huisregels in 15 sec', cta: () => `${URL}/discord` }),
  c('rd-comparison-thread', 'reddit', 'Thread: “waar koop jij je tegoed?”', {
    angle: 'Vergelijkingsthread zonder concurrenten te noemen.',
    hook: () => 'thread: waar let jij op als je game-tegoed koopt?',
    beats: () => [['0–3s', 'thread-layout', 'waar let jij op?'], ['3–7s', 'comment 1 (eigen account)', 'geen wachtwoord'],
      ['7–10s', 'comment 2', 'naam van de verkoper'], ['10–13s', 'comment 3', 'refund-regels'], ['13–15s', 'tekst', 'vul aan in de comments']],
    vo: () => '', caption: () => 'vul aan 👇', cta: () => `${URL}` }),
  c('rd-pricecheck', 'reddit', 'Price check: echte observatie', {
    needs: ['market'], angle: 'Price-check-post met bron en datum.',
    hook: (f) => `price check ${f.product.name}: ${f.priceText} hier, ${f.market.source} ${f.market.price} (${f.market.date})`,
    beats: (f) => [['0–3s', 'thread-layout', 'price check'], ['3–8s', 'tabel', `hier ${f.priceText} · ${f.market.source} ${f.market.price}`], ['8–12s', 'kleine tekst', `gezien op ${f.market.date}`], ['12–14s', 'tekst', 'prijzen veranderen']],
    vo: () => '', caption: () => 'met bron en datum', cta: () => `${URL}` }),

  /* ═══ TIKTOK NATIVE — Bolt and de baas, replying, stitching, trending ════ */
  c('nat-reply-legit', 'native', 'Reply to comment: “is dit legit?”', {
    persona: 'Bolt', angle: 'Comment-reply-bubble, de mascotte antwoordt droog.', sound: 'origineel',
    hook: () => '“is dit legit?” — Bolt antwoordt',
    beats: () => [['0–2s', 'comment-bubble in beeld', '“is dit legit?”'], ['2–7s', 'Bolt (papieren bliksem op stokje)', 'check de footer. naam. land.'],
      ['7–11s', 'Bolt wijst naar /refunds', 'en dit. geld terug.'], ['11–14s', 'Bolt valt om', 'ik ben maar een logo']],
    vo: () => 'Check de footer. En de refundpagina. Ik ben maar een logo.', caption: () => 'Bolt doet zijn best', cta: () => `${URL}/trust` }),
  c('nat-bolt-unhinged', 'native', 'Bolt is unhinged om 3 uur ’s nachts', {
    persona: 'Bolt', angle: 'Mascotte-chaos (Duolingo-energie), eigen karakter.', sound: 'trending dramatisch geluid (rechtenvrij)',
    hook: () => 'Bolt om 03:00 als er een bestelling binnenkomt',
    beats: () => [['0–3s', 'donker, Bolt-silhouet', '03:00'], ['3–6s', 'melding', 'nieuwe bestelling'], ['6–10s', 'Bolt schudt de baas wakker (sketch)', 'WAKKER WORDEN'],
      ['10–14s', 'de baas, slaperig', 'het is 3 uur Bolt. morgenochtend.'], ['14–16s', 'tekst', 'eerlijke levertijden 😴']],
    vo: () => '', caption: () => 'Bolt heeft geen werktijden, ik wel', cta: () => `${URL}` }),
  c('nat-green-screen-faq', 'native', 'Green screen op de eigen FAQ', {
    persona: 'de baas', angle: 'De baas staat voor zijn eigen FAQ en beantwoordt de top-3.',
    hook: () => 'de 3 vragen die ik elke dag krijg',
    beats: () => [['0–3s', 'green screen: FAQ-pagina', 'top 3 vragen'], ['3–7s', 'wijst', '1. hoe snel? → overdag een paar uur'],
      ['7–11s', 'wijst', '2. account nodig? → nee'], ['11–15s', 'wijst', '3. wachtwoord? → nooit'], ['15–17s', 'tekst', 'meer? comments']],
    vo: () => 'Hoe snel: overdag een paar uur. Account: nee. Wachtwoord: nooit.', caption: () => 'FAQ in 15 sec', cta: () => `${URL}/faq` }),
  c('nat-stitch-scam', 'native', 'Stitch op een scam-verhaal', {
    persona: 'de baas', angle: 'Stitch op iemands scam-ervaring (met toestemming of eigen recreatie).',
    hook: () => 'stitch: “ik gaf mijn wachtwoord en was mijn account kwijt”',
    beats: (f) => [['0–3s', 'stitch-clip', '“account kwijt…”'], ['3–8s', 'de baas', 'daarom vraag ik het nooit'],
      ['8–13s', 'checkout', f.accountField ? `alleen je ${f.accountField}` : 'je krijgt een code'], ['13–16s', 'tekst', 'deel dit met wie het nodig heeft']],
    vo: () => 'Daarom vraag ik nooit om een wachtwoord.', caption: () => 'deel dit', cta: () => `${URL}` }),
  c('nat-self-roast', 'native', 'Self-roast van de site', {
    persona: 'de baas', angle: 'Ryanair-achtige zelfspot.',
    hook: () => 'mensen roasten mijn website. ik doe mee.',
    beats: () => [['0–3s', 'comment-bubble', '“je logo is een bliksem, origineel 💀”'], ['3–7s', 'de baas', 'klopt.'],
      ['7–11s', 'comment-bubble', '“waarom duurt het een paar uur?”'], ['11–15s', 'de baas', 'omdat ik het met de hand doe. ook origineel.'], ['15–17s', 'tekst', 'meer roasts? comments open']],
    vo: () => '', caption: () => 'roast me (constructief)', cta: () => `${URL}` }),
  c('nat-day-in-life', 'native', 'Day in the life: eenmans-shop', {
    persona: 'de baas', angle: 'Day-in-the-life met echte routines.',
    hook: () => 'day in the life van iemand die in z’n eentje een game-shop runt',
    beats: () => [['0–3s', 'wekker', '07:30'], ['3–6s', 'koffie + laptop', 'bestellingen van de nacht'], ['6–9s', 'Discord', 'vragen beantwoorden'],
      ['9–12s', 'lunch', 'lunch (belangrijk)'], ['12–16s', 'avond', 'nog één check'], ['16–18s', 'tekst', 'en dat elke dag']],
    vo: () => '', caption: () => 'day in the life, eerlijk', cta: () => `${URL}/about` }),
  c('nat-trend-sound-checklist', 'native', 'Trending sound + checklist', {
    angle: 'Checklist-trend op een trending geluid.', sound: 'trending “checklist”-geluid (rechtenvrij)',
    hook: () => 'dingen die ik check vóór ik online iets koop ✔',
    beats: () => [['0–3s', 'checklist', 'vóór ik koop:'], ['3–5s', '✔', 'wie verkoopt het'], ['5–7s', '✔', 'refund-regels'], ['7–9s', '✔', 'geen wachtwoord'],
      ['9–11s', '✔', 'betalen na bestellen'], ['11–13s', 'tekst', 'alle 4 hier']],
    vo: () => '', caption: () => 'save de checklist', cta: () => `${URL}` }),
  c('nat-asmr-checkout', 'native', 'ASMR checkout', {
    angle: 'ASMR-tikgeluiden over een schermopname van de checkout.', sound: 'tik-geluiden, geen muziek',
    hook: () => 'ASMR: de rustigste checkout op internet',
    beats: (f) => [['0–3s', 'schermopname, tikjes', 'mailadres'], ['3–6s', 'tik', 'vinkje'], ['6–9s', 'tik', 'bestellen'], ['9–12s', 'tekst', `${f.product.name}, rustig besteld`]],
    vo: () => '', caption: () => 'oddly satisfying checkout', cta: () => `${URL}` }),
  c('nat-q-of-the-day', 'native', 'Vraag van de dag', {
    persona: 'de baas', angle: 'Terugkerende serie: één echte vraag per dag.',
    hook: () => 'vraag van de dag: “kan ik annuleren?”',
    beats: () => [['0–3s', 'tekst', 'vraag van de dag'], ['3–8s', 'de baas', 'ja, zolang het niet geleverd is'], ['8–12s', 'wijst naar mail', 'antwoord op je bestelmail'], ['12–14s', 'tekst', 'morgen weer een']],
    vo: () => 'Annuleren kan zolang het niet geleverd is.', caption: () => 'deel 1 van ∞', cta: () => `${URL}` }),
  c('nat-bolt-vs-baas', 'native', 'Bolt vs de baas', {
    persona: 'Bolt', angle: 'Duo-sketch: de chaotische mascotte en de nuchtere eigenaar.',
    hook: () => 'Bolt wil “RAZENDSNEL!!!” op de site zetten',
    beats: () => [['0–3s', 'Bolt typt in hoofdletters', 'Bolt: zet “RAZENDSNEL” erop'], ['3–7s', 'de baas', 'kan niet, het is handwerk'],
      ['7–11s', 'Bolt', '“…een beetje snel?”'], ['11–15s', 'de baas', 'we zeggen alleen wat we meten.'], ['15–17s', 'tekst', 'Bolt is boos']],
    vo: () => '', caption: () => 'Bolt mag niet meer in de copy', cta: () => `${URL}` }),
  c('nat-before-after-site', 'native', 'Before/after van de site', {
    persona: 'de baas', angle: 'Build-in-public: wat er veranderde en waarom.',
    hook: () => 'mijn site toen vs nu (en waarom)',
    beats: () => [['0–3s', 'oude screenshot', 'toen'], ['3–6s', 'nieuwe screenshot', 'nu'], ['6–10s', 'de baas', 'jullie zeiden: te druk. dus: rustiger'], ['10–13s', 'tekst', 'meer feedback? comments']],
    vo: () => '', caption: () => 'build in public', cta: () => `${URL}` }),
  c('nat-wrong-answers', 'native', 'Wrong answers only', {
    angle: 'Comment-bait met een duidelijke juiste uitleg op het eind.',
    hook: (f) => `wat heb je nodig om ${unit(f)} te kopen? wrong answers only`,
    beats: (f) => [['0–3s', 'tekst', 'wrong answers only'], ['3–7s', 'nep-comments (eigen)', '“je pincode” “je wachtwoord” “je ziel”'],
      ['7–11s', 'tekst', f.accountField ? `goed antwoord: je ${f.accountField}` : 'goed antwoord: je mailadres'], ['11–13s', 'tekst', 'jouw wrong answer?']],
    vo: () => '', caption: () => 'wrong answers only 👇', cta: () => `${URL}` }),
  c('nat-countdown-honest', 'native', 'Eerlijke “countdown”', {
    persona: 'de baas', angle: 'Parodie op nep-afteltimers.',
    hook: () => 'shops met een timer “nog 04:59!!” vs ik',
    beats: () => [['0–3s', 'nep-timer-graphic', '⏰ NOG 04:59!!!'], ['3–6s', 'timer reset', '…en weer 04:59'], ['6–10s', 'de baas', 'hier: geen timer. de prijs staat er gewoon.'], ['10–12s', 'tekst', 'rustig kopen mag']],
    vo: () => '', caption: () => 'timers die resetten 🙄', cta: () => `${URL}` }),
  c('nat-launch-diary', 'native', 'Launch-dagboek', {
    persona: 'de baas', angle: 'Aftellen naar de lancering, als eerlijk dagboek.',
    hook: () => 'dag X van een game-shop bouwen in je eentje',
    beats: () => [['0–3s', 'tekst', 'launch dagboek'], ['3–8s', 'scherm: wat vandaag gebouwd is', 'vandaag: checkout rustiger gemaakt'], ['8–12s', 'de baas', 'volg mee'], ['12–14s', 'tekst', 'opent op de launchdatum']],
    vo: () => '', caption: () => 'volg de bouw', cta: () => `${URL}` }),
];

export const COUNT = CONCEPTS.length;
