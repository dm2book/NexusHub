# Groeiplan ForgeMarket — 100 klanten in 90 dagen

**Periode:** 4 augustus – 2 november 2026
**Lancering:** 19 september 2026 (dag 46)
**Kanalen:** TikTok, Discord, Instagram Reels, YouTube Shorts — volledig organisch
**Uitvoerder:** één persoon

Dit plan is geschreven na een inventarisatie van wat er al in de codebase zit. Elke
claim hieronder verwijst naar de plek in de code waar hij te controleren is. Waar
een aanname niet uit de code komt, staat dat er expliciet bij.

---

## 1. De rekensom

100 klanten in 90 dagen, met een lancering op dag 46, betekent 100 klanten in
**45 verkoopdagen** = **2,2 klanten per dag**.

De mediane productprijs is **€23,49** (72 actieve producten uit de seed, spreiding
€4,49 – €174,99). 100 orders is dus ongeveer **€2.350 omzet**. De enige opslagregel in de
repo is `MARKUP = 0.18, FLOOR = 2` (`src/pages/admin/Products.jsx:15`), wat bij dit
volume neerkomt op ruwweg **€350–450 brutowinst over 90 dagen**.

Dat getal is het belangrijkste van dit hele document. Dit doel gaat **niet over
inkomen** — het gaat erover of de machine werkt: of vreemden je vertrouwen, of de
levering klopt, of ze terugkomen. Behandel de 100 als een test, niet als een salaris.
Wie dit als inkomen inplant, stopt in week 6.

### Twee routes naar 100, en waarom er maar één haalbaar is

**Route A — social → site → koop.** Conversie van koud shortform-verkeer naar een
eerste aankoop van digitale codes bij een onbekende Nederlandse shop ligt realistisch
tussen 0,5% en 1,5%. Bij 1% heb je ~10.000 sessies nodig. Bij een doorklikratio van
1–2% vanuit bio-links betekent dat **500.000 tot 1.000.000 videoweergaven** in 45
dagen. Voor één persoon zonder bestaand publiek is dat een gok op viraliteit.

**Route B — social → Discord → koop.** Een Discord-lid dat de reviews ziet, de
levering ziet gebeuren en een rol krijgt bij zijn eerste order, converteert in deze
categorie eerder rond 10–20%. Bij 15% heb je **~650 Discord-leden** nodig. Bij een
volg-naar-join-ratio van 3–5% is dat **15.000–25.000 betrokken kijkers**.

Route B is **20 tot 40 keer goedkoper in weergaven**. Het hele plan hangt daarop:

> **Social bouwt Discord. Discord bouwt vertrouwen. De site is de kassa, niet de trechter.**

Deze conversiepercentages zijn ervaringscijfers uit de categorie, geen metingen aan
ForgeMarket — die zijn er nog niet. Hoofdstuk 4 zorgt dat je ze na vier weken wél hebt
en dit plan op eigen cijfers kunt bijstellen.

### Doelen per fase

| | Dag 1–45 (pre-launch) | Dag 46–90 (verkoop) | Totaal |
|---|---|---|---|
| Discord-leden | 250 | +400 | **650** |
| Klanten | 0 (gesloten) | 100 | **100** |
| Geverifieerde reviews | 0 | 30 | **30** |
| Video's gepubliceerd | 135 | 135 | **270** |

135 video's in 45 dagen is 3 per dag — maar dat is **één asset per dag, drie keer
geplaatst** (TikTok + Reels + Shorts). Zie hoofdstuk 3.

---

## 2. Fase 0 — de lekken dichten (dag 1–14)

**Besteed geen enkele weergave voordat dit klaar is.** Verkeer naar een lekke
trechter is verkeer dat je één keer kunt uitgeven en nooit terugkrijgt. Elk punt
hieronder is geverifieerd in de code.

### BLOKKEREND

**0.1 — Er zijn nul codes geladen. Elk product zegt "handmatig".**
Niets in `server/src/db/seed.js`, `demoSeed.js` of `starterContent.js` schrijft naar
`product_codes`. Elke productkaart toont daardoor de amberkleurige "By hand"-badge.
Het sterkste contentformat in deze categorie is *"besteld → code in 30 seconden"*, en
dat is nu letterlijk niet op te nemen. Laad codes voor je **top 10 SKU's** —
begin bij `ROBUX-1000` (€9,99), `VBUCKS-1000` (€5,99), `VAL-1000` (€7,99): de drie
laagste instapprijzen in de drie categorieën waar de SEO al op staat.

