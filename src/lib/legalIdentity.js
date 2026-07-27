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
