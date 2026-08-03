/**
 * The refund policy, kept apart from the other three because it is the one
 * buyers actually read before ordering rather than after.
 *
 * The version this replaces had two real problems, not just stale wording:
 *
 *  1. It never mentioned the statutory right of withdrawal. It said "buyer's
 *     remorse after delivery" was not refundable, which is true — but only
 *     BECAUSE of the waiver ticked at checkout, and a policy that states the
 *     conclusion without the legal basis reads as a shop making up its own
 *     rules. Under Dutch law the exception has to be explained, not assumed.
 *  2. It promised refunds "via Tikkie / Revolut / PayPal", which stopped being
 *     true the moment payments moved to Mollie.
 *
 * It also has to say the things Dutch law requires and the old one omitted: the
 * 14-day maximum for returning the money, that the refund goes back by the same
 * method, that no fee is charged, and that a model withdrawal form exists.
 */

export const REFUND_DOC = {
  updated: '2026-08-03',
  nl: {
    eyebrow: 'Kopersbescherming',
    title: 'Terugbetalingsbeleid',
    subtitle: 'Wanneer je je geld terugkrijgt, hoe je het aanvraagt, en binnen welke termijn het terug is.',
    meta: 'Wanneer je geld terugkrijgt bij ForgeMarket, hoe je een terugbetaling aanvraagt en binnen welke termijn wij terugbetalen.',
    sections: [
      {
        body: [
          'Kunnen wij je bestelling niet leveren, dan krijg je je geld volledig terug. Dat is beleid, geen gunst, en er zitten geen voorwaarden aan.',
          'Deze pagina legt uit wanneer je recht hebt op terugbetaling, wanneer niet, en wat de wet daarover zegt. Hij maakt deel uit van onze algemene voorwaarden.',
        ],
      },
      {
        h: 'Je wettelijke bedenktijd van 14 dagen',
        body: [
          'Bij online aankopen heb je normaal gesproken 14 dagen bedenktijd, zonder opgaaf van reden. Voor **digitale inhoud** geldt een wettelijke uitzondering (art. 6:230p sub e BW): dat recht vervalt zodra de levering is begonnen met jouw uitdrukkelijke toestemming én je hebt erkend daarmee je herroepingsrecht te verliezen.',
          'Dat is precies het vinkje dat je bij het afrekenen zet. Zonder dat vinkje kun je niet bestellen, en wij bewaren de exacte tekst die je hebt aangevinkt bij je bestelling.',
          { note: 'Is je bestelling **nog niet geleverd**, dan kun je hem gewoon annuleren en krijg je alles terug. Het recht vervalt bij levering, niet bij betaling — dus zolang je code er nog niet is, sta je in je recht.' },
          'Geldt de uitzondering niet voor wat jij hebt gekocht, dan heb je gewone 14 dagen bedenktijd vanaf de dag na ontvangst. Je hoeft daarvoor geen reden te geven. Je mag het modelformulier onderaan deze pagina gebruiken, maar een duidelijke e-mail is net zo goed.',
        ],
      },
      {
        h: 'Wanneer je je geld terugkrijgt',
        body: [
          {
            ul: [
              'Je code of top-up is **niet geleverd**.',
              'De code is **ongeldig of al gebruikt** op het moment dat je hem ontvangt.',
              'Je bent **afgeschreven terwijl de bestelling aan onze kant onbetaald of geannuleerd bleef**.',
              'De code werkt **niet zoals beschreven** — verkeerde regio of verkeerd platform terwijl de productpagina iets anders zei.',
              'Er is sprake van een **duidelijke prijs- of productfout** van onze kant.',
              'Wij kunnen niet leveren binnen **30 dagen**, of wij besluiten de bestelling niet uit te voeren.',
            ],
          },
          'In het eerste geval bieden wij meestal eerst een vervangende code aan. Wil je die niet, dan krijg je je geld terug — die keuze is aan jou.',
        ],
      },
      {
        h: 'Wanneer terugbetaling meestal niet kan',
        body: [
          {
            ul: [
              'De code is **al aan jou getoond of door jou ingewisseld** en werkt zoals beschreven. Dat is het moment waarop het herroepingsrecht is vervallen.',
              'Spijt na een geslaagde levering van een geldige code.',
              'Je hebt bij het afrekenen zelf een **verkeerde regio of platform** gekozen, terwijl de productpagina duidelijk aangaf welke het was.',
              'Je hebt bij een top-up een **verkeerde accountnaam** opgegeven en de levering is daarop uitgevoerd.',
              'Het platform van een derde blokkeert of verwijdert je tegoed om redenen die bij hen liggen.',
            ],
          },
          'Sta je in een van deze gevallen toch met lege handen? Neem contact op. Wij kijken naar elke situatie afzonderlijk en lossen meer op dan waartoe wij strikt verplicht zijn.',
        ],
      },
      {
        h: 'Zo vraag je een terugbetaling aan',
        body: [
          'Er zijn drie manieren, en ze komen allemaal bij dezelfde persoon terecht:',
          {
            ul: [
              'Open je **bestelpagina** en vraag daar een terugbetaling aan. Je hebt alleen je bestelnummer nodig, geen account.',
              'Reageer op je **bestelmail**.',
              'Open een ticket in onze **Discord** met je bestelnummer erbij.',
            ],
          },
          'Vermeld je bestelnummer en kort wat er mis is. Wij bevestigen de ontvangst en beoordelen de meeste verzoeken binnen enkele uren gedurende de dag; uiterlijk reageren wij binnen 14 dagen inhoudelijk.',
        ],
      },
      {
        h: 'Hoe en wanneer je het geld terugkrijgt',
        body: [
          'Wij betalen terug via **dezelfde betaalmethode** als waarmee je hebt betaald — betaalde je met iDEAL, dan komt het terug op diezelfde rekening. Alleen als jij daar uitdrukkelijk mee instemt, kiezen wij iets anders.',
          'Wettelijk hebben wij hier 14 dagen voor. In de praktijk starten wij de terugbetaling zodra het verzoek is goedgekeurd; hoe snel het daarna op je rekening staat, hangt af van je bank en duurt meestal één tot drie werkdagen.',
          'Voor een terugbetaling brengen wij **geen kosten** in rekening.',
          'Heb je bij je bestelling winkeltegoed gebruikt, dan komt dat deel als winkeltegoed terug en de rest via je betaalmethode.',
        ],
      },
      {
        h: 'Als je bestelling wordt gecontroleerd',
        body: [
          'Soms houden wij een bestelling tegen voor controle voordat er geleverd wordt, omdat digitale codes onomkeerbaar zijn. Je ziet dat op je bestelpagina staan.',
          'Je betaling is dan gewoon veilig. Blijkt er niets aan de hand, dan wordt er alsnog geleverd. Besluiten wij de bestelling niet uit te voeren, dan krijg je **elke cent terug** — daar hoef je niets voor te doen.',
        ],
      },
      {
        h: 'Niet eens met onze beslissing?',
        body: [
          'Laat het ons eerst weten; de meeste onenigheid is een misverstand dat in één bericht is opgelost.',
          'Komen wij er samen niet uit, dan kun je je klacht voorleggen aan het Europese ODR-platform via **ec.europa.eu/odr**. Je behoudt altijd het recht om naar de bevoegde rechter te stappen.',
        ],
      },
    ],
    form: {
      h: 'Modelformulier voor herroeping',
      intro: 'Alleen invullen en terugsturen als je de overeenkomst wilt herroepen. Dit is niet verplicht — een duidelijke mededeling per e-mail werkt net zo goed.',
      lines: [
        'Aan: {seller}',
        '',
        'Ik/Wij (*) deel/delen (*) u hierbij mede dat ik/wij (*) onze overeenkomst betreffende',
        'de verkoop van de volgende producten herroep/herroepen (*):',
        '',
        'Bestelnummer: ..............................................',
        'Besteld op / ontvangen op (*): .............................',
        'Naam consument(en): ........................................',
        'Adres consument(en): .......................................',
        '',
        'Handtekening consument(en) (alleen bij papieren indiening):',
        '',
        '..............................  Datum: .....................',
        '',
        '(*) Doorhalen wat niet van toepassing is.',
      ],
      copy: 'Formulier kopiëren',
      copied: 'Gekopieerd',
    },
  },
  en: {
    eyebrow: 'Buyer protection',
    title: 'Refund policy',
    subtitle: 'When you get your money back, how to request it, and how long it takes.',
    meta: 'When you get a refund from ForgeMarket, how to request one, and within what period we refund.',
    sections: [
      {
        body: [
          'If we cannot deliver your order you get your money back in full. That is policy, not a favour, and there are no conditions attached.',
          'This page explains when you are entitled to a refund, when you are not, and what the law says about it. It forms part of our terms and conditions.',
          { note: 'Dutch is the authoritative version of this policy. This English translation is provided for convenience.' },
        ],
      },
      {
        h: 'Your statutory 14-day cooling-off period',
        body: [
          'With online purchases you normally have 14 days to change your mind, without giving a reason. For **digital content** there is a statutory exception (Art. 6:230p(e) Dutch Civil Code): that right lapses once delivery has begun with your express consent and your acknowledgement that you thereby lose it.',
          'That is exactly the box you tick at checkout. Without it you cannot order, and we store the exact wording you agreed to with your order.',
          { note: 'If your order has **not yet been delivered** you can simply cancel it and get everything back. The right lapses on delivery, not on payment — so as long as your code has not arrived, you are within your rights.' },
          'If the exception does not apply to what you bought, you have the ordinary 14 days from the day after receipt, with no reason needed. You may use the model form at the bottom of this page, but a clear email is just as good.',
        ],
      },
      {
        h: 'When you get your money back',
        body: [
          {
            ul: [
              'Your code or top-up was **not delivered**.',
              'The code is **invalid or already used** when you receive it.',
              'You were **charged while the order stayed unpaid or cancelled** on our side.',
              'The code does **not work as described** — wrong region or platform where the product page said otherwise.',
              'There was a **clear pricing or listing error** on our part.',
              'We cannot deliver within **30 days**, or we decide not to fulfil the order.',
            ],
          },
          'In the first case we usually offer a replacement code first. If you would rather not have one, you get your money back — that choice is yours.',
        ],
      },
      {
        h: 'When a refund usually is not possible',
        body: [
          {
            ul: [
              'The code has **already been shown to you or redeemed by you** and works as described. That is the moment the right of withdrawal lapsed.',
              'Regret after successful delivery of a valid code.',
              'You chose the **wrong region or platform** at checkout while the product page clearly stated which it was.',
              'You gave the **wrong account name** for a top-up and delivery was carried out to it.',
              'A third-party platform blocks or removes your balance for reasons on their side.',
            ],
          },
          'Left empty-handed in one of these cases anyway? Get in touch. We look at every situation individually and resolve more than we are strictly obliged to.',
        ],
      },
      {
        h: 'How to request a refund',
        body: [
          'Three ways, all reaching the same person:',
          {
            ul: [
              'Open your **order page** and request a refund there. You only need your order number, no account.',
              'Reply to your **order email**.',
              'Open a ticket in our **Discord** with your order number.',
            ],
          },
          'Include your order number and briefly what went wrong. We acknowledge receipt and assess most requests within a few hours during the day; we respond substantively within 14 days at the latest.',
        ],
      },
      {
        h: 'How and when you get the money',
        body: [
          'We refund via the **same payment method** you used — if you paid with iDEAL it comes back to that same account. Only if you expressly agree do we use anything else.',
          'The law gives us 14 days for this. In practice we start the refund as soon as the request is approved; how quickly it lands then depends on your bank, usually one to three working days.',
          'We charge **no fee** for a refund.',
          'If you used store credit on the order, that part comes back as store credit and the rest via your payment method.',
        ],
      },
      {
        h: 'If your order is being checked',
        body: [
          'Sometimes we hold an order for a check before delivering, because digital codes are irreversible. You will see this on your order page.',
          'Your payment is safe. If nothing is wrong it is delivered as normal. If we decide not to fulfil the order you get **every cent back** — you do not need to do anything.',
        ],
      },
      {
        h: 'Disagree with our decision?',
        body: [
          'Tell us first; most disagreements are a misunderstanding resolved in one message.',
          'If we cannot resolve it together you can bring your complaint to the European ODR platform at **ec.europa.eu/odr**. You always retain the right to go to a competent court.',
        ],
      },
    ],
    form: {
      h: 'Model withdrawal form',
      intro: 'Only complete and return this form if you wish to withdraw from the contract. It is not mandatory — a clear statement by email works just as well.',
      lines: [
        'To: {seller}',
        '',
        'I/We (*) hereby give notice that I/We (*) withdraw from my/our (*) contract of',
        'sale of the following goods (*):',
        '',
        'Order number: .............................................',
        'Ordered on / received on (*): .............................',
        'Name of consumer(s): ......................................',
        'Address of consumer(s): ...................................',
        '',
        'Signature of consumer(s) (only if this form is notified on paper):',
        '',
        '..............................  Date: ......................',
        '',
        '(*) Delete as appropriate.',
      ],
      copy: 'Copy form',
      copied: 'Copied',
    },
  },
};
