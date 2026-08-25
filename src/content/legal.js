/**
 * The four legal documents, Dutch first.
 *
 * Deliberately NOT built out of t() keys. These are long-form legal prose where
 * a sentence only means what it means as a whole — splitting them into two
 * hundred translation keys makes it possible for a paragraph to be updated in
 * one language and silently left stale in the other, in the one place on the
 * site where that actually matters. Each document is written once per language,
 * as a document.
 *
 * Dutch is the authoritative version. This shop sells to Dutch consumers, and a
 * trader has to state its terms in a language the buyer genuinely understands
 * (Art. 6:230m BW). The English is a courtesy translation of the same content.
 *
 * `updated` is a fixed date per document, not `new Date()`. The old pages
 * rendered today's date on every visit, which claimed the terms had been revised
 * this morning — every morning. For a document whose whole function is to say
 * which version applied when someone ordered, that is not a cosmetic bug.
 *
 * WHEN YOU CHANGE A DOCUMENT: bump its `updated` date. The version that applies
 * to an order is the one published when the order was placed.
 *
 * Body items:
 *   'text'                 a paragraph (supports **bold**)
 *   { ul: [...] }          a bullet list
 *   { note: '...' }        a highlighted callout
 *   { identity: true }     the seller-identity block, rendered from
 *                          legalIdentity.js so it can never drift out of sync
 *   { table: [[a, b], …] } a two-column table (retention periods, cookies)
 */

