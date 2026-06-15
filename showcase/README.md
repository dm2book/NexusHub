# AETHER — Walk The Drop

A standalone, dependency-free **cinematic fashion experience** (sneakers + clothes),
rendered in the **Dala** design system — a particle cosmos on a pure-black void with a
single violet pulse (`#8052ff`) as the only color authority, ultra-thin etched type
(Inter weight 200), hairline borders, and **no shadows / gradients / glows** (depth
comes from contrast and the void). Built as a single self-contained HTML file — no
build step, no npm, runs anywhere.
**Completely separate from ForgeMarket** — nothing in the existing app is touched.

## Design system (Dala)
- **Void** `#000000` canvas · **Bone** `#ffffff` type · **Ash/Smoke** muted text
- **Plum Voltage** `#8052ff` — the only filled action color · **Amber Spark** outlines · **Lichen** decorative marks
- Particle constellation owns ≥50% of the hero and **assembles into the hero sneaker**
- Pill geometry (24px radius) everywhere · hairline 1px borders · 60px section rhythm

## View it
- Just open `showcase/index.html` in any modern browser, **or**
- Serve the folder: `npx serve showcase` (or `python3 -m http.server` inside it)

## The cinematic (the hero moment)
`The Walk` is one continuous scroll-driven sequence inside a single pinned viewport:
1. **Dolly** — the camera glides forward through a neon 3D corridor (CSS perspective),
   past glowing arches, side posters, and a receding grid floor.
2. **Lock-on** — the corridor fades and the **hero sneaker rises on a lit podium**,
   centered in frame with spinning rings.
3. **Pan** — the camera pans off the podium and the **clothing display slides in**.

Captions update per phase. All three beats are driven by one normalized scroll value.

## Everything else
- **Loader** with live progress + brand reveal
- **Custom magnetic cursor** with contextual labels (difference blend)
- **Hero** with animated canvas particle field, drifting aurora, split-letter reveals
- **Sneaker Lab** — CSS-drawn sneaker you can **drag to rotate** (with inertia + idle auto-spin)
  and **recolor live** via swatches (recolors the whole room, podium, and lab)
- **Atelier grid** — generated garment cards with **3D tilt hover** + pointer-tracked glow
- **Infinite marquee**, **3D tilt feature cards**
- **Animated add-to-cart** — bag counter pop + slide-in toasts
- **Parallax** hero tags tracking the pointer
- **Optional ambient sound** synthesized live via WebAudio (no audio asset needed)
- Respects `prefers-reduced-motion` (unpins the walk into stacked sections);
  full touch support (drag-rotate, tap-recolor) and mobile layout

No external JS/CSS libraries — only Google Fonts.
