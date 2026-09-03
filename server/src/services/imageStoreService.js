/**
 * Uploaded pictures, stored once and served like files.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────────
 * Product photos were kept as base64 `data:` URIs inside products.metadata.
 * That is the shortest path from an upload form to a working image and it costs
 * more than it looks:
 *
 *   · every catalogue query dragged the bytes out of Postgres, whether or not
 *     the caller cared about pictures — measured live at 4.3 MB per call;
 *   · base64 is 33% larger than the file it encodes, so the shop paid that
 *     surcharge on every read;
 *   · the browser could not cache a picture separately from the JSON it was
 *     embedded in, so the same photo arrived again on every catalogue refresh;
 *   · and nothing could be resized or re-encoded, because there was no URL to
 *     put in front of.
 *
 * Here the bytes live in their own table and the product keeps a URL. The
 * catalogue query gets small, the image gets an immutable cache header, and the
 * picture is fetched once per browser.
 *
 * ── ADDRESSED BY CONTENT ──────────────────────────────────────────────────
 * The id is the first 32 characters of the SHA-256 of the bytes. Two products
 * with the same picture share one row; re-running the migration finds the
 * existing row instead of writing a second copy; and because the URL changes
 * when the bytes change, `immutable` caching is honest rather than a gamble.
 */
import { createHash } from 'node:crypto';
import { get, run, all, nowIso } from '../db/index.js';

/** What an <img> may be pointed at. Matches the upload guard in utils/imageUrl. */
const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif',
};

export const extFor = (mime) => MIME_EXT[String(mime).toLowerCase()] || 'bin';
export const isStoredUrl = (src) => /^\/api\/images\/[a-f0-9]{32}\.[a-z0-9]+$/i.test(String(src || ''));

/** Split a data: URI into its mime and its bytes, or null when it is not one. */
export function parseDataUri(uri) {
  const m = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(String(uri || ''));
  if (!m) return null;
  const mime = m[1].toLowerCase();
  if (!MIME_EXT[mime]) return null;
  try {
    const bytes = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
    return bytes.length ? { mime, bytes } : null;
  } catch { return null; }
}

/** Intrinsic size without an image library — enough of each header to read it. */
export function dimensions(mime, buf) {
  try {
    if (mime === 'image/png' && buf.length > 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xFF) { i += 1; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
    if (mime === 'image/webp' && buf.length > 30 && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
      const tag = buf.subarray(12, 16).toString('ascii');
      if (tag === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (tag === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (tag === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
    }
  } catch { /* an unreadable header is not a reason to refuse the file */ }
  return { width: null, height: null };
}

/**
 * Store bytes and return the URL to reach them.
 *
 * Idempotent by content: the same picture always resolves to the same row and
 * the same URL, so this can be called from an upload form and from a migration
 * without either knowing about the other.
 */
export async function storeImage(mime, bytes, { productId = null, source = 'upload' } = {}) {
  const sha = createHash('sha256').update(bytes).digest('hex');
  const id = sha.slice(0, 32);
  const url = `/api/images/${id}.${extFor(mime)}`;

  const existing = await get(`SELECT id, mime FROM product_images WHERE sha256 = @sha`, { sha });
  if (existing) return { id: existing.id, url: `/api/images/${existing.id}.${extFor(existing.mime)}`, reused: true };

  const { width, height } = dimensions(mime, bytes);
  await run(
    `INSERT INTO product_images (id, product_id, mime, bytes, byte_size, width, height, sha256, source, created_at)
     VALUES (@id, @p, @m, @b, @size, @w, @h, @sha, @src, @at)
     ON CONFLICT (id) DO NOTHING`,
    { id, p: productId, m: mime, b: bytes, size: bytes.length, w: width, h: height,
      sha, src: source, at: nowIso() });
  return { id, url, reused: false, width, height, bytes: bytes.length };
}

/** Fetch for serving. Returns null rather than throwing on an unknown id. */
export async function readImage(id) {
  const row = await get(
    `SELECT id, mime, bytes, byte_size, sha256 FROM product_images WHERE id = @id`,
    { id: String(id || '').toLowerCase() });
  if (!row) return null;
  return { ...row, bytes: Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes) };
}

/**
 * Accept whatever an upload form hands over and give back something storable.
 * A data: URI is moved into the table; anything else (a path, a link) is left
 * exactly as it is, because it is already a URL and not ours to rewrite.
 */
export async function normalizeImageValue(value, { productId = null, source = 'upload' } = {}) {
  const parsed = parseDataUri(value);
  if (!parsed) return { value, stored: false };
  const { url } = await storeImage(parsed.mime, parsed.bytes, { productId, source });
  return { value: url, stored: true, bytes: parsed.bytes.length };
}

/** What the store holds — for the admin, and for the migration's report. */
export async function imageStats() {
  const row = await get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(byte_size), 0) AS total FROM product_images`);
  return { count: Number(row?.n || 0), totalBytes: Number(row?.total || 0) };
}

export async function listImages(limit = 200) {
  return all(
    `SELECT id, product_id, mime, byte_size, width, height, source, created_at
       FROM product_images ORDER BY created_at DESC LIMIT @l`, { l: limit });
}
