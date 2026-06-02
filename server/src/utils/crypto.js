import crypto from 'node:crypto';

export const sha256 = (value) =>
  crypto.createHash('sha256').update(String(value)).digest('hex');

/** Constant-time compare of two hex digests. */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
