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

## Before launch

The site refuses to sell before `LAUNCH_DATE` when the gate is on. Recording
against production while the gate is closed will fail at the checkout — which is
correct. Record against a staging deploy, or after the shop opens.

## Output

H.264 high profile, CRF 19, 30 fps, `+faststart`, AAC 192 kbps 48 kHz stereo,
1080×1920. Accepted as-is by TikTok, YouTube Shorts and Instagram Reels; all
three re-encode, which is why the audio is dry and the cuts are hard.
