/**
 * Serving a stored product picture.
 *
 * The whole point of moving these out of products.metadata was to make them
 * cacheable, so the headers are the feature:
 *
 *   immutable, one year   The URL contains the content hash. Different bytes
 *                         mean a different URL, so a cached copy can never be
 *                         stale and a browser never needs to revalidate.
 *   ETag                  For the one case immutable does not cover — a client
 *                         that ignores it, or a proxy revalidating anyway.
 *   s-maxage              The CDN keeps it too, so the database is read roughly
 *                         once per image per region rather than once per visitor.
 *
 * A missing image is a 404, not a 500: an id in a URL comes from whatever typed
 * it, and a bad one is a wrong address rather than a broken shop.
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { readImage } from '../services/imageStoreService.js';

const router = Router();

router.get('/:file', asyncHandler(async (req, res) => {
  const id = String(req.params.file || '').split('.')[0].toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(id)) return res.status(404).json({ error: { message: 'Not found' } });

  const img = await readImage(id);
  if (!img) return res.status(404).json({ error: { message: 'Not found' } });

  const etag = `"${img.sha256.slice(0, 32)}"`;
  res.set({
    'Content-Type': img.mime,
    'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
    ETag: etag,
    /* The bytes are a picture, whatever the row says the mime is. Without this
       a mislabelled upload could be sniffed into something executable. */
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': String(img.byte_size),
  });
  if (req.get('if-none-match') === etag) return res.status(304).end();
  return res.send(img.bytes);
}));

export default router;
