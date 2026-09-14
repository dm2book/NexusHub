# ForgeMarket — Platform Architecture

ForgeMarket is a production-oriented marketplace platform for digital goods. This
document describes the systems added in this change: authentication, order
management, the admin order dashboard, the supplier integration layer, automated
fulfillment, the email system, the customer dashboard, analytics, and security.

There is **no mock data** — every screen reads from live database state populated
through real flows (signup, checkout, supplier sync, fulfillment).

```
┌──────────────────────────────┐        ┌──────────────────────────────────────┐
│  React SPA (Vite + Tailwind) │  HTTPS │  Express API                           │
│  src/   (static on Vercel)   │ ─────▶ │  routes → middleware → services → DB   │
│  - storefront                │  JWT   │  Runs as a Vercel serverless function  │
│  - customer dashboard        │ +cookie│  (api/index.js → server/src/app.js)│
│  - admin console             │ ◀───── │  or standalone (server/src/index.js)   │
└──────────────────────────────┘        └──────────────────────────────────────┘
                                              │            │             │
                                       Supplier connectors │      SMTP / email log
                                       (API / CSV / Manual) │      PostgreSQL
```

Single-deploy on Vercel: SPA served statically; `/api/*` routed to one function.
The data-access layer (`server/src/db/index.js`) is async and isolated, so the
same code runs standalone on any Node host. On serverless cold start the app
lazily runs migrations + seed once (`ensureReady`).

## Tech stack

| Layer     | Choice                                  | Why |
|-----------|-----------------------------------------|-----|
| Frontend  | React 18, React Router, Tailwind, Vite  | Already scaffolded; fast, componentized |
| Backend   | Node 18+, Express (serverless or standalone) | Ubiquitous; one app, two entrypoints |
| Database  | PostgreSQL via `pg`                     | Serverless-friendly; isolated behind `db/index.js` (an `@name`→`$n` translator keeps SQL portable; AsyncLocalStorage powers transactions) |
| Auth      | Passwordless OTP + OAuth, JWT + sessions| No passwords to leak; stateless access tokens, revocable refresh sessions |
| Email     | Nodemailer (SMTP) with DB fallback      | Real delivery in prod; recorded to `email_log` otherwise |

---

## 1. Authentication

Passwordless by design. Files: `services/authService.js`, `services/oauthService.js`,
`routes/auth.js`, `middleware/auth.js`.

- **Email OTP** — `POST /api/auth/otp/request` emails a hashed 6-digit code
  (`otp_codes`), `POST /api/auth/otp/verify` exchanges it for a session. Rate-limited
  and attempt-capped.
- **Google / Discord OAuth** — Authorization-Code flow (`/api/auth/oauth/:provider/start`
  → provider → `/callback`). Providers are declarative config in `oauthService.js`;
  adding GitHub/Apple is a config entry, not new control flow. Disabled providers are
  hidden in the UI automatically.
- **Sessions** — short-lived access JWT (carries `sub`, `perms`) + a server-side
  refresh session (`sessions`, hashed, revocable, theft-detecting). The SPA refreshes
  transparently on 401.
- On first login an account is created and the **Account Created** email is sent.

Customer-facing surfaces (all under the dashboard): **dashboard, order history, saved
billing details, notifications, profile settings** — see §7.

## 2. Order management

Files: `services/orderService.js`, `routes/catalog.js`.

State machine with validated transitions and an immutable timeline
(`order_status_history`) that powers **real-time tracking**:

```
pending → payment_received → processing → awaiting_fulfillment
        → completed | refunded | cancelled
```

Every transition appends history, sends the matching branded email, and pushes an
in-app notification. Orders carry a fraud score (§9). Customers track status live via
`GET /api/account/orders/:id/track` (polled) and publicly via `GET /api/track/:number`.

## 3. Admin order dashboard

Files: `routes/admin/orders.js`, `src/pages/admin/Orders.jsx` + `OrderDetail.jsx`.

Table columns: **Order ID, Customer, Product, Amount, Date, Status** with filters and
search. Row actions: **View, Fulfill, Mark Complete, Refund, Contact Customer** (each
guarded by a permission). The detail page features a large **“Complete Order”** button
with a **confirmation modal**. All actions are audit-logged.

## 4. Supplier integration layer

Files: `services/supplier/*`.

