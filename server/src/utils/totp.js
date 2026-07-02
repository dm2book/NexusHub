/**
 * RFC 6238 TOTP (authenticator apps) implemented with node:crypto only — no
 * dependencies. SHA-1 / 6 digits / 30s period: the parameters every major
 * authenticator app (Google Authenticator, Authy, 1Password, Bitwarden) uses.
 */
import { createHmac, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 (no padding) — the encoding authenticator apps expect. */
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** New 160-bit shared secret, base32-encoded for the authenticator app. */
export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

function hotp(secret, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.max(0, counter)));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 0xf; // dynamic truncation (RFC 4226 §5.3)
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

/** The current 6-digit code (exported mainly for tests). */
export function totpCode(secret, { step = 30, at = Date.now() } = {}) {
  return hotp(secret, Math.floor(at / 1000 / step));
}

/** Verify a user-supplied code with ±`window` steps of clock drift tolerance. */
export function verifyTotp(secret, code, { window = 1, step = 30, at = Date.now() } = {}) {
  const c = String(code || '').replace(/\D/g, '');
  if (!secret || c.length !== 6) return false;
  const counter = Math.floor(at / 1000 / step);
  for (let i = -window; i <= window; i++) {
    if (hotp(secret, counter + i) === c) return true;
  }
  return false;
}

/** otpauth:// provisioning URI — encode as a QR or tap-to-open on mobile. */
export function totpUri({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}` +
    `&algorithm=SHA1&digits=6&period=30`;
}
