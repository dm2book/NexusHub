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