A connector abstraction (`SupplierConnector`) with three implementations —
**`ApiConnector`, `CsvConnector`, `ManualConnector`** — selected at runtime by a
registry (`registry.js`) from a supplier's `connector_kind`. **No supplier is
hardcoded**; suppliers live in the `suppliers` table with a JSON `config` (endpoints,
field maps, CSV columns, auth). `supplierService.js` provides CRUD, product mapping,
and **inventory / price / status / full** syncs, each recorded in `supplier_sync_runs`.
New integration styles = one subclass + `registerConnector(...)`.

**Catalogue search** (`SupplierConnector.searchCatalog`, `GET /api/admin/suppliers/:id/search`)
backs the Map-products picker. Mapping used to ask for a supplier SKU — for
Kinguin a numeric `kinguinId` — that could not be looked up anywhere in the
admin, so the only way to fill it was to hunt on the supplier's website and
retype a number once per product. Choosing a product now searches for it
automatically and one click fills the SKU and the cost.

The base class filters `fetchCatalog()`; Kinguin overrides it with a real
server-side `?name=` query, and the payload says which of the two happened.
`searchTermsFor()` handles the mismatch that made this useless at first: the shop
writes "1,000 Robux" and the supplier lists "1000 Robux", so the separator is
normalised and shorter fallback terms are tried in order. Every result carries
the margin it would leave and `wouldRefuseAutoBuy` — the same condition
`fulfillmentService` refuses on, which is silent at order time, so it has to be
loud while choosing.

**Catalogue scan** (`catalogScanService.js`, `POST /api/admin/suppliers/:id/scan`)
asks the picker's question for every active product at once and answers the one
number that decides whether a launch date is real: how much of the catalogue can
be auto-delivered, profitably. Batched by the client (ten at a time, sequential
inside a batch) because two hundred calls to someone else's API is minutes of
wall clock on a platform that kills a function at its max duration — and a
request that dies at 90% leaves the owner with nothing.

"Best" is not the top hit: it is the cheapest listing that is in stock **and**
below the sell price, because `fulfillmentService` refuses to auto-buy at or
above it, silently. When nothing qualifies the nearest candidate is still
returned with a verdict saying why — `below_cost`, `out_of_stock`, `not_found`,
`no_price` — since "the Roblox card costs €14.80 against your €9.99" is a
different problem from "they do not carry it".

It **proposes and never maps.** Matching is by name, and a bulk table of green
ticks is exactly what gets accepted wholesale, so every row carries the
supplier's own title, SKU and region and mapping is a click per row.

**Supply dashboard** (`supplierDashboardService.js`, `GET /api/admin/suppliers/dashboard`)
answers the product-shaped question the supplier-shaped metrics could not: per
product the supplier, cost, code stock, supplier stock and last sync; per supplier
the product count, stock value and average cost. Three separate things are called
"stock" in this schema and it keeps them apart — `product_codes` (the shelf
auto-delivery claims from), `supplier_products.available_stock` (what the supplier
last reported, `null` = unknown) and `products.stock` (enforced by nothing, sold
from by nothing). Unknown is never rendered as zero, stock value is summed only
over mappings that have both a cost and a count with the coverage stated beside
it, and warnings are grouped rather than emitted one per product.

The cost rule itself lives once, in `services/costService.js`: `pickCostMapping()`
(active supplier, cost present, lowest priority, then most recently synced) with
`costCentsForMany()` doing the whole catalogue in two queries and `costCentsFor()`
delegating to it, so there is no fast reader and slow reader to drift apart.

### Where market credentials come from

`credentialsFor()` reads the **supplier row first, the environment second — for
every marketplace**. It used to do that for Eldorado and G2A while reading only
the environment for Kinguin and Eneba, with a comment above it promising all
four. The consequence was concrete: an owner adds a Kinguin key through
Suppliers, the connector buys with it, and Market keeps reporting "no Kinguin
Integration API key" — the same key, one table away, invisible to the half of the
system that could use it. Nothing about the price source was missing; it simply
never received credentials.

A row only wins when it carries something, so an empty supplier config cannot
mask a working environment key, and paused suppliers are excluded — a key the
owner switched off is not a permission. Having the key is still not the same as
switching the source on: a source runs only when its key is listed in
`MARKET_SOURCES`, because using somebody's API is an agreement, not a discovery.

