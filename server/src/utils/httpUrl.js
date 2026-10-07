import { z } from 'zod';

/**
 * A link the shop stores and later shows as an <a href> or <img src>.
 * z.string().url() alone accepts `javascript:alert(1)` and `data:` — this only
 * lets real web links through.
 */
export const httpUrl = (max = 500) => z.string().max(max).url()
  .refine((u) => /^https?:\/\//i.test(u), { message: 'Must be an http(s) link' });
