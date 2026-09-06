# Teardown: the Eneba Shorts ad, and the cut written against it

A 20.7s vertical advert, served on a Dutch YouTube Shorts feed
("Vind voordelige videogames voor alle platforms bij…"), 888×1920, 40.9 fps.
Every timing below was read off the frames, one per second.

## What it does, second by second

| t | on screen |
|---|---|
| 0.0–2.0 | logo splash on flat purple, then a fake search bar: "BUY GAMES, GIFT CARDS & TOP UPS CHEAPER" |
| 2.0–4.0 | 3D gaming desk, monitor showing the same line, neon discount icons flying in |
| 5.0–12.0 | tilted, blurred, scrolling 3D grids of product cards — prices visible but unreadable |
| 13.0–14.0 | a Razer Gold product page with confetti, "$25.51" |
| 15.0–17.0 | "GO TO ENEBA.COM / BUY GAMES, GIFT CARDS & TOP UPS CHEAPER" |
| 18.0–20.7 | logo animation, "DISCOVER DEALS ON eneba.com", loops back to the splash |

## What is wrong with it

1. **The first two seconds are a loading screen.** On Shorts and TikTok that is
   the most expensive frame there is, and it is spent on a logo the viewer has
   no reason to care about yet.
2. **Nothing is ever delivered.** No code, no inbox, no order, no confirmation.
   For a shop selling top-ups, "will it actually arrive?" is the single biggest
   thing standing between a viewer and a purchase, and the advert never
   addresses it.
3. **"Cheaper" is asserted and never shown.** There is no anchor — cheaper than
   what? The word appears three times and is never once demonstrated.
4. **The prices are unreadable.** Nine seconds of product grid, tilted, blurred
   and moving. Not one price can be read at full speed. The value proposition
   is on screen for half the ad and is illegible for all of it.
5. **The prices are in dollars** ($45.99, $42.40, $25.51) on a Dutch placement.
6. **The frame is in English** on that same Dutch placement.
7. **The call to action lands at 15.0s of 20.7** — 73% in. Everyone who left
   before that watched twenty seconds of a shop whose name they cannot type.
8. **Five of the last seconds are logo animation.** A quarter of the runtime is
   brand, in an ad that has not yet earned any.
9. **No human, no hand, no face.** All 3D renders and simulated UI.
10. **It has no narrative.** Nothing starts and nothing finishes; it is a loop of
    B-roll with a card on the end.

The summary: it spends twenty seconds *asserting* and none *proving*.

## The counter-cut — variant J, `klik-tot-code`

This toolkit films a real purchase on the real site, so the cut can do the exact
opposite: spend the whole runtime proving and none asserting.

```
DATABASE_URL=…  node scripts/ad/make-ad.mjs \
  --base=https://forgemarket.nl --sku=ROBUX-1000 \
  --email=ads@yourdomain --variant=klik-tot-code
```

| t | beat | caption |
|---|---|---|
| 0.0 | the product page, price readable and still | **€9.99. Meer wordt het niet.** |
| ~2 | the same page, delivery line | Verstuurd zodra je betaling binnen is |
| ~4 | the buy button | Geen account nodig |
| ~6 | checkout | Betalen met iDEAL |
| ~8 | payment clears | **Betaald — €9.99** |
| ~10 | order confirmed | Bestelling FM-2026-… |
| ~13 | the delivery email lands, sliding in on the notify sound | Je bestelling van ForgeMarket |
| ~16 | the code | **Je code. Klaar.** |
| ~18 | end card, 3s | ForgeMarket · forgemarket.nl |

The four deliberate inversions:

1. **No splash.** Frame one is a product and a price — readable, in euros, held
   still long enough to read. The brand arrives at the end, once earned.
2. **The delivery is the climax.** The last third is the email arriving with the
   code in it. It is the one shot a competitor working from stock renders cannot
   make, and it answers the question their ad ignores.
3. **The address is on screen from the third second.** `cards.mjs` renders a
   quiet corner tag and `compose.mjs` holds it from the second scene until the
   end card. Their CTA appears once, at 73%.
4. **Dutch, and every number real.** Each figure is lifted off the page the
   camera is pointing at.

## What it deliberately does not claim

It never says it is cheaper than anyone. `market_observations` is empty — the
shop has not observed a single competitor price — so there is no number it is
entitled to put on screen next to its own. Making that claim would be the same
mistake Eneba makes, with the added problem of being checkable.

The comparison it makes instead is the only honest one available: **the price
you were shown, against the price you paid.** That is what the €9.99 at 0s and
the "Betaald — €9.99" at 8s are doing, and it is a claim no competitor using
renders can make at all.

`variants.mjs` refuses to build this cut unless the purchase completed and
produced a real order number. An advert for a shop whose whole pitch is that it
does not lie has to be buildable only when it is true.