**0.2 — De /discord-pagina beschrijft een server die niet bestaat.**
`src/pages/Discord.jsx:12-18` adverteert `#robux`, `#nitro`, `#giftcards`, `#orders`,
`#gaming`, `#screenshots`, `#customer-reviews`, `#create-ticket`, `#support-chat`.
Geen daarvan staat in `discord/src/config.js`. Erger: de pagina **laat de goede weg** —
`#proof-of-delivery`, `#restocks`, `#deals`, `#price-list`, `#ask-the-bot`,
`#giveaways` bestaan wél en verkopen de server veel beter. Dit is de enige pagina die
een bezoeker in een community-lid verandert, en hij klopt niet.

**0.3 — Rollen werken niet op een relay-only deployment.**
`discordRolesService.js:53` vereist `DISCORD_BOT_TOKEN` + `DISCORD_GUILD_ID` op de
API-host — precies wat de relay-architectuur wilde vermijden. Volg je de
gedocumenteerde setup ("draai de bot, zet geen Discord-secrets op de host"), dan wordt
**Verified Customer, VIP, Reviewer en elke loyaliteitsrol nooit toegekend**. De rollen
zijn de hele retentiemotor van hoofdstuk 7. Zet die twee variabelen, of accepteer dat
Discord een chatkanaal is en geen loyaliteitssysteem.

**0.4 — Er is geen enkele e-mailcapture.**
Geen nieuwsbrief, geen wachtlijst, geen notify-me. De enige `<input type="email">` in
de hele SPA staat op de checkout. Zes weken pre-launch aandacht heeft dus **precies
één opslagplaats: Discord**. Accepteer dat (en stuur alles naar Discord), of bouw een
wachtlijst. Half doen is het slechtste van beide.

### BELANGRIJK

**0.5 — Nul reviews bij lancering.** Geen enkele seed schrijft naar `reviews`. Vier
pagina's tonen op dag 46 een lege reviewsectie. Zie hoofdstuk 6 — dit is op te lossen
vóór de lancering, met echte vouches uit Discord.

**0.6 — De homepage toont geen enkel product.** 19 categorietegels, geen SKU
(`HomeStore.jsx:543-587`). 22 producten staan op `featured:true` en worden nergens
uitgelicht. De mysterybox (€49,99, de hoogste marge) staat op geen enkele pillar.

**0.7 — Winst en marge lezen 100%.** `metadata.cost` is `null` voor alle 71
demoproducten, dus Analytics rapporteert winst = volledige omzet. Elk winstgetal in
het dashboard is fictie tot je inkoopprijzen invult.

---

## 3. Contentkalender

### Het productiemodel

Eén persoon kan geen 270 unieke video's maken. Wat wél kan:

- **Zondag = opnamedag.** Eén sessie van 2–3 uur, 7 clips.
- **Eén asset, drie plaatsingen.** Verticaal 9:16, geen platformlogo in beeld,
  ondertiteling ingebrand. TikTok 's ochtends, Reels 's middags, Shorts 's avonds —
  met een andere haaktekst per platform, dezelfde video.
- **Zes formats, oneindig herhaalbaar.** Je verzint geen ideeën, je vult sjablonen.

### De zes formats

| # | Format | Duur | Doel | Vereist |
|---|---|---|---|---|
| **A** | **Prijscheck** — jouw prijs naast de officiële store, met iDEAL erbij | 15–25s | Bereik | — |
| **B** | **Levering live** — schermopname: klik → iDEAL → code, ongeknipt | 20–30s | Conversie | 0.1 (codes) |
| **C** | **Waarom is Robux zo duur?** — uitleg over platformmarges | 30–45s | Saves + shares | — |
| **D** | **Echte reactie** — een vouch of review voorgelezen | 10–20s | Vertrouwen | 0.5 (reviews) |
| **E** | **Achter de schermen** — jouw gezicht, Nederlands, één persoon | 20–40s | Vertrouwen | — |
| **F** | **Drop-aankondiging** — schaarste, met Discord als enige toegang | 10–15s | Discord-joins | 0.3 (rollen) |

Format **B** is de belangrijkste en tegelijk de enige die op dag 1 onmogelijk is.
Dat is de reden dat 0.1 bovenaan staat.

