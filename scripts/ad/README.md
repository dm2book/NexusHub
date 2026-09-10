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

## Twelve creative variants from one recording

One real purchase, cut twelve ways — not twelve purchases (which would also
trip the shop's order limiter).

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
| **J** | Klik tot code | the walk from click to code | a completed order |
| **K** | Performance (NL) | cut for a feed, ten seconds | a completed order |
| **L** | Real purchase test (NL) | a clock, running | a delivery in the footage |
| **W** | Workflow | the workflow, beat by beat | a completed order |

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

## The performance cut

`--variant=performance` (K) is the one written for a feed rather than for a
demonstration: hook → product → checkout → payment → email arrival → code → call
to action, in about ten seconds.

    node scripts/ad/make-ad.mjs --base=https://www.forgemarket.nl \
      --sku=STEAM-10 --email=ads@yourdomain --pay=manual --lang=nl \
      --variant=performance

What separates it from the other variants is that its numbers came out of
measuring earlier renders of the same footage, not out of a brief:

| measured on the older cut | what the variant does |
|---|---|
| 0 applications of motion blur — nothing reached the 2.0× threshold | `blurAt: 1.6`, and four scenes force it outright |
| 6% / 9% zooms, invisible at phone size | `zoomScale: 3` — a 27% punch and an 18% push |
| one white flash on every cut, so none read as punctuation | `whipAt: [1, 3, 4]` throws three of them instead |
| a hook that gave only a price | `hookSub` says what the shop sells, above the price |
| −33.6 LUFS | the mix is normalised to −14 |
| 6 of 18 seconds under 1.5 on frame-to-frame motion | 10s target, small weights, high ceilings |

Three knobs are variant-level so the older cuts are untouched: `zoomScale`
scales every push, `blurAt` sets the speed at which frames start being averaged,
and `whipAt` names the cut indices that get a directional smear and the whip
sound instead of a whoosh.

Two beats have a sound of their own, because they are the two the viewer is
waiting for: `confirm: true` on the payment scene and `notify: true` on the
email arrival.

### One thing a demo purchase cannot show

With `--pay=demo` the order is marked paid the instant it is placed, so
`order-placed` and `confirmed` land about twenty milliseconds apart and the
payment beat has no footage of its own — the caption ends up over a page that
already says delivered. With `--pay=manual` there is a real gap and a real
payment screen in it. It is one more reason the demo path is a preview.

## Product-first

`--variant=product-first` (M) is the cut where the product is visually central
from the first frame. Every other cut opens on a **screen recording of a product
page** — a browser, a header, a breadcrumb, a chat bubble, and somewhere inside
all of that, small, the thing being sold. In a feed that is a second spent
working out what you are looking at, and the second is the entire budget.

    node scripts/ad/make-ad.mjs --base=https://www.forgemarket.nl \
      --sku=STEAM-10 --email=ads@yourdomain --pay=manual --lang=nl \
      --variant=product-first

Six moments, each drawn from the product row rather than from a brief:

| | moment | how |
|---|---|---|
| 1 | product zoom-in | the shop's own artwork full-frame, pushing in — the first 1.0s |
| 2 | product card reveal | art and name rising into place over the real page |
| 3 | price reveal | the badge, on the buy click, so it is its own beat |
| 4 | checkout transition | a thrown cut into the checkout |
| 5 | email transition | a thrown cut into the mail landing |
| 6 | code reveal | the code, with a chip saying what the code is **for** |

### The artwork is the shop's

`cards.mjs --image=` takes the path off the product row — the same picture the
buyer sees on the product page. `record.mjs` already writes `product.image` into
`beats.json` and `make-ad.mjs` hands it on, so nothing has to be pointed at it.

A product with no artwork gets **no hero**: the cards are simply not rendered,
compose says so, and the cut opens on the footage instead. Nothing is drawn to
stand in for a picture the shop does not have.

### The hero comes out of the footage budget

It is a still, not a scene — there is no recording of a product card. It is
prepended to the concatenated body and paid for out of the footage, so a
twelve-second cut is still twelve seconds.

Everything timed against the body — the flashes, the whips, the corner tag, the
sound, the stopwatch — accumulates from the footage, and the footage no longer
starts at zero. Each of those was wrong by exactly one hero before it was right,
and the stopwatch mattered most: a clock reading the recording a second early is
the one thing `stopwatch.mjs` exists to prevent.

### Readable on a phone

The hero sets the name at 104px and the price at 128px on a 1080-wide frame —
roughly 6mm and 8mm of glass on a six-inch screen. The measured mistake they
correct is the old price badge at 60px: legible on a laptop, a smudge on a
phone.

Two collisions found by **measuring the rendered overlays** rather than by
reasoning about the CSS:

- the product card ran `y 233 → 1400` while the hook caption sat at `1160`, so
  the card printed straight across the line — in the one cut whose whole point
  is that the product is central. The card carries art and **name** only now
  (the price is the next reveal), which keeps the name on one line and ends the
  card around `990`.
- the hook is bottom-anchored here (`hookStyle: 'big'`), because the two-line
  hook plate sits at 250px from the top and so does the card.

`node scripts/ad/rows.mjs <overlay.png>` prints the first and last row an
overlay actually covers. It is how both were found, and it is the answer to any
overlay that looks wrong: measure it, do not reason about the CSS.

### The opt-in

`hero` and `productCard` are off unless a variant asks. The cards exist for
every recording of a product that has artwork, and switching the overlays on by
default would have quietly redressed twelve variants, ten cuts and seventy-five
concepts that were composed without them.

## Ten cuts of one purchase

`--cuts=all` builds ten adverts from a single recording. Three that differ only
in pace, seven that differ in what they lean on:

    node scripts/ad/make-ad.mjs --sku=STEAM-10 --out=… --cuts=all

| | cut | pace | leans on | ends on |
|---|---|---|---|---|
| **A** | ultra-fast | 8s | the whole flow | "Klaar." |
| **B** | balanced | 10s | the whole flow | "Je code. Klaar." |
| **C** | cinematic | 12s | the whole flow | "Van klik tot code." |
| **D** | price | 10s | the price | "{price}. Meer wordt het niet." |
| **E** | speed | 10s | the delivery | "{deliveryShort}" |
| **F** | product | 10s | the product | "{name}" |
| **G** | checkout | 10s | the checkout | "Geen account. Gewoon je code." |
| **H** | email | 10s | the mail arriving | "In je mail. Klaar." |
| **I** | watch-me-buy | 10s | the buying itself | "Zo koop je het." |
| **J** | clean-premium | 12s | restraint | "Geleverd." |

    --cuts=list       which of the ten this footage supports, render nothing
    --cuts=A,C,J      render those three
    --cuts=all        render all ten

Like `--hooks=`, any `--cuts=` run implies `--reuse`: the recording, the price
badge and the end card are used again and only the edit is redone. Buying
something and filming it costs money and consumes a code; re-cutting costs
nothing.

### They are composed, not written

Ten cuts written out longhand is ten more variant literals, each one a place for
the flow to drift out of step with the other nine. So `scripts/ad/cuts.mjs`
holds two tables and the ten are pairs of them:

```js
{ id: 'G', slug: 'checkout', name: 'Checkout-focused',
  pace: 'balanced', focus: 'checkout', close: 'Geen account. Gewoon je code.' }
```

**PACE** is how fast the edit moves — running time, end-card hold, how hard the
zooms push, when frames are averaged, which cuts are thrown, how hard the flash
lands. The one number that matters is `ceiling`, which scales every scene's
speed *limit*: raising it lets a scene be squeezed, lowering it forces the scene
closer to real time. That single number is the whole difference between
ultra-fast and cinematic; the rest is polish.

**FOCUS** is what the cut leans on — which beats get the weight, which opening
it uses, and which beats speak.

Change how a payment beat should be cut and all ten change together, because
there is one of it.

### Leaning on a beat buys it slack, not just budget

The first version of `focus` only redistributed weight, and on real footage that
moved almost nothing: most scenes already sit at their speed ceiling, because
the ceiling is what stops a six-second wait becoming the whole advert. Measured
on the real recording, the speed cut and the balanced cut both spent 1.6s on the
delivery — doubling the weight of a ceiling-pinned scene changes nothing at all.

A focused scene now gets its ceiling divided by the root of its lean as well, so
it can run closer to real time. Same recording, after:

| beat | balanced | the cut that leans on it |
|---|---|---|
| the product | 1.55s | 2.58s (F) |
| the checkout | 0.72s | 1.43s (G) |
| the delivery | 1.64s | 2.10s (E) |
| the mail arriving | 1.55s | 2.04s (H) |
| the buying | 0.52s | 0.83s (I) |

### What is identical across all ten, on purpose

- **The recording.** One real purchase, filmed once.
- **The beats.** `product → buy → checkout → payment → delivered → email → code`,
  in that order, every time. The skeleton is the shared scene grammar spread,
  not a restatement of it.
- **The honesty gate.** The opening comes out of `hooks.mjs` and every caption
  goes through `fill()`, so a line whose token has no real value removes itself
  here exactly as it does everywhere else. `needs` is *derived* from the opening
  and the captions rather than typed out — a hand-maintained list goes stale the
  first time a line changes, and the failure mode is an advert making a claim
  nothing checked.

Only montage, hook, timing, zooms, transitions, captions and the closing line
differ — which is also the only part of an advert that may differ when the thing
being advertised is one real purchase.

### `--cut=` and `--variant=` are different flags on purpose

A–H and J exist in **both** tables: `variantById('A')` is the 16-second price
hook, `cutById('A')` is the 8-second ultra-fast cut. Merging the lookups would
mean a run asking for one and silently getting the other, which is the quiet
wrong answer this toolkit is built around avoiding. The output filename carries
the family too — `ad-cut-A-ultra-fast.mp4` next to `ad-A-price-hook.mp4`.

### The end card is shared

Each cut brings its own closing caption and its own end-card *hold* (0.9s on the
eight-second cut, 2.0s on the cinematic one), but the card art itself is
rendered once per recording by `cards.mjs`. Ten cuts of one purchase point at
one shop; if you want a different tagline per cut, re-run `cards.mjs` with
`--tagline=` between renders.

## The real-purchase test

`--variant=stopwatch` (L) is the timed cut: *"Ik ga kijken hoe snel ForgeMarket
dit levert."* A clock starts on the first frame and runs until the shop
delivers, and the storyboard is written in seconds rather than in weights:

| | scene | beats |
|---|---|---|
| 0.0–1.5 | hook + product + clock | `product → buy` |
| 1.5–3.5 | selecting | `buy → checkout` |
| 3.5–5.5 | checkout | `checkout → order-placed` |
| 5.5–7.0 | payment confirmation | `order-placed → confirmed` |
| 7.0–9.5 | the mailbox | `confirmed → email-open` |
| 9.5–11.0 | the code | `email-open → end` |
| 11.0–12.0 | the CTA | end card |

The weights **are** those seconds. `resolveTiming` gives each scene
`room × weight / totalWeight`, and with an eleven-second body and weights
summing to eleven that is the brief, scene for scene — so nobody has to
reverse-engineer a timing out of a ratio. The ceilings are set high on purpose:
a ceiling that binds first is a scene sitting at real time while the clock over
it is compressing, and those two disagreeing on screen is the one thing this
variant cannot have.

    node scripts/ad/make-ad.mjs --base=https://www.forgemarket.nl \
      --sku=STEAM-10 --email=ads@yourdomain --pay=manual --lang=nl \
      --variant=stopwatch

### The clock shows the recording's seconds, never the video's

The cut is ramped 2–8× through the parts nobody needs to watch, so twelve
seconds of video can cover most of a minute of a real purchase. Every frame is
therefore mapped back through its own scene's ramp to the moment in the session
it came from, and the badge shows the distance from the first frame to that
moment. A clock counting screen time would claim a thirty-eight-second purchase
took eleven, which is the whole thing this variant exists not to do.

The number jumps as the ramp speeds up. That is the honest artefact of a
compressed recording and it is left visible rather than smoothed away.

### No delivery in the footage, no number on the badge

Three separate refusals, because there are three ways to end up with a figure
that was not measured:

- **No `delivery` beat at all** — the cut is refused before a frame is rendered
  (`compose.mjs` exits 2, and a batch treats that as a skip).
- **The beat exists but this cut skipped over it** — the clock keeps running,
  never freezes, and no total is ever shown. That is not hypothetical: on a
  `--pay=demo` recording the order is marked paid eighteen milliseconds after it
  is placed, the payment scene falls under the floor and is dropped, and a
  delivery inside that hole is in the recording but not in the video.
- **The purchase never completed** — `needs: ['order', 'delivery']` refuses it
  the same way every other variant is refused.

The measured total reaches the captions as the `{measured}` token, which is null
when nothing was measured — so the line that states it removes itself, exactly
like every other fact in this toolkit.

### What the number includes

The badge's own label reads **productpagina → code**, because that is the span
being timed and it is *longer* than the part the shop controls. It can only
understate how fast delivery is, never flatter it. Zero on the clock is the
advert's first frame rather than the `product` beat: the opening scene settles
past the first 350ms (a beat fires when a navigation resolves, not when the page
has painted), and timing from the beat would open the advert on "0,4".

One caveat that no code can fix: `record.mjs` fills the checkout form faster
than a person does. The figure is the real elapsed time of that session, not a
promise about yours — which is why the label names the span and the copy says
"gemeten", never "altijd".

### It wants `--pay=manual`

On a demo purchase there is no payment to time: the order is marked paid the
instant it is placed. The payment scene drops out, and the cut is a preview
anyway (see below). `PAY_TIKKIE` is enough — no card provider needed.

## The first two seconds, per product

The opening line used to belong to the variant, so every advert cut from K
opened with the same sentence whatever it was selling. `scripts/ad/hooks.mjs` is
a catalogue of fifteen openings across the seven kinds instead, and the
generator emits one advert per opening **from a single recording**:

    node scripts/ad/make-ad.mjs --sku=STEAM-10 --out=… --hooks=all

Buying something and filming it is the expensive half of this pipeline — it
costs money, it consumes a code and it trips the shop's own order limiter.
Changing the first two seconds costs nothing, so any `--hooks=` run implies
`--reuse`: the recording, the price badge and the end card in that directory are
used again, and only the opening is re-rendered. Everything after the hook is
identical by construction — a frame sampled at the same timestamp out of five
hooks of one recording has the same checksum in all five.

    --hooks=list          say which openings this footage supports, render nothing
    --hooks=price,speed   render those two
    --hooks=all           render every one that is possible
    --reuse               cut again from the take that is already there

| kind | hooks | leads on |
|---|---|---|
| product-first | `product`, `product-price` | what it is |
| price-first | `price`, `per-thousand` | the number, and the rate per 1.000 |
| speed-first | `speed`, `in-stock` | the shop's own delivery promise for that row |
| problem → solution | `no-account`, `money-back`, `last-few` | the objection first |
| testimonial | `review-stars`, `review-quote` | a published review |
| watch me buy this | `watch-me`, `click-to-code` | the purchase itself |
| countdown / stopwatch | `stopwatch`, `countdown` | the measured gap between money and code |

### A hook may only say what the recording can prove

Each hook declares the tokens it `needs` and a `proves` line naming where the
claim comes from. `fill()` returns null the moment a token has no real value,
and a hook whose line or sub-line comes back null is **dropped** — not softened,
not filled with a plausible number. `--hooks=list` prints the reason:

    🪝 10 of 15 hooks are possible for Steam Wallet €10
       ✓ product         product-first    Steam Wallet €10
       ✓ price           price-first      €11.99
       ✗ per-thousand    price-first      no real value for {perThousand}
       ✗ review-stars    testimonial      no real value for {reviewStars}, …
       ✗ stopwatch       stopwatch        no real value for {deliverySeconds}

That is not caution, it is the state of the data. This shop has no published
reviews, so `review-*` cannot be made; `market_observations` is empty, so no
hook compares a price to anyone else's; `per-thousand` is a rate computed from
the product's own two numbers and is null for anything that is not a countable
pack. Asking for a blocked hook by name fails loudly rather than quietly
handing back a different advert wearing that name (`compose.mjs` exits 2, and a
batch treats that as a skip and carries on).

`deliverySeconds` is the strictest of them. It is measured from the order's own
`payment_received → completed` transitions and is null unless the payment was
**real** and the gap is between one second and ten minutes — a `--pay=demo`
order is marked paid the instant it is placed, so nothing timed against it means
anything, and a sub-second figure reads as a lie even when it is not. The two
stopwatch hooks therefore need a `--pay=manual` recording.

### Adding a hook

Add an entry to `scripts/ad/hooks.mjs`. Nothing else changes — the id names the
output file (`ad-K-performance-<id>.mp4`), and `needs` is the whole gate:

```js
{
  id: 'bundle', type: 'product-first',
  text: '{name} — {price}', sub: 'Code in je mail.',
  needs: ['name', 'price'],
  proves: 'both come off the product row the recording bought',
}
```

Every token the lines render must appear in `needs`; `server/test/ad-hooks.test.mjs`
fails otherwise, and also fails any hook carrying a hard-coded figure.

## The claim gate

Every line of text goes through `scripts/ad/claims.mjs` before it reaches a
frame. A claim is allowed only when the evidence proves it; when the data is
missing it is rewritten to a form that IS provable, or the line is dropped.

    node scripts/ad/claims.mjs                       # what may be claimed, and what proves it
    node scripts/ad/claims.mjs "4.9/5 — 24/7 support"

| claim | proven by |
|---|---|
| a star rating (`4.9/5`, `★★★★★`) | the average of the shop's published reviews — or, for a run of stars, the one review being quoted |
| support around the clock (`24/7`) | a staffed rota, off unless configured |
| instant delivery | the product's own instant flag: auto-delivery **and** a code on the shelf |
| a delivery time (`under 60 seconds`) | a measured delivery — this recording's own gap, or the shop's average |
| a price comparison (`cheapest`, `lowest price`) | `market_observations` — a competitor price actually observed |
| how many people have bought (`thousands of customers`) | the orders table |
| a supplier network | an active supplier the shop actually buys from |

### Why a layer and not another banned-word list

The toolkit already refused to lie in two ways and both share one blind spot.
`fill()` drops a caption whose **token** has no real value, and `blockedReason()`
refuses a variant whose **needs** are unmet — so a line saying `{price}` is safe.
Neither looks at a line containing no tokens at all:

```js
{ at: 'buy', text: '4.9/5 — 24/7 support, instant delivery' }
```

passes both untouched, because there is nothing in it to resolve. The only thing
that ever caught a string like that was `honest-copy.test.mjs` grepping a
**hardcoded list of files** — so a new file was invisible until somebody
remembered it (`cuts.mjs` was, for exactly one round), and `--cta=`,
`--tagline=` and `--name=` were never seen at all, because those arrive on the
command line and go straight onto a card.

This is a gate on the **rendered text**, after the tokens are filled and after
the command line has had its say.

### Neutral, or nothing

Which one it is belongs to the claim, not to a preference:

| written | rendered |
|---|---|
| `24/7 support` | `support` — the hours come off, the sentence stands |
| `Vragen? 24/7 support via Discord.` | `Vragen? support via Discord.` |
| `Instant delivery on every order` | the shop's own delivery sentence for that product |
| `Geleverd in 20 seconden` | the same |
| `4.9/5 from real buyers` | *dropped* — a rating you do not have has no quieter form |
| `The cheapest Robux anywhere` | *dropped* — a comparison with nothing to compare against |
| `Thousands of customers` | *dropped* |

A replacement is checked again before it is used, so the layer cannot swap one
unproven claim for another and call it progress. And nothing is softened into a
vaguer version of the same promise: "instant delivery" does not become "fast
delivery", it becomes the sentence the shop already shows on that product page.

Both are printed. A layer that silently edits an advert is one nobody knows is
there:

    ⚖  claims: 2 rewritten, 1 dropped
       ↻ "24/7 support" → "support"  (support around the clock — not proven)
       ↻ "Geleverd in 20 seconden" → "Verstuurd zodra je betaling binnen is"
       ✗ "De goedkoopste Robux" dropped — a price comparison: market_observations

Card copy is treated differently: `--cta=`, `--tagline=` and `--name=` are
**authored**, so `cards.mjs` stops the run and names what would have proved the
claim, rather than quietly editing something a person typed.

### Absent means not proven

Every default is "not proven", so every bug in this layer fails towards a
quieter advert rather than a bolder one. That is not a slogan — it is the thing
that went wrong first:

> `Number(null)` is `0`, and `0` is not "missing", it is the strongest possible
> evidence. A recording with no measured delivery arrived as "0 seconds" and
> **proved** *"in under 60 seconds"*, because zero is under sixty.

It was found by rendering an advert, not by testing `gatherEvidence()` — the
no-argument case was fine (`Number(undefined)` is `NaN`), which is exactly why a
unit test on the gatherer alone did not see it. There is now a test for every
spelling of absent.

### Where the evidence comes from

`record.mjs` reads `/api/social/stats` off the shop it is filming — computed
from the orders table and the published reviews, and returning nulls until there
are some. A shop that does not serve it simply gets a quieter advert. Today that
endpoint says: 0 completed orders, 0 published reviews, nobody on a rota; and
`market_observations` is empty. Which is why, right now, five of the seven
claims above cannot be made at all.

## Sound design

Seven moments, planned against the resolved edit and then scheduled — so the
sound is timed to the picture by construction rather than by two files agreeing
about seconds.

| moment | sound |
|---|---|
| cursor click | `click` |
| product selection | `select` — a soft note, the answer to the click |
| transition | `whoosh`, or `whip` on a cut the edit throws |
| payment success | `confirm` |
| email arrival | `notify` |
| code reveal | `impact` |
| the call to action | `tail` — half the weight, a full stop rather than a second climax |

    node scripts/ad/sound.mjs                    # the profiles and the moments
    node scripts/ad/make-ad.mjs … --sound=premium
    node scripts/ad/make-ad.mjs … --sounds=all   # four mixes of one video

### Supporting, not irritating, is a rule the code enforces

Two things, both because of what this recording actually does:

- **Nothing may land on top of anything.** A cue within a profile's `minGap` of
  a louder-meaning one is **dropped** — not ducked, because ducked it is still
  smearing the transient it sits on.
- **Clicks are rate-limited.** The checkout fires three inside one second and
  all three is a rattle.

Priority decides who survives, and it is not loudness. A click is the loudest
thing in the checkout and the first to go, because it is texture. Transitions
and throws outrank it — the picture visibly cuts and smears there, and a thrown
cut whose whip got evicted by a chime is a visible throw with no sound. The
three the viewer is waiting for — money clearing, mail landing, code arriving —
never lose one.

### Four mixes of the same seven moments

| profile | | |
|---|---|---|
| `gaming` | bright and punchy, every beat marked | bed 0.34, gap 0.12s, 4 clicks/s |
| `premium` | restrained and low; the interface stops narrating itself | bed 0.22, gap 0.24s, 1 click/s |
| `minimal` | the four moments that carry meaning, silence between them | no bed, gap 0.35s, no clicks |
| `high-energy` | everything, loud, close together | bed 0.42, gap 0.08s, 6 clicks/s |

They are *profiles*, not four adverts: the cue plan is built once and each
profile only decides what survives it, how loud, and at what pitch. None of them
moves a beat.

`--sounds=all` renders the video **once** and copies the stream for the other
three — "the same video with a different sound profile" has to mean the same
video, and re-rendering would give four files differing in the encoder's noise
as well as in the mix. Verified: one video MD5, four audio MD5s.

### The mix is measured, not hoped at

Three defects found by metering the finished files rather than by reading the
filtergraph:

| | measured | after |
|---|---|---|
| `minimal` | **−33.0 LUFS**, peak −24.1 dBFS | −13.5 LUFS, −4.5 dBFS |
| `premium` | peak **+0.2 dBFS** — clipping, with TP set to −1.5 | −0.5 dBFS |
| all four | got *louder* when the limiter was lowered | −13.4 to −13.8 LUFS |

- **loudnorm runs in two passes.** Single-pass estimates as it goes, and a
  twelve-second mix that is mostly silence between transients is exactly where
  the estimate fails. `linear=true` applies one gain, which keeps a sparse mix
  sparse instead of pumping it up out of its own silence.
- **`alimiter` gets `level=disabled`.** It auto-levels its output *up* to the
  limit by default, so it had been quietly undoing loudnorm and delivering
  whatever the limit was — which is why lowering the limit made the files
  louder. Disabled, it only ever reduces.
- **The ceiling is 0.85, not 0.95.** alimiter limits the *sample* peak; every
  platform re-encodes to a lossy codec and that adds inter-sample overshoot on
  top.

## What makes a cut publishable

Two things put text on screen that must never reach a feed, and neither is a
matter of care:

- **Filming against anything but the live shop** bakes that host into the
  delivery email's footer — `© 2026 ForgeMarket — localhost:3000`, legible for
  a second and a half in the finished cut.
- **`--pay=demo`** makes the checkout say `Demomodus: je bestelling wordt direct
  gemarkeerd als betaald`, in Dutch, on camera.

So `record.mjs` writes what the footage IS into `beats.json`, and `compose.mjs`
reads it: anything that is not a live host AND a real payment is named
`preview-…mp4` and carries a marker across every frame. There is no flag to
override it. The person who uploads the file a week later is not the person who
ran the command, and a console warning does not reach them.

### It does not need Mollie

The blocker is a payment path that does not print "demo" — and the shop already
has one that needs no card provider at all. `PAY_TIKKIE`, `PAY_REVOLUT` or
`PAY_PAYPAL` puts a real manual method on the checkout; `commerceBlockers` then
asks for one more thing, a way to email the buyer their code.

    RESEND_API_KEY=…            # or SMTP_URL — needed before launch anyway
    PAY_TIKKIE=https://tikkie.me/pay/…
    DEMO_PAYMENTS=false

    node scripts/ad/make-ad.mjs --base=https://forgemarket.nl \
      --sku=PGO-550 --email=ads@yourdomain --pay=manual --lang=nl \
      --variant=klik-tot-code

`--pay=manual` pauses while you pay the amount yourself, so the purchase in the
advert is a real one — buy the cheapest thing on the shelf and it costs €4.49,
paid to your own account.

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
| `--cuts=` | — | `all`, `list`, or ids — ten cuts of one purchase |
| `--sound=` `--sounds=` | gaming | a mix, or `all` for four of one video |
| `--image=` | from the product | the artwork the hero and cards are drawn from |
| `--hooks=` | — | `all`, `list`, or ids — one advert per opening, from one take |
| `--variant=stopwatch` | — | the timed cut; needs a delivery in the footage |
| `--reuse` | off | cut again from the recording already in `--out` |
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
