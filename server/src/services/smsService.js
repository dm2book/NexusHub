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