Format **E** is de onderschatte. Je grootste concurrenten (G2A, Eneba) zijn
gezichtsloze marktplaatsen. "Eén persoon in Nederland, met iDEAL, die je geld
terugstort als het misgaat" is een positionering die zij structureel niet kunnen
kopiëren. Verstop dat niet — het staat al eerlijk in je footer.

### Wekelijkse mix

| Dag | Format | Platform-volgorde |
|---|---|---|
| Ma | A — Prijscheck | TikTok → Reels → Shorts |
| Di | C — Uitleg | TikTok → Shorts → Reels |
| Wo | B — Levering | TikTok → Reels → Shorts |
| Do | D — Reactie | TikTok → Reels |
| Vr | F — Drop | TikTok → Reels → Shorts |
| Za | E — Achter de schermen | TikTok → Reels |
| Zo | *opnamedag* — beste clip van de week opnieuw plaatsen | Shorts |

### De 13 weken

**FASE 1 — Publiek bouwen (week 1–6, 4 aug – 14 sep). Winkel dicht.**

De shop verkoopt nog niet. Alles wijst naar Discord. Dit is de fase waarin je leert
wat werkt terwijl er niets op het spel staat.

| Week | Thema | Zwaartepunt | Discord-doel |
|---|---|---|---|
| 1 | Fase 0 afronden | Geen content — bouwen | — |
| 2 | "Wie ben ik" | E, C | 40 |
| 3 | Prijzen ontleed | A, C | 80 |
| 4 | Robux-week | A, C, E | 130 |
| 5 | V-Bucks & Valorant | A, B (testleveringen) | 180 |
| 6 | Aftellen naar 19/9 | F, E | **250** |

**FASE 2 — Lancering (week 7–8, 15 – 28 sep).**

| Week | Thema | Zwaartepunt | Doel |
|---|---|---|---|
| 7 | **Lancering 19/9** | B, F — dagelijks | 15 klanten |
| 8 | Eerste bewijs | D, B — elke echte review wordt content | 20 klanten |

Week 7 is de enige week met een afwijkend ritme: post **twee keer per dag**, en zet
elke echte levering diezelfde dag om in een format-B-clip. De eerste 20 klanten zijn
de duurste die je ooit werft; daarna doen reviews het werk.

**FASE 3 — Opschalen (week 9–13, 29 sep – 2 nov).**

| Week | Thema | Zwaartepunt | Doel |
|---|---|---|---|
| 9 | Wat verkocht | A op je bestsellers | 15 |
| 10 | Referral-push | D, F + share-prompt live | 15 |
| 11 | Herfstvakantie (NL) | B, F — piekvraag | 20 |
| 12 | Community-drop | F, E | 10 |
| 13 | Terugkijken + herhaalaankoop | D, C | 5 |

De **Nederlandse herfstvakantie** valt in week 11 of 12 — zoek de exacte data voor
2026 op, ze verschillen per regio. Dat is de enige voorspelbare vraagpiek in dit
venster voor een publiek van scholieren. Plan je grootste drop daar.

---

## 4. KPI-dashboard

### Noordster

> **Betaalde orders per week.**

Niet omzet (één mysterybox vertekent een week), niet volgers (koopt niets), niet
weergaven (meet het algoritme, niet je bedrijf).

### De trechter, met wat de code vandaag kan beantwoorden

| # | Vraag | Meetbaar vandaag? | Waar |
|---|---|---|---|
| 1 | Hoeveel weergaven per kanaal? | Ja — platform-analytics | extern |
| 2 | Hoeveel bezoekers, en **waarvandaan**? | **Data wordt opgeslagen, nooit uitgelezen** | `page_views.referrer`, `migrations.js:633` |
| 3 | Hoeveel Discord-joins per week? | Ja — Discord Insights | extern |
| 4 | Bezoeker → order? | Alleen als één sitebreed getal | `analyticsService.js:31` |
| 5 | Welk product bekeken maar niet gekocht? | **Nee** | geen funnel-events |
| 6 | Betaalde orders, omzet, marge | Ja | `analyticsService.js:9-53` |
| 7 | Herhaalaankopen | Deels — alleen accounts, niet gasten | `analyticsService.js:188` |
| 8 | Reviews & rating | Ja | `reviewsService.js:131` |
| 9 | Referral-orders | Ja | `analyticsService.js:210` |

### De drie ontgrendelingen

De belangrijkste ontdekking van de inventarisatie: **je verzamelt al first-party
bezoekdata en leest hem nooit uit.** `src/lib/usePageViews.js` stuurt bij elke
paginawissel `path` + `document.referrer` naar `POST /api/track`, en dat landt in de
`page_views`-tabel. Er is geen Google Analytics nodig; er is een *uitleesscherm* nodig.