export const LEGAL_DOCS = {
  // ── Algemene voorwaarden ──────────────────────────────────────────────────
  terms: {
    path: '/terms',
    updated: '2026-08-03',
    nl: {
      eyebrow: 'Juridisch',
      title: 'Algemene voorwaarden',
      subtitle: 'Deze voorwaarden gelden voor elke bestelling bij ForgeMarket. Ze beschrijven hoe deze winkel echt werkt.',
      meta: 'De voorwaarden die gelden bij elke bestelling: betaling, levering, herroepingsrecht en terugbetaling.',
      sections: [
        {
          body: [
            'Deze algemene voorwaarden gelden voor elk aanbod van ForgeMarket en voor elke overeenkomst die je met ons sluit. Door een bestelling te plaatsen ga je ermee akkoord.',
            'Ze zijn geschreven om te beschrijven hoe deze winkel werkelijk werkt. Lees vooral artikel 5 en artikel 7: bij digitale producten werken betaling en herroeping anders dan bij een gewone webshop.',
          ],
        },
        {
          h: 'Artikel 1 — Wie je tegenover je hebt',
          body: [
            { identity: true },
            'Je kunt ons op elk moment bereiken via het e-mailadres hierboven of via onze Discord. We reageren binnen één werkdag, meestal sneller.',
          ],
        },
        {
          h: 'Artikel 2 — Toepasselijkheid',
          body: [
            'Deze voorwaarden zijn van toepassing op elk aanbod op deze website en op elke overeenkomst op afstand die daaruit voortvloeit. Voordat je bestelt worden ze aan je beschikbaar gesteld; je kunt ze op elk moment op deze pagina teruglezen en opslaan.',
            'Wij wijzen de toepasselijkheid van andere voorwaarden uitdrukkelijk van de hand. Is een bepaling uit deze voorwaarden nietig of vernietigbaar, dan blijven de overige bepalingen gewoon gelden.',
          ],
        },
        {
          h: 'Artikel 3 — Het aanbod',
          body: [
            'Elk aanbod bevat een omschrijving die volledig genoeg is om te beoordelen wat je koopt: om welk product, welke regio en welk platform het gaat, en hoe het geleverd wordt.',
            { token: 'vatStatement' },
            'Kennelijke vergissingen of fouten in het aanbod binden ons niet. Denk aan een prijs die overduidelijk verkeerd is door een type- of systeemfout. Gebeurt dat, dan laten we het je weten vóór levering en betalen we volledig terug als je de bestelling dan niet meer wilt.',
          ],
        },
        {
          h: 'Artikel 4 — De overeenkomst',
          body: [
            'De overeenkomst komt tot stand op het moment dat je de bestelling plaatst en wij die langs elektronische weg bevestigen. Je ontvangt die bevestiging per e-mail, met je bestelnummer en een link naar je bestelstatus.',
            'Je hoeft geen account aan te maken om te bestellen. Maak je er wel een aan, dan werkt inloggen zonder wachtwoord via je e-mailadres. Houd de toegang tot je mailbox dus goed beveiligd: wie jouw e-mail kan lezen, kan als jou inloggen.',
            'Bestellen mag vanaf 18 jaar. Ben je jonger, dan mag je alleen bestellen met toestemming van een ouder of voogd, die dan verantwoordelijk is voor de aankoop. Wij mogen een bestelling annuleren en terugbetalen als wij gegronde reden hebben om aan te nemen dat hieraan niet is voldaan.',
          ],
        },
        {
          h: 'Artikel 5 — Betaling',
          body: [
            'Je betaalt direct bij het afrekenen via onze betaaldienstverlener **Mollie**. Je kunt kiezen uit iDEAL, Bancontact, Apple Pay, creditcard en PayPal. Welke methodes je precies ziet, hangt af van het bedrag en van je apparaat.',
            'Je betaalgegevens worden verwerkt door Mollie en komen niet bij ons binnen. Wij zien alleen dát een betaling is geslaagd, voor welk bedrag en met welke methode.',
            'Je bestelling wordt automatisch bevestigd zodra Mollie de betaling bevestigt — bij iDEAL is dat doorgaans binnen enkele seconden. Betaal je niet, dan wordt de bestelling automatisch geannuleerd na de termijn die op je bestelpagina staat, en wordt er niets afgeschreven.',
            'Betaal je bij uitzondering handmatig via een betaalverzoek, dan is je bestelnummer de betalingsreferentie. Zonder die referentie moeten we je betaling met de hand opzoeken, wat je levering vertraagt.',
          ],
        },
        {
          h: 'Artikel 6 — Levering en uitvoering',
          body: [
            'Wij leveren digitaal. Producten die wij op voorraad hebben, worden automatisch vrijgegeven zodra je betaling bevestigd is. Alles wat niet op voorraad staat, kopen wij voor je in en leveren wij met de hand — in de regel binnen enkele uren gedurende de dag.',
            'Levering gaat naar het e-mailadres dat bij je bestelling hoort, en naar je accountoverzicht als je een account hebt. Op je bestelpagina kun je de status live volgen zonder in te loggen.',
            'Bij een top-up die rechtstreeks op een game-account wordt bijgeschreven, geef je die accountnaam op bij het afrekenen. Je bent zelf verantwoordelijk voor de juistheid daarvan: een top-up die is geleverd op een naam die jij verkeerd hebt doorgegeven, kan niet worden teruggedraaid.',
            'Kunnen wij niet binnen 30 dagen leveren, dan mag je de overeenkomst kosteloos ontbinden en krijg je je geld volledig terug. In de praktijk laten wij het nooit zo ver komen: we melden het je en betalen terug zodra duidelijk is dat leveren niet lukt.',
          ],
        },
        {
          h: 'Artikel 7 — Herroepingsrecht en de uitzondering voor digitale inhoud',
          body: [
            'Bij de meeste online aankopen heb je 14 dagen bedenktijd. Voor digitale inhoud die niet op een materiële drager wordt geleverd, geldt een wettelijke uitzondering (art. 6:230p sub e BW): het herroepingsrecht vervalt zodra de levering met jouw uitdrukkelijke voorafgaande toestemming is begonnen en je hebt erkend daarmee je herroepingsrecht te verliezen.',
            'Daarom vragen wij je bij het afrekenen om één vinkje aan te zetten, waarmee je twee dingen bevestigt: dat je je bestelling direct geleverd wilt hebben, en dat je begrijpt dat je daarmee je herroepingsrecht van 14 dagen verliest zodra er geleverd is. Zonder dat vinkje kun je niet bestellen. Wij bewaren de tekst die je hebt aangevinkt bij je bestelling.',
            { note: 'Zolang je bestelling **nog niet geleverd** is, kun je hem alsnog annuleren en krijg je je geld volledig terug. Het herroepingsrecht vervalt pas bij levering, niet bij betaling.' },
            'Koop je iets waarvoor deze uitzondering niet geldt, dan heb je gewoon 14 dagen bedenktijd vanaf de dag na ontvangst. Je kunt daarvoor het modelformulier voor herroeping gebruiken dat op onze terugbetalingspagina staat, maar dat is niet verplicht — een duidelijke mededeling per e-mail volstaat.',
          ],
        },
        {
          h: 'Artikel 8 — Conformiteit en garantie',
          body: [
            'Wij staan ervoor in dat wat je ontvangt beantwoordt aan de overeenkomst en aan de omschrijving in het aanbod. Werkt een code niet, is hij al gebruikt of blijkt hij ongeldig, dan vervangen wij hem of betalen wij terug.',
            'Deze afspraak komt bovenop je wettelijke rechten en beperkt die niet. Je wettelijke rechten als consument blijven altijd onverkort gelden.',
          ],
        },
        {
          h: 'Artikel 9 — Terugbetaling',
          body: [
            'Kunnen wij je bestelling niet leveren, dan krijg je je geld volledig terug. Dat is beleid, geen gunst.',
            'Terugbetalingen gaan terug via dezelfde betaalmethode als waarmee je hebt betaald, tenzij je uitdrukkelijk met iets anders instemt. Wij betalen uiterlijk binnen 14 dagen terug, en in de praktijk vrijwel altijd binnen enkele werkdagen. Voor terugbetaling worden geen kosten in rekening gebracht.',
            'De volledige regeling — wanneer je wel en niet recht hebt op terugbetaling en hoe je het aanvraagt — staat op onze terugbetalingspagina en maakt deel uit van deze voorwaarden.',
          ],
        },
        {
          h: 'Artikel 10 — Controle op misbruik',
          body: [
            'Digitale producten zijn onomkeerbaar: een code die gelezen is, kan niet worden teruggehaald. Daarom controleren wij bestellingen op signalen van misbruik en gestolen betaalmiddelen.',
            'Een bestelling die daarbij opvalt, wordt **niet automatisch geleverd**, maar eerst door een mens bekeken. Je bestelling blijft gewoon staan, je betaling is veilig, en je ziet dit terug op je bestelpagina. Blijkt er niets aan de hand, dan wordt er alsnog geleverd. Kunnen wij de bestelling niet uitvoeren, dan krijg je elke cent terug.',
            'Wij mogen een bestelling weigeren of annuleren en een account sluiten wanneer sprake is van fraude of misbruik. Rechtmatige bestellingen worden altijd terugbetaald.',
          ],
        },
        {
          h: 'Artikel 11 — Wat niet is toegestaan',
          body: [
            {
              ul: [
                'Betalen met geld of een rekening die niet van jou is, of een betaling terugdraaien nadat je je bestelling hebt ontvangen.',
                'Het bestelproces automatiseren, of proberen de winkel te verstoren of er ongeoorloofd toegang toe te krijgen.',
                'Wat je hier koopt bedrijfsmatig doorverkopen zonder onze schriftelijke instemming.',
              ],
            },
          ],
        },
        {
          h: 'Artikel 12 — Diensten van derden',
          body: [
            'De producten die wij verkopen worden gebruikt binnen diensten van andere bedrijven: uitgevers en platformen. Wij zijn niet aan hen verbonden en hebben geen invloed op hun regels of voorwaarden.',
            'Blokkeert of verwijdert een platform een tegoed om redenen die bij hen liggen, dan is dat een kwestie tussen jou en hen. Ligt het probleem bij ons — een code die nooit heeft gewerkt — dan is het onze verantwoordelijkheid en krijg je je geld terug.',
          ],
        },
        {
          h: 'Artikel 13 — Aansprakelijkheid',
          body: [
            'Wij zijn aansprakelijk voor het leveren waarvoor je hebt betaald. Daarbuiten is onze aansprakelijkheid per bestelling beperkt tot het bedrag dat je voor die bestelling hebt betaald, voor zover de wet dat toelaat.',
            'Deze beperking geldt niet bij opzet of bewuste roekeloosheid onzerzijds, en niets in deze voorwaarden beperkt rechten die je als consument hebt en die niet bij overeenkomst beperkt mogen worden.',
          ],
        },
        {
          h: 'Artikel 14 — Klachten',
          body: [
            'Heb je een klacht, laat het ons dan binnen bekwame tijd weten nadat je het gebrek hebt ontdekt — per e-mail, via je bestelpagina of via onze Discord. Wij bevestigen je klacht en reageren inhoudelijk binnen 14 dagen. Hebben wij meer tijd nodig, dan laten we dat binnen die termijn weten.',
            'Komen wij er samen niet uit, dan kun je je klacht voorleggen aan het Europese ODR-platform via **ec.europa.eu/odr**. Je behoudt altijd het recht om naar de bevoegde rechter te stappen.',
          ],
        },
        {
          h: 'Artikel 15 — Toepasselijk recht en wijzigingen',
          body: [
            'Op elke overeenkomst is Nederlands recht van toepassing. Dwingende bepalingen van het recht van het land waar je als consument woont, blijven onverkort gelden.',
            'Wij kunnen deze voorwaarden wijzigen. Op jouw bestelling is altijd de versie van toepassing die gold op het moment dat je die bestelling plaatste. De datum bovenaan deze pagina geeft aan wanneer deze versie is gepubliceerd.',
          ],
        },
      ],
    },
    en: {
      eyebrow: 'Legal',
      title: 'Terms and conditions',
      subtitle: 'These terms apply to every ForgeMarket order. They describe how this shop actually works.',
      meta: 'The terms that apply to every order: payment, delivery, right of withdrawal and refunds.',
      sections: [
        {
          body: [
            'These terms apply to every offer made by ForgeMarket and to every agreement you enter into with us. By placing an order you accept them.',
            'They are written to describe how this shop really works. Read articles 5 and 7 in particular: with digital products, payment and withdrawal work differently from an ordinary webshop.',
            { note: 'Dutch is the authoritative version of these terms. This English translation is provided for convenience.' },
          ],
        },
        {
          h: 'Article 1 — Who you are dealing with',
          body: [
            { identity: true },
            'You can reach us at any time by email or through our Discord. We reply within one working day, usually sooner.',
          ],
        },
        {
          h: 'Article 2 — Scope',
          body: [
            'These terms apply to every offer on this website and to every distance contract arising from it. They are made available to you before you order; you can read and save them on this page at any time.',
            'We expressly reject the applicability of any other terms. If a provision of these terms is void or voidable, the remaining provisions continue to apply.',
          ],
        },
        {
          h: 'Article 3 — The offer',
          body: [
            'Every offer contains a description complete enough to judge what you are buying: which product, which region and platform, and how it is delivered.',
            { token: 'vatStatement' },
            'Obvious errors in an offer do not bind us — a price that is clearly wrong through a typing or system mistake, for instance. If that happens we will tell you before delivering and refund you in full if you no longer want the order.',
          ],
        },
        {
          h: 'Article 4 — The agreement',
          body: [
            'The agreement is concluded when you place your order and we confirm it electronically. You receive that confirmation by email, with your order number and a link to your order status.',
            'You do not need an account to order. If you create one, sign-in is passwordless and works through your email address, so keep access to your inbox secure: anyone who can read your email can sign in as you.',
            'You may order from the age of 18. If you are younger, you may only order with the permission of a parent or guardian, who is then responsible for the purchase. We may cancel and refund an order where we have good reason to believe this condition is not met.',
          ],
        },
        {
          h: 'Article 5 — Payment',
          body: [
            'You pay at checkout through our payment provider **Mollie**, using iDEAL, Bancontact, Apple Pay, credit card or PayPal. Which methods you see depends on the amount and on your device.',
            'Your payment details are processed by Mollie and never reach us. We only see that a payment succeeded, for what amount, and by which method.',
            'Your order is confirmed automatically as soon as Mollie confirms the payment — with iDEAL that is usually a matter of seconds. If you do not pay, the order is cancelled automatically after the period stated on your order page, and nothing is charged.',
            'If you exceptionally pay by a manual payment request, your order number is the payment reference. Without it we have to find your payment by hand, which delays your delivery.',
          ],
        },
        {
          h: 'Article 6 — Delivery',
          body: [
            'We deliver digitally. Products we hold in stock are released automatically as soon as your payment is confirmed. Anything not in stock we buy in for you and deliver by hand, generally within a few hours during the day.',
            'Delivery goes to the email address on your order, and to your account dashboard if you have one. You can follow the status live on your order page without signing in.',
            'For a top-up credited directly to a game account, you supply that account name at checkout. You are responsible for its accuracy: a top-up delivered to a name you gave us incorrectly cannot be reversed.',
            'If we cannot deliver within 30 days you may cancel the agreement free of charge and receive a full refund. In practice we never let it get that far: we tell you and refund as soon as it is clear delivery will not work.',
          ],
        },
        {
          h: 'Article 7 — Right of withdrawal, and the digital-content exception',
          body: [
            'With most online purchases you have 14 days to change your mind. For digital content not supplied on a tangible medium there is a statutory exception (Art. 6:230p(e) Dutch Civil Code): the right of withdrawal lapses once delivery has begun with your express prior consent and your acknowledgement that you thereby lose that right.',
            'That is why checkout asks you to tick one box confirming two things: that you want your order delivered immediately, and that you understand you lose your 14-day right of withdrawal once it has been delivered. You cannot order without ticking it. We store the exact wording you agreed to with your order.',
            { note: 'As long as your order has **not yet been delivered**, you can still cancel it and get your money back in full. The right of withdrawal lapses on delivery, not on payment.' },
            'If you buy something to which this exception does not apply, you simply have 14 days from the day after receipt. You may use the model withdrawal form on our refund page, but you are not required to: a clear statement by email is enough.',
          ],
        },
        {
          h: 'Article 8 — Conformity and guarantee',
          body: [
            'We warrant that what you receive corresponds to the agreement and to the description in the offer. If a code does not work, has already been used, or turns out to be invalid, we replace it or refund you.',
            'This is in addition to your statutory rights and does not limit them. Your rights as a consumer always apply in full.',
          ],
        },
        {
          h: 'Article 9 — Refunds',
          body: [
            'If we cannot deliver your order you get your money back in full. That is policy, not a favour.',
            'Refunds are returned via the same payment method you used, unless you expressly agree otherwise. We refund within 14 days at the latest, and in practice almost always within a few working days. No charge is made for a refund.',
            'The full policy — when you are and are not entitled to a refund, and how to request one — is on our refund page and forms part of these terms.',
          ],
        },
        {
          h: 'Article 10 — Abuse screening',
          body: [
            'Digital products are irreversible: a code that has been read cannot be recalled. We therefore screen orders for signs of abuse and stolen payment instruments.',
            'An order that stands out is **not delivered automatically** but looked at by a person first. Your order stands, your payment is safe, and you can see this on your order page. If nothing is wrong it is delivered as normal. If we cannot complete the order, you get every cent back.',
            'We may refuse or cancel an order and close an account where there is fraud or abuse. Legitimate orders are always refunded.',
          ],
        },
        {
          h: 'Article 11 — What is not allowed',
          body: [
            {
              ul: [
                'Paying with money or an account that is not yours, or reversing a payment after receiving your order.',
                'Automating the ordering process, or attempting to disrupt or gain unauthorised access to the shop.',
                'Reselling what you buy here commercially without our written agreement.',
              ],
            },
          ],
        },
        {
          h: 'Article 12 — Third-party services',
          body: [
            'The products we sell are used inside services run by other companies: publishers and platforms. We are not affiliated with them and have no influence over their rules.',
            'If a platform blocks or removes a balance for reasons on their side, that is between you and them. If the problem is ours — a code that never worked — it is our responsibility and you get your money back.',
          ],
        },
        {
          h: 'Article 13 — Liability',
          body: [
            'We are liable for delivering what you paid for. Beyond that, our liability per order is limited to the amount you paid for that order, to the extent the law allows.',
            'This limitation does not apply in cases of intent or deliberate recklessness on our part, and nothing in these terms limits rights you have as a consumer that cannot be limited by agreement.',
          ],
        },
        {
          h: 'Article 14 — Complaints',
          body: [
            'If you have a complaint, tell us within a reasonable time of discovering the problem — by email, through your order page, or on our Discord. We acknowledge your complaint and respond substantively within 14 days. If we need longer, we will say so within that period.',
            'If we cannot resolve it together, you can bring your complaint to the European ODR platform at **ec.europa.eu/odr**. You always retain the right to go to a competent court.',
          ],
        },
        {
          h: 'Article 15 — Governing law and changes',
          body: [
            'Dutch law applies to every agreement. Mandatory provisions of the law of the country where you live as a consumer continue to apply in full.',
            'We may change these terms. The version that applies to your order is the one published when you placed it. The date at the top of this page says when this version was published.',
          ],
        },
      ],
    },
  },

  // ── Privacybeleid ─────────────────────────────────────────────────────────
  privacy: {
    path: '/privacy',
    updated: '2026-08-03',
    nl: {
      eyebrow: 'Juridisch',
      title: 'Privacybeleid',
      subtitle: 'Welke persoonsgegevens wij verwerken, waarom, wie ze verder ziet en wat jij daaraan kunt doen.',
      meta: 'Welke persoonsgegevens ForgeMarket verwerkt, op welke grondslag, hoe lang ze bewaard worden en welke rechten je hebt.',
      sections: [
        {
          body: [
            'Dit beleid legt uit welke persoonsgegevens ForgeMarket verwerkt, waarom dat mag, wie ze verder verwerkt en hoe lang ze bewaard worden. Het beschrijft hoe de winkel werkelijk werkt.',
            'Wij verkopen je gegevens niet, en wij volgen je niet over andere websites.',
          ],
        },
        {
          h: 'Verwerkingsverantwoordelijke',
          body: [
            { identity: true },
            'Wij hebben geen functionaris voor gegevensbescherming aangesteld; daartoe zijn wij niet verplicht. Vragen over je gegevens gaan rechtstreeks naar het e-mailadres hierboven.',
          ],
        },
        {
          h: 'Welke gegevens wij verwerken',
          body: [
            {
              ul: [
                '**Je e-mailadres** — nodig om in te loggen, je bestelbevestiging te sturen en je product te leveren.',
                '**Je bestelling** — wat je hebt gekocht, het bedrag, de statusgeschiedenis, en de accountnaam die je eventueel hebt opgegeven voor een top-up.',
                '**Een weergavenaam** en, alleen als je die zelf toevoegt, een telefoonnummer.',
                '**Technische gegevens** — je IP-adres en browser, vastgelegd bij inloggen en bij bestellingen. Dit is wat voorkomt dat iemand duizend e-mailadressen op de inlogpagina afvuurt, en wat ons vertelt dat een login van een onbekende plek komt.',
                '**Fraudesignalen** — een risicoscore per bestelling met de redenen daarvoor, en een register van chargebacks. Zie het aparte kopje hieronder.',
                '**Discord** — je Discord-ID en gebruikersnaam, alleen als je je account koppelt.',
                '**Een betaalbewijs** — alleen als je zelf een screenshot uploadt, en alleen tot je betaling bevestigd is.',
              ],
            },
            'Wij verwerken **geen betaalgegevens**. Je betaalt bij Mollie; wij zien alleen dát een betaling geslaagd is, voor welk bedrag en met welke methode. Je kaartnummer of rekeningnummer bereikt onze systemen niet.',
          ],
        },
        {
          h: 'Waarom wij dit mogen (grondslagen)',
          body: [
            {
              ul: [
                '**Uitvoering van de overeenkomst** (art. 6 lid 1 sub b AVG) — om de bestelling die je plaatste uit te voeren. Zonder deze gegevens kunnen wij niet leveren.',
                '**Gerechtvaardigd belang** (art. 6 lid 1 sub f AVG) — om fraude en misbruik tegen te gaan en de winkel veilig te houden. Ons belang, en het jouwe: de kosten van fraude worden uiteindelijk door alle kopers betaald.',
                '**Wettelijke verplichting** (art. 6 lid 1 sub c AVG) — het bewaren van je bestel- en betaalgegevens voor de Belastingdienst.',
                '**Toestemming** (art. 6 lid 1 sub a AVG) — voor alles wat optioneel is, zoals een nieuwsbrief. Je kunt die toestemming altijd intrekken.',
              ],
            },
          ],
        },
        {
          h: 'Fraudepreventie — wat wij doen en wat niet',
          body: [
            'Digitale producten zijn onomkeerbaar, dus controleren wij elke bestelling op signalen van misbruik. Daarbij kijken wij naar het IP-adres, of eerder vanaf dat adres of e-mailadres een betaling is teruggedraaid, hoeveel bestellingen er in korte tijd zijn geplaatst, en of de verbinding van een datacenter of VPN komt.',
            'Dat levert een score op met de redenen erbij. Komt die boven een drempel, dan wordt je bestelling **niet automatisch geleverd** maar door een mens beoordeeld. **Er wordt nooit uitsluitend geautomatiseerd besloten** om een bestelling te weigeren of te leveren: bij twijfel kijkt er altijd een persoon naar. Daarmee is dit geen geautomatiseerde besluitvorming in de zin van artikel 22 AVG.',
            'Wij stellen geen profiel van je op voor advertenties, en wij delen deze signalen niet met derden.',
          ],
        },
        {
          h: 'Wie je gegevens verder verwerkt',
          body: [
            'Wij gebruiken een klein aantal dienstverleners, die je gegevens uitsluitend in onze opdracht verwerken. Met elk van hen is een verwerkersovereenkomst gesloten.',
            {
              table: [
                ['Mollie B.V. (Nederland)', 'Betalingen. Verwerkt je betaalgegevens als zelfstandig verwerkingsverantwoordelijke.'],
                ['Vercel Inc. (VS)', 'Hosting van de website en de API.'],
                ['Neon Inc. (EU-regio)', 'De database waarin je account en bestellingen staan.'],
                ['Resend (VS)', 'Verzending van je inlogcodes en bestelmails.'],
                ['Discord Inc. (VS)', 'Alleen als je ons daar benadert of je account koppelt.'],
              ],
            },
            'Een deel van deze partijen is buiten de EU gevestigd. Voor die doorgifte steunen wij op de standaardcontractbepalingen van de Europese Commissie. Wij verkopen je gegevens niet en delen ze niet voor advertentiedoeleinden.',
          ],
        },
        {
          h: 'Hoe lang wij gegevens bewaren',
          body: [
            {
              table: [
                ['Bestel- en betaalgegevens', '7 jaar — verplicht op grond van de fiscale bewaarplicht'],
                ['IP-adres bij een bestelling', '1 jaar, daarna wordt alleen het adres uit de bewaarde regel verwijderd'],
                ['IP-adres bij inloggen', '90 dagen'],
                ['IP-adres bij een inlogcode', '7 dagen'],
                ['Chargebackregister (incl. IP)', '18 maanden — een chargeback kan tot ~120 dagen na de betaling binnenkomen'],
                ['Inlogcodes', 'Automatisch verwijderd kort nadat ze verlopen of gebruikt zijn'],
                ['Sessies', 'Tot ze verlopen of je uitlogt; je kunt ze zelf intrekken in je account'],
                ['Betaalbewijzen (screenshots)', 'Verwijderd zodra je betaling bevestigd is'],
              ],
            },
            'Bij het verstrijken van een bewaartermijn voor een IP-adres blijft de onderliggende regel bestaan — je bestelhistorie en het auditspoor houden hun vorm — en wordt uitsluitend het adres eruit gewist.',
          ],
        },
        {
          h: 'Cookies',
          body: [
            'Wij gebruiken één functionele cookie om je ingelogd te houden, en verder geen enkele. Je winkelwagen, je taalkeuze en je verlanglijst staan in je eigen browser en verlaten die pas als je bestelt.',
            'Omdat wij geen advertentie- of trackingcookies plaatsen, heeft deze site geen cookiebanner die om toestemming vraagt. De volledige uitleg staat in ons cookiebeleid.',
          ],
        },
        {
          h: 'Jouw rechten',
          body: [
            'Je hebt het recht om je gegevens in te zien, te laten corrigeren, te laten verwijderen, over te dragen (dataportabiliteit), de verwerking te laten beperken, en bezwaar te maken tegen verwerking op grond van gerechtvaardigd belang. Heb je toestemming gegeven, dan kun je die altijd intrekken.',
            'Stuur je verzoek naar ons e-mailadres. Wij reageren binnen één maand. Verwijdering kan beperkt zijn voor zover wij bestelgegevens wettelijk moeten bewaren; in dat geval leggen wij uit welk deel wij moeten houden en waarom.',
            'Ben je het oneens met hoe wij met je gegevens omgaan, dan kun je een klacht indienen bij de **Autoriteit Persoonsgegevens** (autoriteitpersoonsgegevens.nl). Wij horen het uiteraard liever eerst zelf.',
          ],
        },
        {
          h: 'Kinderen',
          body: [
            'Deze winkel is niet bedoeld voor kinderen onder de 16. Denk je dat een kind ons persoonsgegevens heeft verstrekt, neem dan contact op en wij verwijderen ze.',
          ],
        },
        {
          h: 'Beveiliging',
          body: [
            'Inloggen gaat zonder wachtwoord, dus er is geen wachtwoord van jou dat wij kunnen verliezen. Al het verkeer is versleuteld, sessies gebruiken kortlevende tokens, en toegang tot de beheeromgeving vereist een tweede factor.',
            'Geen enkel systeem is perfect. Raakt een datalek ooit jouw gegevens, dan melden wij dat aan jou en waar vereist aan de Autoriteit Persoonsgegevens.',
          ],
        },
        {
          h: 'Wijzigingen',
          body: [
            'Wij kunnen dit beleid aanpassen. De datum bovenaan deze pagina geeft aan wanneer deze versie is gepubliceerd. Bij ingrijpende wijzigingen laten wij het je actief weten.',
          ],
        },
      ],
    },
    en: {
      eyebrow: 'Legal',
      title: 'Privacy policy',
      subtitle: 'What personal data we process, why, who else sees it, and what you can do about it.',
      meta: 'What personal data ForgeMarket processes, on what legal basis, how long it is kept, and your rights.',
      sections: [
        {
          body: [
            'This policy explains what personal data ForgeMarket processes, why we are allowed to, who else processes it, and how long it is kept. It describes how the shop actually works.',
            'We do not sell your data, and we do not track you across other websites.',
            { note: 'Dutch is the authoritative version of this policy. This English translation is provided for convenience.' },
          ],
        },
        {
          h: 'Controller',
          body: [
            { identity: true },
            'We have not appointed a data protection officer; we are not required to. Questions about your data go straight to the email address above.',
          ],
        },
        {
          h: 'What we process',
          body: [
            {
              ul: [
                '**Your email address** — needed to sign in, to send your order confirmation and to deliver your product.',
                '**Your order** — what you bought, the amount, the status history, and any account name you supplied for a top-up.',
                '**A display name** and, only if you add one yourself, a phone number.',
                '**Technical data** — your IP address and browser, recorded with logins and orders. It is what stops someone firing a thousand email addresses at the login page, and what tells us a sign-in came from somewhere unfamiliar.',
                '**Fraud signals** — a risk score per order with its reasons, and a register of chargebacks. See the separate heading below.',
                '**Discord** — your Discord ID and username, only if you link your account.',
                '**A payment screenshot** — only if you upload one, and only until your payment is confirmed.',
              ],
            },
            'We process **no payment details**. You pay at Mollie; we only see that a payment succeeded, for what amount and by which method. Your card or account number never reaches our systems.',
          ],
        },
        {
          h: 'Why we are allowed to (legal bases)',
          body: [
            {
              ul: [
                '**Performance of the contract** (Art. 6(1)(b) GDPR) — to carry out the order you placed. Without this data we cannot deliver.',
                '**Legitimate interest** (Art. 6(1)(f) GDPR) — to prevent fraud and abuse and keep the shop secure. Our interest, and yours: the cost of fraud is ultimately paid by every buyer.',
                '**Legal obligation** (Art. 6(1)(c) GDPR) — keeping your order and payment records for the tax authorities.',
                '**Consent** (Art. 6(1)(a) GDPR) — for anything optional, such as a newsletter. You can withdraw consent at any time.',
              ],
            },
          ],
        },
        {
          h: 'Fraud prevention — what we do and what we do not',
          body: [
            'Digital products are irreversible, so we screen every order for signs of abuse. We look at the IP address, whether a payment has previously been reversed from that address or email, how many orders were placed in a short time, and whether the connection comes from a datacenter or VPN.',
            'That produces a score with its reasons attached. Above a threshold, your order is **not delivered automatically** but assessed by a person. **No decision to refuse or deliver is ever taken by automated means alone**: where there is doubt, a person always looks. This is therefore not automated decision-making within the meaning of Article 22 GDPR.',
            'We do not build an advertising profile of you, and we do not share these signals with third parties.',
          ],
        },
        {
          h: 'Who else processes your data',
          body: [
            'We use a small number of providers, who process your data solely on our instructions. A data processing agreement is in place with each of them.',
            {
              table: [
                ['Mollie B.V. (Netherlands)', 'Payments. Processes your payment details as an independent controller.'],
                ['Vercel Inc. (US)', 'Hosting for the website and the API.'],
                ['Neon Inc. (EU region)', 'The database holding your account and orders.'],
                ['Resend (US)', 'Sending your login codes and order emails.'],
                ['Discord Inc. (US)', 'Only if you contact us there or link your account.'],
              ],
            },
            'Some of these are established outside the EU. For those transfers we rely on the European Commission’s standard contractual clauses. We do not sell your data and do not share it for advertising.',
          ],
        },
        {
          h: 'How long we keep it',
          body: [
            {
              table: [
                ['Order and payment records', '7 years — required by Dutch tax law'],
                ['IP address on an order', '1 year, after which only the address is removed from the stored row'],
                ['IP address on a login', '90 days'],
                ['IP address on a login code', '7 days'],
                ['Chargeback register (incl. IP)', '18 months — a chargeback can arrive up to ~120 days after payment'],
                ['Login codes', 'Deleted automatically shortly after they expire or are used'],
                ['Sessions', 'Until they expire or you sign out; you can revoke them yourself'],
                ['Payment screenshots', 'Removed once your payment is confirmed'],
              ],
            },
            'When a retention period for an IP address expires the underlying row stays — your order history and the audit trail keep their shape — and only the address is erased from it.',
          ],
        },
        {
          h: 'Cookies',
          body: [
            'We use one functional cookie to keep you signed in, and none besides. Your cart, your language choice and your wishlist live in your own browser and do not leave it until you place an order.',
            'Because we set no advertising or tracking cookies, this site has no cookie banner asking for consent. The full explanation is in our cookie policy.',
          ],
        },
        {
          h: 'Your rights',
          body: [
            'You have the right to access your data, to have it corrected, deleted or transferred (portability), to have processing restricted, and to object to processing based on legitimate interest. Where you have given consent, you can withdraw it at any time.',
            'Send your request to our email address. We respond within one month. Deletion may be limited where we are legally required to keep order records; in that case we will explain which part we must keep and why.',
            'If you disagree with how we handle your data you can complain to the Dutch data protection authority, the **Autoriteit Persoonsgegevens** (autoriteitpersoonsgegevens.nl). We would of course rather hear from you first.',
          ],
        },
        {
          h: 'Children',
          body: [
            'This shop is not intended for children under 16. If you believe a child has given us personal data, contact us and we will delete it.',
          ],
        },
        {
          h: 'Security',
          body: [
            'Sign-in is passwordless, so there is no password of yours for us to lose. All traffic is encrypted, sessions use short-lived tokens, and access to the admin side requires a second factor.',
            'No system is perfect. If a breach ever affects your data we will tell you, and where required the Dutch data protection authority.',
          ],
        },
        {
          h: 'Changes',
          body: [
            'We may amend this policy. The date at the top of this page says when this version was published. We will actively notify you of any substantial change.',
          ],
        },
      ],
    },
  },

  // ── Cookiebeleid ──────────────────────────────────────────────────────────
  cookies: {
    path: '/cookies',
    updated: '2026-08-03',
    nl: {
      eyebrow: 'Juridisch',
      title: 'Cookiebeleid',
      subtitle: 'Eén cookie om je ingelogd te houden. Verder niets — en daarom ook geen cookiebanner.',
      meta: 'Welke cookies ForgeMarket plaatst, wat er in je eigen browser wordt opgeslagen, en waarom deze site geen cookiebanner heeft.',
      sections: [
        {
          body: [
            'De meeste webshops openen met een banner die om toestemming vraagt voor tientallen cookies. Deze niet, en dat is geen nalatigheid.',
            'Wij plaatsen **één** cookie, en die is strikt noodzakelijk om je ingelogd te houden. Voor zulke cookies is volgens artikel 11.7a van de Telecommunicatiewet geen toestemming vereist.',
            'Wij plaatsen geen advertentiecookies van derden, geen analytics van derden en geen trackers die je over andere websites volgen. Wél bewaren wij twee dingen in je eigen browser die niet strikt noodzakelijk zijn: een bezoekersteller en, als je via een van onze advertenties binnenkomt, een advertentiekenmerk. Daar vragen wij toestemming voor — dat is de balk die je bij je eerste bezoek ziet, en je kunt je keuze op elk moment wijzigen.',
            'Daarom heeft deze site **geen cookiebanner**. Niet omdat wij de regels omzeilen, maar omdat er niets is waarvoor wij die toestemming nodig hebben.',
          ],
        },
        {
          h: 'De cookie die wij plaatsen',
          body: [
            {
              table: [
                ['Naam', 'fm_session'],
                ['Doel', 'Je ingelogd houden tussen bezoeken'],
                ['Type', 'Functioneel — strikt noodzakelijk'],
                ['Bewaartermijn', '30 dagen, of tot je uitlogt'],
                ['Geplaatst door', 'ForgeMarket zelf (first-party)'],
                ['Eigenschappen', 'HttpOnly en Secure — niet leesbaar door JavaScript, alleen via een versleutelde verbinding'],
              ],
            },
            'Bestel je zonder account, dan wordt deze cookie helemaal niet geplaatst.',
          ],
        },
        {
          h: 'Wat in je eigen browser blijft',
          body: [
            'Een paar dingen slaan wij op in de lokale opslag van je browser. Dat zijn technisch gezien geen cookies: ze worden nooit met elk verzoek meegestuurd en bereiken onze servers pas als jij iets doet waarbij dat nodig is.',
            {
              table: [
                ['Je winkelwagen', 'Blijft staan als je het tabblad sluit. Gaat pas naar ons als je bestelt.'],
                ['Je taalkeuze (fm_lang)', 'Zodat de site de volgende keer meteen in de juiste taal staat.'],
                ['Je verlanglijst', 'Alleen in je browser, tenzij je een account hebt.'],
                ['Je laatste bestelling', 'Zodat je bestelnummer en bedrag terugkomen als je van een bankapp terugkeert.'],
              ],
            },
            'Je kunt dit alles wissen via de instellingen van je browser (bij "site-gegevens" of "opslag"). De winkel blijft daarna gewoon werken; je winkelwagen is dan leeg.',
          ],
        },
        {
          h: 'Cookies van derden',
          body: [
            'Wij laden **geen** scripts van advertentienetwerken, geen Google Analytics, geen Facebook-pixel en geen social-media-widgets die je volgen.',
            'Twee uitzonderingen die alleen ontstaan door iets wat jij doet:',
            {
              ul: [
                '**Mollie** — zodra je op betalen klikt, ga je naar de betaalpagina van Mollie. Daar gelden de cookies en het privacybeleid van Mollie. Wij hebben daar geen invloed op en ontvangen er geen gegevens uit.',
                '**Discord** — klik je door naar onze Discord-server, dan gelden vanaf dat moment de cookies van Discord.',
              ],
            },
          ],
        },
        {
          h: 'Bezoekersstatistieken',
          body: [
            'Wij tellen paginaweergaven met een willekeurig sessienummer dat in je browser wordt aangemaakt en niet aan jou als persoon is gekoppeld. Er komt geen extern analyticsbedrijf aan te pas en er wordt geen profiel opgebouwd.',
            'Dit gebruiken wij alleen om te zien welke pagina’s werken en waar bezoekers vastlopen.',
          ],
        },
        {
          h: 'Advertentiemeting',
          body: [
            'Kom je binnen via een link onder een van onze eigen advertenties, dan staan daar herkenningscodes in de webadresregel: welke campagne en welke video. Die noteren wij, zodat wij weten welke advertentie iets oplevert en welke wij kunnen stoppen.',
            'Wat wij daarbij **niet** bewaren: geen IP-adres, geen browserkenmerken, geen e-mailadres, en niet de klik-code die TikTok of Google zelf aan het adres toevoegt (`ttclid`, `gclid`). Die laatste lezen wij alleen om te zien van welk platform je komt; de code zelf gooien wij weg voordat er iets wordt opgeslagen. Van de verwijzende site bewaren wij alleen de domeinnaam, niet het volledige adres.',
            'Om die klik aan een eventuele bestelling te kunnen koppelen, zetten wij één willekeurig nummer in de opslag van je browser (`fm_attr`). Dat is geen strikt noodzakelijke opslag, dus daar vragen wij toestemming voor onder "marketing".',
            'Zeg je nee, dan gebeurt er dit: wij tellen dat er iemand via die advertentie binnenkwam — een teller zonder kenmerk is geen persoonsgegeven — maar er komt niets in je browser te staan en wij kunnen die klik niet aan een bestelling koppelen. Trek je je toestemming later in, dan wordt `fm_attr` van je apparaat verwijderd.',
            'Wij sturen niets terug naar TikTok, Google of Meta. Er verlaat geen enkel gegeven onze eigen systemen voor advertentiedoeleinden.',
          ],
        },
        {
          h: 'Cookies weigeren of verwijderen',
          body: [
            'Je kunt cookies blokkeren of verwijderen via de instellingen van je browser. Blokkeer je onze sessiecookie, dan kun je nog steeds bestellen als gast — je kunt alleen niet ingelogd blijven.',
            'De toestemming die je in de cookiebalk gaf, kun je op elk moment intrekken via "Cookievoorkeuren" onder aan elke pagina. Wat je weigert wordt niet alleen niet meer opgeslagen: wat er al staat, wordt op dat moment van je apparaat verwijderd.',
          ],
        },
        {
          h: 'Wijzigingen',
          body: [
            'Gaan wij ooit iets plaatsen waarvoor wél toestemming nodig is, dan vragen wij die eerst — met een echte keuze, waarbij weigeren net zo makkelijk is als accepteren. Tot die tijd blijft deze pagina zeggen wat er staat.',
          ],
        },
      ],
    },
    en: {
      eyebrow: 'Legal',
      title: 'Cookie policy',
      subtitle: 'One cookie to keep you signed in. Nothing else — which is why there is no cookie banner.',
      meta: 'Which cookies ForgeMarket sets, what is stored in your own browser, and why this site has no cookie banner.',
      sections: [
        {
          body: [
            'Most webshops open with a banner asking consent for dozens of cookies. This one does not, and that is not an oversight.',
            'We set **one** cookie, and it is strictly necessary to keep you signed in. Under Article 11.7a of the Dutch Telecommunications Act, no consent is required for such cookies.',
            'We set no third-party advertising cookies, no third-party analytics and no trackers that follow you across other websites. We do keep two things in your own browser that are not strictly necessary: a visitor counter and, if you arrive through one of our adverts, an advertising label. We ask permission for those — that is the bar you see on your first visit, and you can change your answer at any time.',
            'That is why this site has **no cookie banner**. Not because we are working around the rules, but because there is nothing we need your consent for.',
            { note: 'Dutch is the authoritative version of this policy. This English translation is provided for convenience.' },
          ],
        },
        {
          h: 'The cookie we set',
          body: [
            {
              table: [
                ['Name', 'fm_session'],
                ['Purpose', 'Keeping you signed in between visits'],
                ['Type', 'Functional — strictly necessary'],
                ['Retention', '30 days, or until you sign out'],
                ['Set by', 'ForgeMarket itself (first-party)'],
                ['Properties', 'HttpOnly and Secure — not readable by JavaScript, sent only over an encrypted connection'],
              ],
            },
            'If you order without an account, this cookie is never set at all.',
          ],
        },
        {
          h: 'What stays in your own browser',
          body: [
            'A few things are stored in your browser’s local storage. Technically these are not cookies: they are never sent with every request and only reach our servers when you do something that requires it.',
            {
              table: [
                ['Your cart', 'Survives closing the tab. Only reaches us when you order.'],
                ['Your language choice (fm_lang)', 'So the site is in the right language next time.'],
                ['Your wishlist', 'Browser only, unless you have an account.'],
                ['Your last order', 'So your order number and amount come back when you return from a banking app.'],
              ],
            },
            'You can clear all of this through your browser settings (under "site data" or "storage"). The shop keeps working afterwards; your cart will be empty.',
          ],
        },
        {
          h: 'Third-party cookies',
          body: [
            'We load **no** advertising network scripts, no Google Analytics, no Facebook pixel and no social widgets that track you.',
            'Two exceptions, both of which only arise from something you do:',
            {
              ul: [
                '**Mollie** — as soon as you click to pay you go to Mollie’s payment page, where Mollie’s cookies and privacy policy apply. We have no influence there and receive no data from it.',
                '**Discord** — if you follow a link to our Discord server, Discord’s cookies apply from that point.',
              ],
            },
          ],
        },
        {
          h: 'Visitor statistics',
          body: [
            'We count page views using a random session number generated in your browser and not linked to you as a person. No external analytics company is involved and no profile is built.',
            'We use this only to see which pages work and where visitors get stuck.',
          ],
        },
        {
          h: 'Advertising measurement',
          body: [
            'If you arrive through a link under one of our own adverts, that link carries labels in the address: which campaign, and which video. We record those, so we know which advert is worth running and which one to stop.',
            'What we do **not** keep: no IP address, no browser characteristics, no email address, and not the click code TikTok or Google adds to the address itself (`ttclid`, `gclid`). We read that last one only to see which platform you came from, and the code is discarded before anything is written. From the referring site we keep the domain name only, not the full address.',
            'To be able to connect that click to an order, we put one random number in your browser’s storage (`fm_attr`). That is not strictly necessary storage, so we ask permission for it under "marketing".',
            'If you say no, this happens: we count that somebody arrived through that advert — a counter with no identifier is not personal data — but nothing is placed in your browser and we cannot connect that click to an order. Withdraw your consent later and `fm_attr` is removed from your device.',
            'We send nothing back to TikTok, Google or Meta. No data leaves our own systems for advertising purposes.',
          ],
        },
        {
          h: 'Refusing or deleting cookies',
          body: [
            'You can block or delete cookies through your browser settings. If you block our session cookie you can still order as a guest — you just cannot stay signed in.',
            'The consent you gave in the cookie bar can be withdrawn at any time through "Cookie preferences" at the bottom of every page. What you refuse is not merely no longer stored: whatever is already there is removed from your device at that moment.',
          ],
        },
        {
          h: 'Changes',
          body: [
            'If we ever set something that does require consent, we will ask for it first — with a real choice, where refusing is as easy as accepting. Until then this page keeps saying what it says.',
          ],
        },
      ],
    },
  },
};
