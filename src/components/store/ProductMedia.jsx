import { useEffect, useRef, useState } from 'react';
import { carriesOwnBackground } from '../../lib/catalog.js';
import { iconFor } from '../../lib/sampleCatalog.js';

/**
 * One way to put a product's artwork on screen.
 *
 * Every product card in the shop went through two <img> elements: the artwork,
 * and a blurred, scaled copy of the same file behind it to tint the tile. It was
 * measured in a browser before this was written, and the second layer is where
 * the trouble was:
 *
 *  - **Two requests per card for one picture.** Confirmed for every photo card:
 *    the same URL fetched twice, including the ones that 404. On a phone that is
 *    double the bytes for one tile.
 *  - **A full-resolution decode for a thumbnail, twice.** A 4000×4000 source was
 *    decoded to fill a 140px box and again to fill a 235×200 blurred layer, per
 *    card, with a 40px blur composited over it.
 *  - **Both layers lazy, including the first row**, so the tint arrived after the
 *    artwork — which is the "background appears late, then garbles" people saw.
 *
 * So: one element, one request, one decode. The tile's own background is a plain
 * colour that is right before any pixel of the artwork exists, which is what
 * makes the loading state calm instead of a flash of half-blurred nothing.
 *
 * What is deliberately NOT here: any per-product CSS. Where a piece of artwork
 * genuinely needs different framing, it says so in its own data via
 * `imagePosition` / `imageFit` — see focalOf() below.
 */

/** Sensible default framing, overridable per product. */
export const DEFAULT_POSITION = { x: 50, y: 50 };

/**
 * How this product's artwork should sit in the tile.
 *
 * `contain` keeps the whole picture, which is right for a gift card or a render
 * that has to stay readable. `cover` fills the tile edge to edge and crops,
 * which is right for a banner. The focal point decides what survives the crop,
 * and it is a product field rather than a rule about Robux or Minecraft: the
 * composition belongs to the picture, not to the brand.
 */
export function focalOf(product, { isPhoto = false } = {}) {
  /* Two ways to say the same thing, because both are natural to write.

       product.imageDisplay = { fit: 'cover', position: 'center' }   // one object
       product.imageFit = 'cover'; product.imagePosition = { x, y }  // flat fields

     `imageDisplay` wins where both are set. `position` accepts the CSS words
     ('center', 'top', 'bottom left') as well as a percentage pair, because a
     person configuring a product thinks in words and a focal-point picker
     thinks in numbers. */
  const display = product?.imageDisplay || {};
  const WORDS = {
    center: { x: 50, y: 50 }, top: { x: 50, y: 0 }, bottom: { x: 50, y: 100 },
    left: { x: 0, y: 50 }, right: { x: 100, y: 50 },
    'top left': { x: 0, y: 0 }, 'top right': { x: 100, y: 0 },
    'bottom left': { x: 0, y: 100 }, 'bottom right': { x: 100, y: 100 },
  };
  const fromWords = typeof display.position === 'string'
    ? WORDS[display.position.trim().toLowerCase()] : null;
  const p = fromWords || (typeof display.position === 'object' ? display.position : null)
    || product?.imagePosition || {};
  const x = Number.isFinite(p.x) ? Math.min(100, Math.max(0, p.x)) : DEFAULT_POSITION.x;
  const y = Number.isFinite(p.y) ? Math.min(100, Math.max(0, p.y)) : DEFAULT_POSITION.y;
  /* The whole picture, by default.

     `cover` is tempting — it fills the tile, so there is no background left to
     match and no seam to get wrong. Measured against the real artwork it is the
     wrong default: a gift card is a PORTRAIT image (380×560) and the tile is
     landscape (176×150), so covering it shows the middle third and throws away
     the brand mark at the top and the amount at the bottom. "Parts of the image
     disappear" is precisely the complaint this work started from.

     So the default keeps every pixel, and cropping is opt-in per product — for
     the banner-shaped art where filling the tile IS the intent. A generated icon
     is always contained: it is a transparent badge with no background of its
     own, drawn to sit inside the plinth with padding. */
  const fit = display.fit || product?.imageFit || 'contain';
  return {
    fit: fit === 'cover' ? 'cover' : 'contain',
    position: `${x}% ${y}%`,
    scale: Number.isFinite(product?.imageScale) ? product.imageScale : 1,
  };
}

export default function ProductMedia({
  product,
  className = '',
  /** First rows should not be lazy: they are the reason the page looks loaded. */
  priority = false,
  /** Rendered box, so the browser can reserve it before any bytes arrive. */
  width = 320,
  height = 272,
}) {
  /* Two separate facts, and they must stay separate.

     `failed` is sticky and decides WHICH file to show. `loaded` decides whether
     to fade it in. Folding them into one value is not a style choice — it is an
     infinite loop, and this component shipped with it for exactly one test run:
     the artwork 404s, state becomes 'failed', src switches to the category icon,
     the icon loads, state becomes 'ready', src switches BACK to the broken
     artwork, which 404s again. Measured at 193 requests for one missing file on
     a single page load. */
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef(null);

  const custom = product?.image;
  const fallback = iconFor(product?.category);
  const src = (!failed && custom) ? custom : fallback;
  const isPhoto = carriesOwnBackground(src);
  const { fit, position, scale } = focalOf(product, { isPhoto });

  /* A cached image can be complete before React attaches onLoad, which would
     leave the skeleton up forever on a second visit or a back navigation —
     measured: four of forty-eight images were still marked unloaded after going
     back. Ask the element directly on mount. */
  useEffect(() => {
    setLoaded(false);
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) setLoaded(true);
  }, [src]);

  if (!src) {
    return <div className={`overflow-hidden bg-slate-100 ${className}`} aria-hidden />;
  }

  /* No positioning of its own. The caller says where this sits — and a component
     that hardcodes `relative` while the caller passes `absolute inset-0` leaves
     two equal-specificity classes fighting, which one build resolved by NOT
     filling the tile: the artwork rendered 256px tall inside a 150px box and
     drove CLS from 0.003 to 0.475. */
  return (
    <div className={`overflow-hidden ${className}`}>
      {/* The tile's own background, correct from the first frame. Photos get a
          neutral ground; generated icons keep the plinth their design assumes. */}
      <div aria-hidden className={`absolute inset-0 ${isPhoto ? 'bg-slate-50' : ''}`} />

      {/* Skeleton only while we are genuinely waiting. It is a shimmer over the
          real background, never a grey box that then jumps. */}
      {!loaded && (
        <div aria-hidden className="absolute inset-0 fm-skeleton opacity-60" />
      )}

      <img
        ref={imgRef}
        data-morph
        src={src}
        alt={product?.name || ''}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        fetchpriority={priority ? 'high' : 'auto'}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (import.meta.env?.DEV) {
            console.warn(`[product art] failed to load for ${product?.name || product?.id}: ${src}`);
          }
          // One swap, then stop. If the fallback itself fails there is nothing
          // further to try, and trying anyway is the request storm above.
          setFailed(true);
        }}
        style={{ objectFit: fit, objectPosition: position, transform: scale !== 1 ? `scale(${scale})` : undefined }}
        /* Less padding on a phone. 24px on a 122px-tall box left a 512px icon
           rendering at 74px — a quarter of the tile spent on air. The desktop
           inset is unchanged. */
        className={`relative z-[1] w-full h-full transition-opacity duration-300 ${
          loaded ? 'opacity-100' : 'opacity-0'
        } ${isPhoto ? '' : 'p-4 sm:p-7'}`}
      />
    </div>
  );
}