*(`src/lib/track.js` is een tweede, dood tracking-bestand: het stuurt naar
`window.gtag` en `dataLayer`, die geen van beide bestaan. Acht aanroepen, allemaal in
`Login.jsx`, allemaal in het niets. Niet verwarren met de werkende beacon hierboven.)*

1. **Lees `page_views.referrer` en `path` uit.** `trackingService.js:36` bevat al een
   `visitorSeries()` die een dagelijkse unieke-bezoekersreeks berekent — er is geen
   route die hem aanroept. Dode code die je grootste blinde vlek oplost.

2. **Vang een campagnecode af.** Er is nul UTM-afhandeling in de repo. Eén regel naast
   de bestaande `?ref=`-capture in `src/layouts/StoreLayout.jsx:26` (die schrijft al
   naar `localStorage` onder `fm_ref`) volstaat om `?c=tiktok-w7` op te slaan.

3. **Tag elke link die de Discord-bot uitstuurt.** `discord/src/setup.js:353,356` en
   `bot.js:660` posten een kale `STORE_URL`. Zonder marker is Discord —
   het kanaal waar dit hele plan op leunt — structureel niet toe te rekenen.

Zonder deze drie draai je 90 dagen op vier kanalen zonder te weten welk kanaal
verkoopt. Dat is de duurste fout die in dit plan gemaakt kan worden.

### Wekelijkse scorekaart

Vul elke maandag in. Vijf minuten.

| Metric | Bron | Wk-doel fase 1 | Wk-doel fase 3 |
|---|---|---|---|
| Video's gepubliceerd | handmatig | 21 | 21 |
| Weergaven totaal | platform | 5.000 | 25.000 |
| Nieuwe Discord-leden | Discord | 40 | 80 |
| Sitesessies | `page_views` | 150 | 700 |
| **Betaalde orders** | `/admin` | 0 | **20** |
| Nieuwe reviews | `/admin/social` | 0 | 6 |
| Discord-leden die kochten | handmatig | — | 15% |

De laatste rij is de belangrijkste en de enige die je nu met de hand moet tellen.
Zakt hij onder 10%, dan ligt het aan de server (hoofdstuk 7), niet aan je content.

---

## 5. Referral-systeem

**Het bestaat al.** 5% commissie als winkeltegoed, `?ref=CODE`-capture, een
`/account/referrals`-pagina. Het probleem is niet dat het ontbreekt — het is dat
**vrijwel niemand er ooit bij komt**. Vier lekken, in volgorde van kosten:

**5.1 — De uitgenodigde vriend krijgt niets.** `attributeSignup` schrijft het
signup-event weg met commissie 0 (`affiliateService.js:54`) en kent verder nergens
tegoed, korting of coupon toe. Er is dus **geen enkele reden om de link te gebruiken
in plaats van gewoon de site te bezoeken**. Dit is de reden dat referralprogramma's
tweezijdig zijn. Geef de nieuwe klant iets — €2 tegoed of gratis verzendkosten-
equivalent — en het programma gaat pas leven.

**5.2 — Gastbestellingen leveren nul commissie op.** `recordOrderCommission` stopt
direct als er geen `buyerId` is (`affiliateService.js:61-62`). Gast-checkout is de
**standaardroute** van deze shop. De doorverwezen vriend die het snelst koopt — zonder
account — laat de verwijzer met lege handen achter. Attribueer op e-mailadres, niet
alleen op `userId`.

**5.3 — Er is nergens een deelmoment.** Elke referral-plek zit achter
`ProtectedRoute` (`App.jsx:130`). Niets in de footer, de bedankpagina of de
bezorgmail noemt het programma. Het moment met de hoogste intentie — vlak na een
geslaagde levering — zwijgt. **Zet één deelknop op de trackpagina bij status
`completed`.** Dat is de goedkoopste groeimaatregel in dit hele document.

**5.4 — "Commission owed" in het admin-paneel is structureel €0.**
`analyticsService.js:210` telt commissies met status `pending` of `approved`, maar
orders worden weggeschreven als `paid` (`affiliateService.js:77`). Het enige getal
waarmee je het programma zou volgen staat hardgecodeerd op nul.

