# ForgeMarket — Premium Web (Next.js)

A world-class, interactive storefront for ForgeMarket built with **Next.js (App
Router) + TypeScript + Tailwind + GSAP + Lenis + Three.js / React-Three-Fiber /
Drei**. This is a separate front-end from the main app (in `/` and `/server`); it
reuses the same commerce **API**.

## What's inside
- **Cinematic hero** with a lazy-loaded WebGL scene (floating distorted blobs +
  starfield + pointer parallax) and a GSAP intro timeline. Falls back gracefully
  to the gradient when WebGL/reduced-motion.
- **Lenis** smooth scrolling + **GSAP ScrollTrigger** scroll-reveals.
- **Trust system**: trust bar, live stats, verified reviews, guarantees, FAQ.
- **Marketplace**: category filters, animated product cards (3D tilt, badges,
  ratings, delivery), full shop page with search + sort.
- **Discord community** section with perks, member/online counts and a join CTA.
- Fully **responsive** (mobile parity) and performance-conscious (three.js is
  code-split and never ships in the initial load; ~149 kB First Load JS on home).

## Run locally
```bash
cd web
npm install
npm run dev            # http://localhost:3000
```

## Connect to the live catalog (optional)
By default the UI shows a bundled sample catalog so it always looks complete. To
pull real products from the ForgeMarket API, set:
```
NEXT_PUBLIC_API_URL=https://<your-forgemarket-api>.vercel.app
```
(in `.env.local` for dev, or in the Vercel project's env vars). The API's CORS
`APP_URL` should point at this site's origin.

## Deploy on Vercel (separate project)
1. **Add New → Project** → import the repo.
2. **Root Directory: `web`** (important — this app lives in the `web/` subfolder).
3. Framework **Next.js** (auto). Build/output are auto-detected.
4. (Optional) set `NEXT_PUBLIC_API_URL` to your API.
5. Deploy.

> The existing simple storefront (repo root) and the API (`/server`) are
> unchanged and deploy independently. This `web/` app is the premium experience.
