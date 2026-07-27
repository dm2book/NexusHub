/**
 * Where customers can reach a human.
 *
 * Every surface renders the email row only when this is set, so it stays a
 * one-line change and the site never advertises a route that goes nowhere.
 */
// On the shop's own domain, forwarded to the owner's inbox. If the forward is
// ever removed this address goes silent while still being advertised, so it is
// the one line to change back.
export const SUPPORT_EMAIL = 'support@forgemarket.nl';

/** Discord is the primary route today: no account needed, replies from a person. */
export const SUPPORT_DISCORD_PATH = '/discord';