## 4a. The review ask

Files: `services/orderService.js` (`reviewAskHtml`), `services/emailCopy.js`,
migration `038_delivery_mail_review_ask`.

The delivery mail — the highest open rate this shop has, and the only moment the
buyer is holding what they paid for — now carries a one-block Trustpilot ask,
localised in all four languages and pointing at the write form rather than the
profile page. It renders as an empty string until `TRUSTPILOT_URL` is set, like
every other optional block.

The part worth remembering: **email templates live in the database**, seeded once
and admin-editable after. Editing `defaultTemplates.js` reaches new installs and
nothing else, so a change there alone is a change that passes its tests and never
appears in a real email. The migration is what reaches a running shop; it is
anchored on the support line's style attribute (byte-identical across languages
while the prose is not), guarded by `NOT LIKE '%reviewAskHtml%'` so it is
idempotent, and it silently does nothing to a body an admin has rewritten.

## 4b. Launch command centre

Files: `services/launchCenterService.js`, `GET /api/admin/launch-center`,
`src/pages/admin/Live.jsx`.

Eleven figures about right now in one snapshot: revenue, profit and orders
today, orders awaiting payment, chargebacks, refunds, failed deliveries, low
stock, new and returning customers, and adverts delivering traffic.

**Awaiting payment** is the daily job in a shop that takes bank transfers, and
nothing counted it: the sidebar badge counts payment *proofs* a buyer submitted,
the orders badge counts what is already paid and waiting to be delivered, and an
order sitting in `pending` with no proof appeared in neither. Two numbers rather
than one — the total is `ifAllPaidCents`, never "revenue", because an abandoned
checkout is indistinguishable from an unmatched transfer from here, while
`proofsWaiting` is the subset somebody has actually claimed to have paid.

**"Realtime" here means polling that admits its age.** This shop is one
serverless function, where a held-open SSE stream is billed by the second and
killed at the function's max duration — it would drop on a timer and leave a
frozen number looking live. So the endpoint is cheap (nine grouped queries, no
per-product round trips, `Cache-Control: no-store`), the payload carries
`generatedAt` and `tookMs`, and the page renders "Updated 4s ago" rather than
the word *live*. Polling stops while the tab is hidden and refreshes on return.

Two rules the numbers depend on. **New + returning must partition the day's
buyers exactly**, so both halves come from one query, and a buyer is an *email*
— most orders here are guest checkouts with `user_id` NULL. **A refund and a
chargeback are opposite facts** about the same money and are never summed. Low
stock reuses `stockTierFor` and excludes products sourced live from a supplier,
which are supposed to hold no codes.

## 4c. The background sweep, judged on evidence

Files: `services/maintenanceService.js` (`lastMaintenanceRun`), `diagnosticsService.js`,
`launchCheckService.js`.

Everything the shop does on its own happens in the hourly sweep: paid orders
swept for delivery, the supplier queue drained so a purchase has its key
collected, failed emails retried, reminders and review requests sent, IP
addresses forgotten for the GDPR. All fire-and-forget, all silent when it stops.

It was reported as **configuration** — `status: 'open'` when `CRON_SECRET` was
unset, with a note about locking the endpoint. Both halves were wrong. Without
that secret the endpoint in production does not stand open, it **refuses
everything**, Vercel's own cron included, because Vercel only sends the
`Authorization` header when the secret exists (verified live: `GET
/api/cron/maintenance` → 403). The shop survives on a fallback that piggybacks
on live traffic — so a quiet shop simply goes without, and every dashboard still
reads green.

The sweep now records that it finished (`kv.maintenance_last_run`, written last
and best-effort so bookkeeping can never break the work it records), and the
checks read that: health reports `never_run` / `running` / `stale` with the
timestamp, and the launch report fails on a sweep that has never run or has
stopped, warns when it runs only because traffic happened to trigger it, and
names the steps that threw.

## 5. Automated fulfillment

Files: `services/fulfillmentService.js`, `routes/admin/fulfillment.js`.

`fulfillOrder()` advances the order to `awaiting_fulfillment`, then per item:

- **Integration available** → create a `fulfillment_requests` row, dispatch to the
  connector, receive the result, store `deliveries`, and **auto-complete** the order
  when all items are fulfilled.
