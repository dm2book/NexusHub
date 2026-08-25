# ForgeMarket performance toolkit

Three scripts. One serves the site the way Vercel does, one measures it in a
real throttled browser, one compares two measurements without letting noise
look like a result.

```bash
# 1. the site, served like production
node scripts/perf/edge.mjs --port=5000 --api=4000

# 2. measure (one device at a time; results merge into the same file)
node scripts/perf/measure.mjs --base=http://localhost:5000 --runs=3 \
  --profile=mobile  --out=scripts/perf/results/after.json
node scripts/perf/measure.mjs --base=http://localhost:5000 --runs=3 \
  --profile=desktop --out=scripts/perf/results/after.json

# 3. compare
node scripts/perf/compare.mjs scripts/perf/results/before.json \
                              scripts/perf/results/after.json
```

Needs `npm i -D playwright-core` and a Chromium (`--chrome=` or `AD_CHROME`),
the same two the ad toolkit needs.

## Why an edge simulator

`vite preview` measures a server this shop does not use. `vercel.json` decides
which paths reach the API function, which are static files, and what
`Cache-Control` each gets — and an asset served without `immutable` is a
revalidation on every repeat visit. `edge.mjs` reads those rules from
`vercel.json` itself rather than a copy, and compresses like the real edge.

**Compression is not optional in the model.** Measured without it first, and the
numbers were fiction: 457 KB of JavaScript on the wire where Vercel sends about
130. Every conclusion drawn from that would have been about a transfer that
never happens.

## What the numbers mean

| | |
|---|---|
| `srv` | server processing only, over loopback, **no network in it** |
| FCP / LCP / TBT / CLS | real, with every subresource throttled |
| `KB` | what actually crossed the wire, compressed |

`srv` is not TTFB. Chrome's emulated latency does not apply to the document
request of a freshly-attached session — measured, the document came back in 2 ms
while every subresource on the same page paid its 150 ms. Loading a throwaway
page first was tried and does not fix it. So the column is named for what it is,
and a visitor's own round trip has to be added to it. Server processing is
measured properly by `server-timing.mjs`.

Profiles:

- **mobile** — 4× CPU, ~1.6 Mbps / 150 ms RTT (DevTools "Slow 4G")
- **desktop** — 1× CPU, ~10 Mbps / 40 ms. Not "no throttling", which measures
  the machine running the test rather than the site.

## Things the harness refuses to do

- **Report an error state as a fast page.** The API's rate limiter answers 429 in
  microseconds, so a throttled run does not look broken, it looks quick. Found
  the hard way: 160 calls in a row turned every endpoint into a 0 KB 429 and the
  report showed sub-millisecond medians. Any run whose API calls were refused,
  or that rendered under 200 characters, aborts the whole measurement.
- **Call a difference a win when it is inside the noise.** `compare.mjs` prints
  `~` for anything within the run-to-run spread of the runs it came from.
- **Blend a cold load with a warm one.** They are different questions; both are
  recorded, separately.

## Results are written as they go

A full sweep is eighty throttled loads. The file is rewritten after every page,
so an interrupted run still leaves everything it finished — which is what makes
it cheap enough to re-run often.
