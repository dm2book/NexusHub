# Load test plan

Not a benchmark. Requests-per-second measured on one machine tells you nothing
useful about a serverless deployment in front of a managed Postgres — the
numbers below would change completely on Vercel with Neon, and neither number
is the point.

What this is for is the class of bug that only appears when things happen **at
the same time**, and that no unit test will ever produce:

- two buyers paying for the last code in stock
- a payment webhook arriving twice, or arriving while the order is still being
  fulfilled
- a payment that fails and is then retried
- the database slow enough that two requests overlap where they normally would
  not

Those are the failures that cost money rather than latency: a code sold twice,
an order paid and never delivered, stock that leaks away without anyone
noticing. Latency is the least interesting thing measured here.

## Running it

The order ceilings must be **off**, or the run measures the fraud limits rather
than the order path. Those are exercised deliberately in scenario 6 instead.

```bash
createdb forge_load

DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/forge_load \
LIMIT_ORDERS_PER_EMAIL_DAY=0 LIMIT_ORDERS_PER_IP_DAY=0 \
LIMIT_VALUE_PER_EMAIL_DAY=0 LIMIT_MAX_ORDER_VALUE=0 \
RATE_LIMIT_MAX=100000 PORT=4000 \
node server/src/index.js

# in another shell
node server/test/load/loadtest.mjs
```

Exits non-zero if any scenario produces a **blocker**. It is not part of
`run-all.mjs`: it needs a running server and a scratch database, and it takes
minutes rather than seconds. Run it before a drop, and after any change to the
order, stock, payment or webhook path.

Use a **scratch database**. The test creates products, burns stock and cancels
orders; pointing it at anything real is a bad afternoon.

## The scenarios

### 1 & 2 — 50 and 100 concurrent orders

Fired with no stagger, because a real burst is a drop or a video going out, not
a smooth arrival curve. Asserts every accepted order exists exactly once with a
unique number, and reports p50/p95 latency plus anything rejected.

A rejection that is not a deliberate limit is lost revenue, so the test says so
rather than only counting successes.

### 3 — Stock exhaustion

40 buyers, 10 codes, everyone paying at once. This is the one that actually
costs money. It checks:

- **no code reaches two orders.** Two buyers paying for one item is the worst
  outcome in the whole system.
- **no more codes are delivered than existed.**
- **nothing leaks.** A code claimed but never delivered is stock consumed by an
  order nobody received — silent, and it only surfaces as a product that sells
  out early.
- **the 30 who could not be filled are queued for hand delivery**, not left
  paid and invisible.
- **nobody is told their order is complete when it is not.**

### 4 — Payment failures

A declined card must leave the order *payable*: it is recoverable, and failing
it kills a sale that is still alive. Then the retry must settle exactly once —
paying twice must not deliver twice. Finally a cancelled order must stay
cancelled when a late payment arrives.

### 5 — Webhook failures

A PSP retries anything that is not a 2xx and fires again on later changes, so
the same confirmation is delivered five times simultaneously per order. Every
one after the first must be a no-op — in the deliveries *and* in the status
history, because a duplicated `payment_received` means the audit trail says it
happened twice.

Then malformed webhooks — empty body, no id, a path-traversal attempt, a 5KB id
— must be absorbed with a 200. A 5xx would have the PSP retrying for days.

Then 25 concurrent confirmations for *different* orders: the realistic burst
after a drop.

### 6 — What the limits do to a real burst

The opposite question from scenarios 1–5: with the shipped defaults, what
happens to a group arriving at once? Probes the **server** rather than reading
config, because the test runner's own environment is not what is being
exercised — and distinguishes a 429 (the per-minute rate limiter) from a 400
(the daily ceiling), since reporting one as the other sends you to the wrong
setting.

## What is deliberately not covered

- **Cold starts.** The dominant latency on Vercel is a cold function plus a
  sleeping Neon instance, and neither exists locally. This measures the code,
  not the platform.
- **Real Mollie.** Payments are settled through `markPaymentReceived`, the same
  entry point the webhook uses. The Mollie client itself is covered by
  `mollie.test.mjs` against a stubbed API.
- **Sustained load.** Every scenario is a burst. A shop like this does not have
  a steady-state problem; it has a drop-day problem.
- **The frontend.** Covered by `perf-budget.test.mjs` and Lighthouse.

## Findings

Each run prints its own findings with a severity. The current state is in the
pull request that added this; re-run rather than trusting a number written down
somewhere, because the whole point is that these results change when the order
path changes.