**Doel voor 90 dagen:** 10 van de 100 klanten komt via een referral. Dat is bescheiden
en het is realistisch — pas na ~40 tevreden klanten heb je genoeg mensen die íets te
delen hebben.

Twee dingen om te weten voordat je er hard op duwt: er is **geen terugvordering** bij
refunds (het `void`-statusveld bestaat in het schema maar wordt nooit geschreven), en
de enige anti-zelfverwijzingscontrole vergelijkt user-id's — niet e-mail, IP of
apparaat. Bij 100 klanten is dat geen probleem. Bij 1.000 wel.

---

## 6. Review-strategie

Reviews zijn in deze categorie geen marketing maar **de conversie zelf**. Iemand die
€40 aan Robux koopt bij een onbekende shop kijkt naar precies één ding: heeft iemand
anders dit overleefd.

### Het probleem: dag 46 begint met nul

Geen enkele seed schrijft naar `reviews`. Vier pagina's tonen bij lancering een lege
sectie. Een lege reviewsectie is **slechter dan geen reviewsectie**.

**Oplossing vóór 19 september:** je hebt 45 dagen Discord-opbouw. Elke `/vouch` in
Discord landt via een HMAC-ondertekende ingest als zichtbare review op de site
(`bot.js:1564` → `catalog.js:76`). Verkoop in fase 1 aan **10 mensen uit je eigen
omgeving tegen kostprijs**, lever echt, en vraag om een echte vouch. Dat zijn tien
echte transacties met tien echte reviews. Verzin er geen één — dat is precies het
soort ding waar deze shop op stukloopt als het uitkomt.

### De vier reparaties

| # | Wat | Waar | Waarom het geld kost |
|---|---|---|---|
| 6.1 | Slechts **één** verzoek, nooit een tweede | `orderService.js:534` | Eén gemiste mail = review voorgoed weg |
| 6.2 | De link mist het e-mailadres | `orderService.js:545` | Gast moet het overtypen — grootste afhaakpunt |
| 6.3 | **Geen enkele beloning** voor een review | `reviewsService.js:47` | Forge Coins bestaan al; 5 munten kost je ~€1,50 |
| 6.4 | Reviews hebben geen `product_id` | `migrations.js:366` | Geen sterren per product = geen rich results in Google |

Let ook op de timing: het verzoek gaat nominaal 24 uur na levering, maar de enige
scheduler is de dagelijkse cron van 04:00 UTC (`vercel.json:12`). In de praktijk komt
de mail dus **24 tot 48 uur** later. Voor het volume van dit plan is dat acceptabel;
weet alleen dat "24 uur" in de code geen 24 uur betekent.

**Doel:** 30 geverifieerde reviews bij 100 klanten (30%). Zonder de reparaties
hierboven is 10–15% realistischer.

---

## 7. Community-strategie

Discord is in dit plan geen kanaal maar **de conversiemotor**. De server is al goed
ontworpen — 30+ kanalen, rollen, tickets, XP, giveaways, een assistent-bot. Wat mist
is de koppeling tussen kopen en erbij horen.

### 7.1 — Zet #proof-of-delivery aan

Het kanaal **bestaat al**, staat op `public: true`, en heet letterlijk
"Screenshots of real, completed deliveries" (`config.js:127`). Er post alleen nooit
iets. Alle order-automatisering gaat naar het privé-`#leads` (`bot.js:1403`).

Een publiek kanaal waar elke levering binnenkomt is **het krachtigste sociale bewijs
dat een nieuwe shop kan hebben**, en het is er al bijna. Geen bedragen, geen namen —
"1.000 Robux · geleverd in 41 seconden" is genoeg.

### 7.2 — De rollen moeten daadwerkelijk toegekend worden

Zie 0.3. Zonder `DISCORD_BOT_TOKEN` + `DISCORD_GUILD_ID` op de API-host krijgt niemand
ooit **Verified Customer**. Die rol is de reden dat iemand zijn account koppelt, en
account-koppeling is de reden dat je Discord aan omzet kunt toerekenen.

Let op: de reconciliatie-sweep verwerkt **25 leden per cron-run** en de cron draait
één keer per dag (`maintenanceService.js:144`). Bij 650 leden duurt een volledige
ronde dus bijna een maand. Voor dit plan prima, maar niet als je harder groeit.

### 7.3 — Drops werken niet

`dropService.js:35` roept `postDropEvent('drop-scheduled', ...)` aan, maar
`discordService.js:275-303` kent alleen `product`, `restock`, `coupon` en `bundle` en
valt stil door. De aanroep zit in een `.catch(() => {})`, dus je ziet niets. Format F
uit de contentkalender leunt hierop — **plan drops tot dat gerepareerd is met de hand
in `#announcements`**.

