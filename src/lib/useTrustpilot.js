/**
 * The shop's Trustpilot links, served from `/api/config` so they are set once
 * as env vars and never hard-coded into the bundle.
 *
 * TWO links, because reading and writing are different jobs:
 *   profile — "see what other buyers said"
 *   review  — the form itself, for surfaces that ASK for a review
 * Every click between an ask and the box costs reviews, so an ask must never
 * land on a page where the button still has to be found.
 *
 * Shared + de-duplicated like the category logos: several surfaces render these
 * and none of them should cost an extra request. `''` is a first-class value —
 * it means "no profile yet", and every caller must render nothing rather than
 * a link that 404s. Sending a buyer who went to check the reviews to an error
 * page is worse than showing no link at all.
 */
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { getConfig } from './useConfig.js';

const EMPTY = { profile: '', review: '' };
let cache = null;      // object once known (either field may legitimately be '')
let inflight = null;

function load() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = getConfig()
      .then((c) => {
        cache = {
          profile: String(c?.trustpilotUrl || '').trim(),
          // Falls back to the profile so a caller that asks for the form always
          // gets *somewhere* real — the profile carries a "Write a review"
          // button of its own.
          review: String(c?.trustpilotReviewUrl || c?.trustpilotUrl || '').trim(),
        };
        return cache;
      })
      .catch(() => { cache = EMPTY; return cache; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** @returns {{profile: string, review: string}} both '' while loading / unset. */
export function useTrustpilotLinks() {
  const [links, setLinks] = useState(cache || EMPTY);
  useEffect(() => {
    let alive = true;
    load().then((l) => { if (alive) setLinks(l); });
    return () => { alive = false; };
  }, []);
  return links;
}

/** The profile URL alone — for the surfaces that only invite reading. */
export function useTrustpilot() {
  return useTrustpilotLinks().profile;
}