- **No integration** → open a **manual** request that appears in the Fulfillment queue
  for a Fulfillment Manager to deliver.

**Every fulfillment action is logged** to `fulfillment_logs` (created / dispatched /
result / retried / manual_note / error / order_completed).

## 6. Email system

Files: `services/emailService.js`, `services/templateService.js`,
`services/defaultTemplates.js`, `routes/admin/emails.js`.

Branded, responsive layout wraps admin-editable templates. Events: **Account Created,
Order Received, Payment Confirmed, Order Processing, Order Completed, Refund Issued**
(plus the login code). Custom branded sender (`EMAIL_FROM_*`, brand color, logo). Admins
edit subject/body, **preview**, and **send tests**. Without SMTP, mail is rendered and
recorded in `email_log` (never dropped).

## 7. Customer dashboard

Files: `routes/account.js`, `src/pages/account/*`.

Surfaces: **Orders, Purchases, Downloads, Digital Deliveries, Support Tickets**.
Customers can **open a ticket, request a refund, download invoices**, reveal digital
deliveries, manage billing details, notifications, and profile/notification settings.

## 8. Analytics

Files: `services/analyticsService.js`, `routes/admin/analytics.js`,
`src/pages/admin/Analytics.jsx`.

Computed from live orders: **Revenue, Orders, Conversion Rate, Top Products, Customer
Lifetime Value** (+ AOV, revenue time-series, status breakdown).

## 9. Security

- **Audit logs** (`audit_logs`, `auditService.js`) — append-only trail of privileged
  actions, viewable in the admin Security tab.
- **Fraud detection** (`fraudService.js`) — explainable weighted rules score each order
  to `ok | review | block`; signals persisted to `fraud_signals`.
- **Rate limiting** (`middleware/rateLimit.js`) — sliding-window limiter, per-route
  overrides, breaches persisted.
- **Role permissions** (`middleware/rbac.js`, seeded in `db/seed.js`) — roles
  **Owner, Admin, Support, Fulfillment Manager** (+ Customer) mapped to granular
  permissions; Owner is implicit superuser.

---

## Database tables

`users`, `oauth_accounts`, `otp_codes`, `sessions`, `roles`, `permissions`,
`role_permissions`, `user_roles`, `products`, `suppliers`, `supplier_products`,
`supplier_sync_runs`, `orders`, `order_items`, `order_status_history`,
`billing_details`, `fulfillment_requests`, `fulfillment_logs`, `deliveries`,
`email_templates`, `email_log`, `notifications`, `support_tickets`, `ticket_messages`,
`refund_requests`, `audit_logs`, `fraud_signals`, `rate_limit_hits`.

Schema: `server/src/db/migrations.js` (embedded so it bundles on serverless).
Money is stored as BIGINT minor units; timestamps are ISO-8601 UTC TEXT.

## API surface (selected)

```
POST   /api/auth/otp/request | otp/verify | refresh | logout
GET    /api/auth/providers | oauth/:p/start | oauth/:p/callback | me
GET    /api/products            POST /api/orders            GET /api/track/:number
GET    /api/account/dashboard | orders | orders/:id | orders/:id/track
       downloads | deliveries/:id | orders/:id/invoice
POST   /api/account/orders/:id/refund-request | tickets | billing
PATCH  /api/account/profile | preferences
ADMIN  /api/admin/orders[/:id/{payment-received,fulfill,complete,refund,cancel,contact}]
       /api/admin/suppliers[/:id/{test,sync,products}]
       /api/admin/fulfillment/{queue,:id/complete,:id/refresh}
       /api/admin/emails[/:id/{preview,test}]
       /api/admin/analytics/{overview,top-products,clv}
       /api/admin/security/{audit,fraud,users,roles}
```

## Running locally

```bash
# API (needs a local Postgres; point DATABASE_URL at it in server/.env)
cd server && cp .env.example .env && npm install && npm run setup && npm start
# (optional) make yourself an owner after first login:
node src/db/seed.js grant you@example.com owner

# Storefront (separate terminal, from repo root)
npm install && npm run dev      # proxies /api → :4000
```

Deploying everything on Vercel (one project, Postgres) is covered in
`DEPLOY_INSTRUCTIONS.md`.

See `DEPLOY_INSTRUCTIONS.md` for production deployment.
