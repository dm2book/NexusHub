# AETHER — Walk The Drop

A standalone, dependency-free **cinematic fashion experience** (sneakers + clothes).
Built as a single self-contained HTML file — no build step, no npm, runs anywhere.
**Completely separate from ForgeMarket** — nothing in the existing app is touched.

## View it
- Just open `showcase/index.html` in any modern browser, **or**
- Serve the folder: `npx serve showcase` (or `python3 -m http.server` inside it)

## What's in it
- **Loader** with live progress + brand reveal
- **Custom magnetic cursor** with contextual labels (difference blend)
- **Hero** with animated canvas particle field, drifting aurora, split-letter reveals
- **The Walk** — a scroll-pinned 3D neon corridor you fly through (CSS 3D + perspective),
  with passing arches, side posters, a receding grid floor, fog, and stage captions
- **Sneaker Lab** — floating CSS-drawn sneaker on a rotating-ring podium with **live colorway swatches**
- **Atelier** — generated garment rack with drape/parallax hover
- **Infinite marquee**, **3D tilt cards** with pointer-tracked glow
- **Cart** with animated bag counter + slide-in toasts
- **Optional ambient sound** synthesized live via WebAudio (no audio asset needed)
- Respects `prefers-reduced-motion`; degrades to touch cursor on mobile

No external JS/CSS libraries — only Google Fonts.
