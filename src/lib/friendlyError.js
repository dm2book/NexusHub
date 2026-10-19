/**
 * A server refusal, in the buyer's language.
 *
 * The API answers in English. A 4xx message is written for the person reading
 * it, so api.js passes it through — which put "The payment could not be started
 * at our payment provider…" and "This order is not yours" in English on the
 * Dutch checkout, at exactly the moment a payment had just failed. The refusals
 * a buyer can meet in the checkout carry a stable `code`; those are said here,
 * translated. Anything else keeps the server's own sentence.
 */
const BY_CODE = {
  payment_provider_refused: ['err.payRefused',
    'The payment could not be started at our payment provider. Nothing has been charged — please try again later or contact us.'],
  commerce_paused: ['err.paused', 'Ordering is paused right now. Nothing has been charged — please try again shortly.'],
  order_not_yours: ['err.notYours',
    'We could not confirm this is your order. Open the link in your order email, or sign in with the address you ordered with.'],
  payment_under_review: ['err.underReview',
    'Your payment is being checked by our payment provider. You will hear from us by email — please do not pay again.'],
  order_limit_value: ['err.limitValue', 'This order is larger than we accept in one go. Split it into smaller orders, or email us.'],
  order_limit_count: ['err.limitCount', 'That is as many orders as we take from one address in 24 hours. Email us if you need another today.'],
  order_limit_daily: ['err.limitDaily', 'This would take you over our daily ceiling per customer. Email us and we will sort it out by hand.'],
  order_limit_ip: ['err.limitIp', 'We have had an unusual number of orders from your connection today. Email us and a person will help.'],
  validation_error: ['err.validation', 'Something in the form is not filled in correctly. Check your details and try again.'],
};

export function friendlyError(err, t) {
  const known = BY_CODE[err?.code];
  if (known) return t(known[0], known[1]);
  if (err?.status === 503) return t(BY_CODE.commerce_paused[0], BY_CODE.commerce_paused[1]);
  return err?.message || t('err.server', 'Something is wrong on our side. Please try again in a few minutes.');
}

export const FRIENDLY_ERROR_KEYS = Object.values(BY_CODE).map(([k]) => k);
