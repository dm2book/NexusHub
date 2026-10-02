/**
 * SMS delivery via Twilio (used for phone OTP). Mirrors emailService's philosophy:
 * never throw into the auth flow — if Twilio isn't configured we log the code to
 * the server console in non-prod so the flow is testable, and report not-sent.
 */
import { config } from '../config/env.js';

const E164 = /^\+[1-9]\d{6,14}$/;

/** Normalise a phone number to E.164 (strip spaces/dashes; keep leading +). */
export function normalizePhone(input) {
  let p = String(input || '').trim().replace(/[\s()\-.]/g, '');
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  return p;
}
export const isValidPhone = (p) => E164.test(normalizePhone(p));

/**
 * Can we actually get a code onto someone's phone?
 *
 * Not the same question as "is Twilio configured": in development the code is
 * printed to the console, which is a real delivery channel for whoever is
 * running the server. In production it is not — and the login page used to
 * announce "We sent a 6-digit code by SMS" either way, then count down ten
 * minutes for a message that was never sent. Everything that offers SMS asks
 * this first.
 */
export const smsAvailable = () => config.sms.enabled || !config.isProd;

/* The login SMS, per language. Plain GSM-7 characters only (no emoji, no
   curly quotes): one character outside that set and the carrier sends the
   whole message as UCS-2, which halves its length and can split a code SMS
   into two parts that arrive out of order. */
const OTP_TEXT = {
  nl: (c, m, b) => `Je ${b}-code is ${c}. Geldig ${m} min. Deel hem met niemand: ${b} vraagt er nooit om.`,
  en: (c, m, b) => `Your ${b} code is ${c}. Valid for ${m} min. Never share it: ${b} will never ask for it.`,
  de: (c, m, b) => `Dein ${b}-Code ist ${c}. Gueltig ${m} Min. Gib ihn niemandem: ${b} fragt nie danach.`,
  fr: (c, m, b) => `Votre code ${b} est ${c}. Valable ${m} min. Ne le partagez jamais: ${b} ne le demande jamais.`,
};

/** The language a number most likely reads, when nothing better is known. */
export function langForPhone(phone) {
  const p = normalizePhone(phone);
  if (/^\+(31|32)/.test(p)) return 'nl';
  if (/^\+(49|43|41)/.test(p)) return 'de';
  if (/^\+33/.test(p)) return 'fr';
  return 'en';
}

/**
 * The text of a login-code SMS.
 *
 * The last line is the origin-bound one-time-code format: "@host #code" on a
 * line of its own. With it, Safari on iPhone offers the code above the
 * keyboard, and Chrome on Android hands it straight to the login page (WebOTP)
 * — and neither will offer it on any other site, which is the point: a code
 * that only autofills on forgemarket.nl cannot be phished onto a lookalike.
 */
export function otpSmsText(code, { lang = 'en', ttl = config.auth.otpTtlMinutes, brand = config.email.fromName, host } = {}) {
  const h = host || (() => { try { return new URL(config.appUrl).host; } catch { return null; } })();
  const body = (OTP_TEXT[lang] || OTP_TEXT.en)(code, ttl, brand);
  return h ? `${body}\n\n@${h} #${code}` : body;
}

export async function sendSms(to, body) {
  const phone = normalizePhone(to);
  if (!config.sms.enabled) {
    if (!config.isProd) console.log(`\n📱  [dev] SMS to ${phone}:  ${body}\n`);
    return { sent: false, reason: 'sms_not_configured' };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.sms.accountSid}/Messages.json`;
  const auth = Buffer.from(`${config.sms.accountSid}:${config.sms.authToken}`).toString('base64');
  const form = new URLSearchParams({ To: phone, From: config.sms.from, Body: body });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[sms] twilio error', res.status, txt.slice(0, 200));
      return { sent: false, reason: `twilio_${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error('[sms] send failed', e?.message || e);
    return { sent: false, reason: 'network' };
  }
}