Ook stil: voorraadwaarschuwingen (`codeStockService.js:46` stopt zonder webhook-URL).

### 7.4 — XP overleeft geen redeploy

Levels en streaks staan in `discord/xp.json` op schijf (`bot.js:92`). Op elke host met
een vluchtig bestandssysteem is iedereens level na een deploy weg. Dat is precies het
soort verlies dat je meest actieve leden wegjaagt. Zet de bot op een host met een
volume, of accepteer dat XP cosmetisch is en zeg dat erbij.

### Wekelijks ritme in Discord

| Dag | Wat | Waarom |
|---|---|---|
| Ma | Prijsupdate in `#price-list` | Reden om terug te komen |
| Wo | Vraag in `#general` | De enige manier om chat op gang te krijgen |
| Vr | Drop of deal in `#deals` | Piek in aandacht voor het weekend |
| Zo | Giveaway (1 product) | Goedkoopste ledengroei die er is |

Eén giveaway per week van een product van €5–10 kost je over 13 weken ongeveer **€100**
en is verreweg de goedkoopste ledenwerving in dit plan.

---

## 8. Weekritme voor één persoon

| Dag | Tijd | Wat |
|---|---|---|
| Zo | 2–3 u | Opnemen: 7 clips. Bewerken. Inplannen. |
| Ma–Za | 20 min | Plaatsen (3×), reageren op reacties eerste uur |
| Ma | 30 min | Scorekaart invullen (hoofdstuk 4) |
| Wo | 30 min | Discord: vraag stellen, tickets afhandelen |
| Vr | 30 min | Drop/deal klaarzetten |
| Do | 1 u | Voorraad: codes bijladen, prijzen checken |

**Totaal ≈ 8 uur per week.** Dat is het maximum dat naast alles wat er verder is vol te
houden is voor 13 weken. Een plan van 20 uur per week is geen ambitieuzer plan, het is
een plan dat in week 5 stopt.

---

## 9. Wat dit plan niet belooft

- **Geen viraliteit.** Het plan werkt bij middelmatige videoprestaties omdat het op
  Discord-conversie leunt in plaats van op bereik. Eén video die aanslaat is bonus,
  geen aanname.
- **Geen geld.** ~€400 brutowinst over 90 dagen. Zie hoofdstuk 1.
- **Geen betaalde advertenties.** Volledig organisch, zoals gevraagd.
- **De conversiepercentages zijn schattingen uit de categorie**, geen metingen aan deze
  shop. Hoofdstuk 4 bestaat om ze na vier weken te vervangen door eigen cijfers.
- **Er is nog geen KvK-inschrijving.** Dat sluit TikTok Shop, geverifieerde
  bedrijfsaccounts en de meeste merksamenwerkingen uit. Voor dit plan niet blokkerend,
  wel iets om te weten voordat je erop rekent.

---

## Bijlage — checklist fase 0

```
[ ] 0.1  Codes laden voor top-10 SKU's                     BLOKKEREND
[ ] 0.2  /discord-pagina gelijktrekken met discord/src/config.js   BLOKKEREND
[ ] 0.3  DISCORD_BOT_TOKEN + DISCORD_GUILD_ID op de API-host       BLOKKEREND
[ ] 0.4  Kiezen: alles naar Discord, óf een wachtlijst bouwen      BLOKKEREND
[ ] 0.5  10 echte transacties + vouches vóór 19/9
[ ] 0.6  Featured producten op de homepage
[ ] 0.7  Inkoopprijzen invullen (anders is elk winstgetal fictie)
[ ] 4.1  page_views.referrer uitlezen (visitorSeries bestaat al)
[ ] 4.2  ?c= campagnecode afvangen naast fm_ref
[ ] 4.3  Bot-links taggen
[ ] 5.1  De uitgenodigde vriend iets geven
[ ] 5.3  Deelknop op de trackpagina bij completed
[ ] 7.1  #proof-of-delivery aanzetten
```

Uit de lancering-audit staan hier nog vier eigenaarstaken naast: `RESEND_API_KEY`,
een live `MOLLIE_API_KEY`, `JWT_SECRET`, en de verkopersidentiteit in
`src/lib/legalIdentity.js`. Zonder die vier verkoopt de shop op 19 september niets.
