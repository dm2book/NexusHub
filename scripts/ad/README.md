# ForgeMarket ad toolkit

Vertical adverts (1080×1920, 15–25s) cut from a **real purchase on the real
site** — real catalogue, real checkout, real fulfilment, real delivery email.
Nothing in the footage is a mock-up.

```
DATABASE_URL=postgres://…  node scripts/ad/make-ad.mjs \
  --base=https://forgemarket.nl \
  --sku=ROBUX-1000 \
  --email=ads@yourdomain \
  --pay=mollie-test
```

Out: `scripts/ad/out/robux-1000/ad.mp4`.

## Install once

```bash
npm i -D ffmpeg-static playwright-core
npx playwright install chromium      # or point --chrome at a Chrome you have
```

`ffmpeg-static` is a dev dependency on purpose — it is an 80 MB binary and the
site's deploy does not need it. If you already have ffmpeg, skip it and set
`FFMPEG_PATH=/usr/bin/ffmpeg`.

## What it does, in order

| step | file | what it produces |
|---|---|---|
| 1 | `sfx.mjs` | click, tap, whoosh, notify, riser, impact, bed — generated |
| 2 | `record.mjs` | `raw.webm` + `beats.json` + `order.json` |
| 3 | `email.mjs` | `email.html` — the real delivery mail, code masked |
| 4 | `cards.mjs` | `price.png`, `endcard.png` in the shop's own fonts |
| 5 | `compose.mjs` | `ad.mp4` |

`make-ad.mjs` runs all of them and stops at the first failure. Each is also
runnable on its own when you want to re-cut without re-buying.

## The twelve beats

The recorder marks the frame where each one actually happened, and the edit cuts
on those marks — so a slow page makes a slower cut, not a cut in the wrong place.

1. open the site · 2. browse · 3. pick a product · 4. product page ·
5. buy · 6. checkout · 7. the purchase completes · 8. order confirmation ·
9-11. the delivery email, opened, with the order in it · 12. end card

## Eight creative variants from one recording

