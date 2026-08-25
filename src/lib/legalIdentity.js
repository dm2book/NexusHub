/**
 * Who is selling. Dutch and EU consumer law require a webshop to state this
 * before someone buys (Art. 6:230m BW / Consumer Rights Directive): a name, a
 * geographic address, a contact address, and — once registered — a KvK and VAT
 * number.
 *
 * Every field renders only when it is filled in, so an unset value is left out
 * rather than printed as an empty row or a placeholder. That means the page is
 * never *wrong*; it is only incomplete, and INCOMPLETE_NOTICE below says so
 * plainly for as long as the required fields are missing.
 *
 * Fill KVK and VAT in after registering with the Kamer van Koophandel. Until
 * then the page states honestly that ForgeMarket is run by a private individual
 * and not a registered company — claiming otherwise would be the one thing on
 * this page that could actually get the owner in trouble.
 */
export const LEGAL = {
  /** Trading name shown to buyers. */
  tradeName: 'ForgeMarket',
  /** Legal name of the person or company responsible. REQUIRED before launch. */
  legalName: '',
  /** Street address. Required by law; a PO box is not enough. */
  address: '',
  postcode: '',
  city: '',
  country: 'Nederland',
  /** Kamer van Koophandel number — only after registering. */
  kvk: '',
  /** BTW-identificatienummer — only after registering. */
  vat: '',
};

/** True once the law's minimum set is present. */
export const legalComplete = () =>
  !!(LEGAL.legalName && LEGAL.address && LEGAL.postcode && LEGAL.city);

/** Address as a single readable line, skipping anything unset. */
export const legalAddressLine = () =>
  [LEGAL.address, [LEGAL.postcode, LEGAL.city].filter(Boolean).join(' '), LEGAL.country]
    .filter(Boolean).join(', ');

/**
 * What the terms may truthfully say about VAT.
 *
 * The terms used to state, flatly and in both languages, that "all prices
 * include VAT". Nothing in this system backed that up: there is no VAT rate,
 * no order carries a VAT amount, and the invoice shows no VAT line. If the
 * seller is not VAT-registered the sentence was simply untrue; if they are, the
 * paperwork did not match it either way.
 *
 * So the claim is now derived from the one fact the shop actually publishes —
 * a BTW-identificatienummer — and when that is absent the sentence about VAT is
 * not made at all. What remains is the part this system CAN keep: the price you
 * see is the price you pay, because nothing is added at checkout.
 *
 * Note what this deliberately does not do. It does not say "no VAT is charged",
 * because an unset field is not evidence of a tax position; it is an unset
 * field. Stating the seller's VAT status is the seller's job, and getting it
 * wrong in either direction is worse than staying quiet.
 */
export const vatStatement = (nl) => (LEGAL.vat
  ? (nl
    ? 'Alle prijzen zijn in euro\u2019s en inclusief btw. De prijs die op het moment van bestellen wordt getoond, is de prijs die geldt. Wij rekenen geen toeslagen af bij de kassa: het bedrag dat je ziet, is het bedrag dat je betaalt.'
    : 'All prices are in euros and include VAT. The price shown at the moment you order is the price that applies. We add no fees at checkout: the amount you see is the amount you pay.')
  : (nl
    ? 'Alle prijzen zijn in euro\u2019s. De prijs die op het moment van bestellen wordt getoond, is de prijs die geldt. Wij rekenen geen toeslagen af bij de kassa: het bedrag dat je ziet, is het bedrag dat je betaalt.'
    : 'All prices are in euros. The price shown at the moment you order is the price that applies. We add no fees at checkout: the amount you see is the amount you pay.'));
