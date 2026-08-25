import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { reportLanding, forgetAttribution, onMarketingGranted } from './attribution.js';
import { allowed, onConsentChange } from './consent.js';

/**
 * Watch every route change for campaign parameters and report the landing.
 *
 * On the route rather than on mount because this is a single-page app: there is
 * one real page load, and a visitor who opens the shop and then follows a
 * tagged link inside it would otherwise arrive with nobody looking.
 *
 * Deliberately NOT gated on consent as a whole. The landing is reported either
 * way — with an id when marketing is allowed, without one when it is not — so
 * that a refusal costs the shop the funnel and not the count. attribution.js is
 * where that split lives; this hook only decides when to ask.
 *
 * What consent DOES gate here is the other direction: withdrawing it has to
 * remove what is already on the device, not merely stop the next write.
 */
export function useAdAttribution() {
  const { pathname, search } = useLocation();
  const [, bump] = useState(0);

  /* Answering the banner is not a route change, but it is the moment the
     arrival can gain an identifier — so consent is watched as well as location.
     Saying yes re-reports the landing, which the server turns into an adoption
     of the row already written rather than a second row for the same click. */
  useEffect(() => onConsentChange(() => {
    if (allowed('marketing')) onMarketingGranted({ pathname, search });
    else forgetAttribution();
    bump((n) => n + 1);
  }), [pathname, search]);

  useEffect(() => { reportLanding({ pathname, search }); }, [pathname, search]);
}