One real purchase, cut eight ways — not eight purchases (which would also trip
the shop's order limiter).

```bash
DATABASE_URL=…  node scripts/ad/make-ad.mjs \
  --base=https://forgemarket.nl --sku=ROBUX-1000 \
  --email=ads@yourdomain --variants=all
```

| | variant | leads on | needs |
|---|---|---|---|
| **A** | Price hook | the number, then buys at it | a price |
| **B** | Speed / delivery hook | how fast it lands | a completed order |
| **C** | Product showcase | the product itself | a price |
| **D** | Problem → solution | the annoyance, then the fix | a price |
| **E** | Website purchase demo | the whole flow, start to finish | a completed order |
| **F** | Customer proof | a real published review | a verified review |
| **G** | Restock / limited | a real low-stock count | `stockLeft` ≤ 6 |
| **H** | Mystery box reveal | the box, then the prize | a real rolled prize |

`--variant=A` builds one; `--variants=A,B,E` builds a few; `--variants=all`
walks the set.

### A variant that cannot tell the truth skips itself

Each declares what has to be **real** before it may be made. No published
review? F skips. Plenty of stock? G skips — the storefront only ever publishes
a count of six or fewer, so anything else would be a scarcity claim the shop
itself refuses to make. Not a mystery box? H skips.

```
⏭  F Customer proof: skipped — no published verified review to quote.
⏭  G Restock / limited availability: skipped — no real value for {stockLeft}.
```

The run carries on; one product without a review should not cost you the other
seven adverts. Exit code 2 means *honestly skipped*, not broken.

Captions are templates: `{price}`, `{name}`, `{delivery}`, `{orderNumber}`,
`{stockLeft}`, `{reviewBody}`, `{prize}` and so on. **A token with no real value
drops its whole line** rather than rendering a gap or a guess.

`{delivery}` is the shop's own promise for that product — "Sent the moment your
payment clears" only when it auto-delivers *and* a code is on the shelf;
otherwise "Bought in for you, delivered by hand". No advert ever says instant
about a product that is not.

### W — the workflow cut

Product → Checkout → Payment → Email delivery → Success, and nothing else. No
shop front, no browsing: every second goes on the five steps between wanting the
thing and having it.

```bash
node scripts/ad/storyboard.mjs --variant=W          # the exact timing
DATABASE_URL=…  node scripts/ad/make-ad.mjs \
  --base=https://forgemarket.nl --sku=ROBUX-4500 \
  --email=ads@yourdomain --variant=W
```

It carries its own pacing rather than the shared speeds. On the defaults it
opened on a four-second product shot and did not reach its first flash until
then — a "fast" advert whose first four seconds hold still. The mechanics now
run at 2.4–3.4× and land at roughly two seconds each; the email is the only
scene played at real time, because the arrival is the payoff.

| effect | where it lives |
|---|---|
| fast zooms | `zoom: 'in' \| 'punch' \| 'drift'` per scene → `zoompan` |
| flash transitions | one white frame pair on every cut, with the whoosh on it |
| motion blur | frames averaged after the speed ramp, in `compose.mjs` |
| cursor tracking | a painted cursor following the real click coordinates, `record.mjs` |
| **email arrival** | the `notify` caption style — see below |

**The email arrival** is the only caption in the toolkit that moves. Every other
one fades; a notification that dissolves into view is not an arrival. The card is
rendered pinned to the top of a transparent full-height frame, and `compose.mjs`
walks the overlay's `y` from off-frame down into place over 0.34s, overshooting
26px and settling back — while the recording underneath lifts 6% brightness for
two tenths, which is the phone-lit flash you get when something really lands. The
notify sound was already timed to that frame.

### The storyboard is generated, never written down

`storyboard.mjs` runs the same resolver `compose.mjs` runs, so its numbers are
the numbers. Scene lengths are not chosen: each is a span between two beats the
recorder marked, given a share of the target by weight and floored at real time —
so the same variant is a different edit on a fast recording than on a slow one,
and any timing typed into a document is wrong the moment the site changes.

With `--in=scripts/ad/out/<slug>` it reads a real `beats.json`. Without one it
uses a reference recording and prints that it is a model rather than a
measurement.

The maths itself lives in `timing.mjs`, called by both. Two copies of a rule is
how this codebase has repeatedly shipped a rule that disagreed with itself.

### Twenty-five brand concepts

`scripts/ad/concepts.mjs` holds twenty-five short-form briefs for TikTok and
YouTube Shorts — five each for Roblox, FC Points, V-Bucks, PlayStation and Xbox.
They use the same scene grammar and the same `needs` gate as the variants above,
so a concept that cannot tell the truth about a product skips itself in exactly
the same way.

```bash
DATABASE_URL=…  node scripts/ad/make-ad.mjs \
  --base=https://forgemarket.nl --concept=R3 --email=ads@yourdomain
```

Each carries the five things a short needs, kept apart on purpose: `hook` (the
first two seconds), `scenes` (the script), `captions` (the burnt-in lines),
`onScreen` (what stays up the whole time — price chip, handle, `#ad`), `cta`
(the end card) and `post` (the caption typed into the app, with tags).

`{perThousand}` is the token this set leans on: what a pack costs per 1,000
units, from the shop's own two numbers. It returns null for anything that is not
a countable pack, so a concept built on it skips a €25 card rather than printing
a per-unit price for one.

`server/test/ad-concepts.test.mjs` checks all twenty-five against the shipped
catalogue on every run — the SKU has to exist, the hook has to fill, and none of
them may claim a rating, a countdown or a relationship with a rights-holder.

### The static creatives are not covered by any of this

`honest-copy.test.mjs` reads `.jsx` and `.html`. It cannot read a PNG, and that
is where four claims the shop cannot back are still shipping: `og.png` says
"delivered instantly", "4.9/5" and "24/7 support"; `banner-welcome.png` says
"INSTANT DELIVERY" and "delivered in seconds"; `banner-support.png` says "24/7";
`banner-vouches.png` shows five stars on a shop with no orders.

`scripts/ad/static-creatives.mjs` writes the words on every shipped raster down
in text, with a `sha` pinning the entry to the bytes it describes, so the test
can read them. The four above are marked `retire` with the reason. **Replacing
that artwork is the outstanding work** — until then the most distributed
advertising this shop has is the least honest part of it.

### Adding a variant

Add an entry to `scripts/ad/variants.mjs`. Nothing else changes:

```js
{
  id: 'I', slug: 'bundle-value', name: 'Bundle value',
  target: 18,
  scenes: [S.browse, S.toProduct, S.product, S.buy, S.confirmed],
  hook: 'Two games, one order',
  captions: [{ at: 'the product', text: '{price}', style: 'big' }],
  needs: ['price'],
}
```

`S` is the shared scene grammar — each entry names the beats it runs between,
how fast it may play and how much of the running time it gets. Caption styles
are `hook`, `big`, `small`, `quote`.

### The mystery box

H needs a **signed-in** recording: a box pays out as store credit, credit needs
an account, and `createOrder` refuses a guest one. The recorder says so before
it starts rather than being turned away at the checkout.

## Payment

`--pay` decides how the money moves. **The fulfilment is real either way** —
real stock, a real code claimed, a real email sent. If the order does not reach
`completed`, the recorder fails instead of producing an advert for a delivery
that did not happen.

| value | what it is |
|---|---|
| `mollie-test` *(default)* | a real checkout round trip through Mollie's sandbox |
| `manual` | it waits while you pay for real |
| `demo` | `DEMO_PAYMENTS` self-pay — dev only, refused when a real provider is configured |

`beats.json` records which was used, and the tooling prints a warning on the
test paths. **Do not caption a test purchase as a live sale.**

## Privacy

Non-negotiable, and handled before anything is written to disk:

- **The delivered code is masked** in the email — `ROBU••••••••••` — because a
  code on a phone screen is a code somebody else redeems. The mask is built from
  the actual `deliveries` rows, so it covers exactly what is secret, plus a
  loose sweep for anything else code-shaped.
- **The buyer address is masked.** Use a throwaway you own; never a customer's.
- The site's own order page never shows a code at all, so the delivery beat is
  safe by construction.

Watch the finished file once before posting. The toolkit protects what it knows
about; you are the one who can see the frame.

## Style

Fast-paced marketplace grammar: hard ramps on the parts that carry no
information, real time on the product and the delivery, a white flash and a
whoosh on every cut, a push-in on the price, motion blur on anything above 2×,
the notification landing with the email.

**None of it is copied from anyone.** Every sound is generated from waveform
maths (`sfx.mjs`), the cards use ForgeMarket's own fonts and gradient, and there
is no third-party logo, creative or music anywhere in the pipeline.

## Making a batch

**Use a different address per advert.** The shop refuses more than eight orders
per 24 hours from one address — its own anti-abuse rule, working correctly —
and a batch of adverts is exactly the shape that trips it. The recorder prints
the refusal verbatim when it happens, so you will not be left guessing:

```
checkout refused (429): That is 8 orders in 24 hours, which is as many as
we take from one address.
```

```bash
for sku in ROBUX-1000 VBUCKS-2800 VAL-1000 COD-5000; do
  DATABASE_URL=…  node scripts/ad/make-ad.mjs \
    --base=https://forgemarket.nl --sku=$sku \
    --email="ads+$sku@yourdomain" || break
done
```

The `+tag` form is one inbox and a different address each time, which is what
the limiter counts. Each SKU writes to its own directory; re-running one
overwrites that one only.

## Options worth knowing

| flag | default | |
|---|---|---|
| `--target=20` | 20 | seconds to aim for; the result lands 15–25 |
| `--slow=120` | 120 | ms between actions — higher reads calmer |
| `--name=` `--price=` | from the product | override the badge text |
| `--cta=` `--tagline=` | forgemarket.nl | end-card copy |
| `--chrome=` | bundled path | a Chrome/Chromium binary |
| `FFMPEG_PATH` | `ffmpeg-static` | your own ffmpeg |

## Measuring which one worked

An advert everybody clicks and nobody buys from and an advert nine people see
and two buy from look identical in a view count. `links.mjs` prints the tagged
destination for each variant, and the shop's admin analytics groups purchases by
the creative id in that link.

```bash
DATABASE_URL=…  node scripts/ad/links.mjs \
  --sku=ROBUX-1000 --variants=all --network=tiktok --campaign=launch-week
```

One line per variant, ready to paste into the destination field:

```
  B  Speed / delivery hook
     creative  robux-1000-b
     https://forgemarket.nl/product/prd_…?utm_source=tiktok&utm_medium=organic
       &utm_campaign=launch-week&utm_content=robux-1000-b&creative_id=robux-1000-b
       &product=ROBUX-1000
```

The creative id is `{sku}-{variant}` — derived, not random, so re-running this
for a re-upload prints the same id and the advert does not split its own numbers
in two.

| flag | | |
|---|---|---|
| `--style=short` | `src` / `cid` / `crid` | for a bio link somebody types by hand |
| `--macros` | `__CID__`, `{creative}` | let the platform fill in its own ids on a paid placement |
| `--network=` | tiktok | also youtube, google, meta |
| `--campaign=` | launch | whatever you are calling this push |
| `--path=/shop` | the product page | a different landing page |

The link points at the product page, not the homepage: the advert has just spent
fifteen seconds on one product, and every step between the click and that
product is a step some viewers do not take. The product id is looked up from the
database, so `--sku` that does not exist refuses to print a link rather than
printing one that 404s.

On a paid placement prefer `--macros`: TikTok substitutes `__CID__` and Google
substitutes `{creative}` at click time, so the report follows the platform's own
splits. A macro that never expands is discarded server-side rather than stored,
so a misconfigured placement loses its attribution instead of inventing a
creative that outsells every real one.

### What the report shows

Admin → Analytics → **Advertising**: visits, product views, checkouts,
purchases and revenue per creative, sorted by revenue. Sorted by revenue on
purpose — a creative with four hundred visits and no sales belongs below one
with nine visits and two sales.

Three things it will not do:

- **It does not report ad clicks.** The click happens on TikTok's servers. What
  this measures is the arrival it produced, and calling those clicks would
  silently absorb every click that never finished loading the page.
- **It shows "—", not 0%, for a creative with no visits.** An advert nobody has
  seen does not have a conversion rate.
- **It counts visitors who refused marketing storage, and says so.** They cannot
  be followed to a purchase, so they sit in the visit column and are reported
  separately rather than quietly dropped or quietly folded in.

No IP, user agent, fingerprint or platform click id is stored. `ttclid` and
`gclid` are read for the network name and the value is discarded before anything
is written.

## Before launch

The site refuses to sell before `LAUNCH_DATE` when the gate is on. Recording
against production while the gate is closed will fail at the checkout — which is
correct. Record against a staging deploy, or after the shop opens.

## Output

H.264 high profile, CRF 19, 30 fps, `+faststart`, AAC 192 kbps 48 kHz stereo,
1080×1920. Accepted as-is by TikTok, YouTube Shorts and Instagram Reels; all
three re-encode, which is why the audio is dry and the cuts are hard.
