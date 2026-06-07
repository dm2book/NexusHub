# Aurelia — Premium Landing Page

A single-file, dependency-free luxury landing page for a fictional private
wealth office. Built to look high-end and to render flawlessly anywhere — no
build step, no framework, no external image dependencies.

## Concept
Deep warm-black canvas, champagne-gold accents, editorial serif (Fraunces)
paired with a clean sans (Inter). Glassmorphism, soft ambient light, and
restrained motion — the visual language of money kept quiet.

## What's inside `index.html`
- Fixed glass navigation that elevates on scroll
- Hero with animated gradient headline + a live "portfolio" card
  (count-up NAV, drawing sparkline, animated allocation bars)
- Auto-scrolling trust marquee
- Animated stat counters
- Bento services grid with gradient-border hover
- Editorial philosophy split with monogram visual
- Pull-quote testimonial
- Insights cards
- Application / contact CTA band
- Full footer

## Craft details
- All imagery is CSS/SVG — nothing can 404
- Scroll-reveal + count-up via `IntersectionObserver`
- Subtle pointer parallax on ambient orbs
- Fully responsive (desktop → tablet → mobile)
- Respects `prefers-reduced-motion`

## View it
Open `index.html` in any browser, or serve the folder:

```bash
cd premium-site && python3 -m http.server 8000
# → http://localhost:8000
```
