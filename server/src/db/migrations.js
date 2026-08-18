/**
 * Schema migrations, embedded as JS so they bundle reliably in every runtime
 * (local, containers, and Vercel serverless — where reading stray .sql files via
 * fs is unreliable). Forward-only: append new entries; never edit applied ones.
 *
 * Target: PostgreSQL. Timestamps are ISO-8601 UTC TEXT; money is BIGINT minor
 * units (cents); booleans are stored as INTEGER 0/1.
 */
export const MIGRATIONS = [
  {
    id: '001_init',
    sql: `
-- ── IDENTITY & ACCESS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  display_name    TEXT,
  avatar_url      TEXT,
  preferences     TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_login_at   TEXT
);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  provider_uid    TEXT NOT NULL,
  email           TEXT,
  raw_profile     TEXT,
  created_at      TEXT NOT NULL,
  UNIQUE (provider, provider_uid)
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL,
  code_hash       TEXT NOT NULL,
  purpose         TEXT NOT NULL DEFAULT 'login',
  attempts        INTEGER NOT NULL DEFAULT 0,
  consumed_at     TEXT,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash    TEXT NOT NULL,
  user_agent      TEXT,
  ip              TEXT,
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS roles (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  rank            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS permissions (
  id              TEXT PRIMARY KEY,
  description     TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id         TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id   TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id         TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by      TEXT REFERENCES users(id),
  granted_at      TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

-- ── CATALOG & SUPPLIERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  sku             TEXT UNIQUE,
  name            TEXT NOT NULL,
  category        TEXT,
  description     TEXT,
  price           BIGINT NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'EUR',
  kind            TEXT NOT NULL DEFAULT 'digital',
  stock           INTEGER,
  active          INTEGER NOT NULL DEFAULT 1,
  metadata        TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  connector_kind  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  config          TEXT NOT NULL DEFAULT '{}',
  credentials_ref TEXT,
  last_sync_at    TEXT,
  last_sync_status TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_products (
  id                  TEXT PRIMARY KEY,
  supplier_id         TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id          TEXT REFERENCES products(id) ON DELETE CASCADE,
  supplier_sku        TEXT NOT NULL,
  cost                BIGINT,
  available_stock     INTEGER,
  supplier_status     TEXT,
  priority            INTEGER NOT NULL DEFAULT 100,
  last_synced_at      TEXT,
  UNIQUE (supplier_id, supplier_sku)
);

CREATE TABLE IF NOT EXISTS supplier_sync_runs (
  id              TEXT PRIMARY KEY,
  supplier_id     TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  sync_type       TEXT NOT NULL,
  status          TEXT NOT NULL,
  items_processed INTEGER NOT NULL DEFAULT 0,
  items_changed   INTEGER NOT NULL DEFAULT 0,
  detail          TEXT,
  started_at      TEXT NOT NULL,
  finished_at     TEXT
);

-- ── ORDERS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,
  number          TEXT NOT NULL UNIQUE,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  email           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  currency        TEXT NOT NULL DEFAULT 'EUR',
  subtotal        BIGINT NOT NULL DEFAULT 0,
  total           BIGINT NOT NULL DEFAULT 0,
  payment_status  TEXT NOT NULL DEFAULT 'unpaid',
  payment_ref     TEXT,
  billing         TEXT NOT NULL DEFAULT '{}',
  fraud_score     INTEGER,
  fraud_status    TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      TEXT REFERENCES products(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  unit_price      BIGINT NOT NULL,
  metadata        TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  changed_by      TEXT,
  reason          TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_status_hist_order ON order_status_history(order_id, created_at);

CREATE TABLE IF NOT EXISTS billing_details (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label           TEXT,
  full_name       TEXT,
  email           TEXT,
  line1           TEXT,
  line2           TEXT,
  city            TEXT,
  postal_code     TEXT,
  country         TEXT,
  vat_number      TEXT,
  is_default      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- ── FULFILLMENT ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fulfillment_requests (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id   TEXT REFERENCES order_items(id) ON DELETE SET NULL,
  supplier_id     TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  mode            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  external_ref    TEXT,
  payload         TEXT,
  result          TEXT,
  assigned_to     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fulfill_order ON fulfillment_requests(order_id);

CREATE TABLE IF NOT EXISTS fulfillment_logs (
  id              TEXT PRIMARY KEY,
  request_id      TEXT REFERENCES fulfillment_requests(id) ON DELETE CASCADE,
  order_id        TEXT REFERENCES orders(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  actor           TEXT,
  detail          TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id   TEXT REFERENCES order_items(id) ON DELETE SET NULL,
  type            TEXT NOT NULL DEFAULT 'code',
  content         TEXT,
  filename        TEXT,
  download_count  INTEGER NOT NULL DEFAULT 0,
  max_downloads   INTEGER,
  expires_at      TEXT,
  created_at      TEXT NOT NULL
);

-- Pre-loaded code stock per product, auto-dispensed when an order is paid.
CREATE TABLE IF NOT EXISTS product_codes (
  id              TEXT PRIMARY KEY,
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'available',
  order_id        TEXT REFERENCES orders(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  used_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_product_codes_avail ON product_codes (product_id, status);

-- ── EMAIL ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body_html       TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  updated_by      TEXT REFERENCES users(id),
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_log (
  id              TEXT PRIMARY KEY,
  template_id     TEXT,
  to_email        TEXT NOT NULL,
  subject         TEXT,
  status          TEXT NOT NULL,
  provider_ref    TEXT,
  error           TEXT,
  context         TEXT,
  created_at      TEXT NOT NULL
);

-- ── NOTIFICATIONS / SUPPORT / DOWNLOADS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  link            TEXT,
  read_at         TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS support_tickets (
  id              TEXT PRIMARY KEY,
  number          TEXT NOT NULL UNIQUE,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  order_id        TEXT REFERENCES orders(id) ON DELETE SET NULL,
  subject         TEXT NOT NULL,
  category        TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  priority        TEXT NOT NULL DEFAULT 'normal',
  assigned_to     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id              TEXT PRIMARY KEY,
  ticket_id       TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_kind     TEXT NOT NULL,
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refund_requests (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason          TEXT,
  amount          BIGINT,
  status          TEXT NOT NULL DEFAULT 'requested',
  decided_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- ── SECURITY ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id              TEXT PRIMARY KEY,
  actor_id        TEXT,
  actor_email     TEXT,
  action          TEXT NOT NULL,
  target_type     TEXT,
  target_id       TEXT,
  ip              TEXT,
  user_agent      TEXT,
  metadata        TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_type, target_id);

CREATE TABLE IF NOT EXISTS fraud_signals (
  id              TEXT PRIMARY KEY,
  order_id        TEXT REFERENCES orders(id) ON DELETE CASCADE,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  score           INTEGER NOT NULL,
  decision        TEXT NOT NULL,
  signals         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  key             TEXT NOT NULL,
  window_start    BIGINT NOT NULL,
  count           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- Public customer reviews/vouches (e.g. ingested from the Discord /vouch command).
CREATE TABLE IF NOT EXISTS reviews (
  id              TEXT PRIMARY KEY,
  author          TEXT NOT NULL,
  avatar_url      TEXT,
  stars           INTEGER NOT NULL DEFAULT 5,
  body            TEXT NOT NULL,
  product         TEXT,
  source          TEXT NOT NULL DEFAULT 'discord',
  external_id     TEXT UNIQUE,
  status          TEXT NOT NULL DEFAULT 'visible',
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_visible ON reviews (status, created_at);
`,
  },
  {
    id: '002_security_phase1',
    sql: `
-- Ensure tables added to 001 after it was first applied also exist on databases
-- that were initialised earlier (forward-only migrations never re-run 001).
CREATE TABLE IF NOT EXISTS product_codes (
  id              TEXT PRIMARY KEY,
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'available',
  order_id        TEXT,
  created_at      TEXT NOT NULL,
  used_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_product_codes_avail ON product_codes (product_id, status);

CREATE TABLE IF NOT EXISTS reviews (
  id              TEXT PRIMARY KEY,
  author          TEXT NOT NULL,
  avatar_url      TEXT,
  stars           INTEGER NOT NULL DEFAULT 5,
  body            TEXT NOT NULL,
  product         TEXT,
  source          TEXT NOT NULL DEFAULT 'discord',
  external_id     TEXT UNIQUE,
  status          TEXT NOT NULL DEFAULT 'visible',
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_visible ON reviews (status, created_at);

-- Refresh-token rotation + per-session device tracking.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used_at TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device       TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rotated_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id, revoked_at);

-- OTP abuse tracking (per-IP attribution + audit of every code request).
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS ip          TEXT;
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS fingerprint TEXT;
CREATE INDEX IF NOT EXISTS idx_otp_email_created ON otp_codes (email, created_at);
CREATE INDEX IF NOT EXISTS idx_otp_ip_created    ON otp_codes (ip, created_at);

-- Coupon redemption ledger (per-user / per-IP abuse prevention + fraud scoring).
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  email           TEXT,
  ip              TEXT,
  fingerprint     TEXT,
  order_id        TEXT REFERENCES orders(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_code  ON coupon_redemptions (code, created_at);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_user  ON coupon_redemptions (user_id, code);
`,
  },
  {
    id: '003_payment_verification',
    sql: `
-- Customer-submitted payment proof + admin verification queue (manual payments).
CREATE TABLE IF NOT EXISTS payment_proofs (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method          TEXT,
  transaction_id  TEXT,
  screenshot_url  TEXT,
  note            TEXT,
  amount          BIGINT,
  status          TEXT NOT NULL DEFAULT 'pending',   -- pending | confirmed | rejected
  fraud_flags     TEXT NOT NULL DEFAULT '[]',
  reviewed_by     TEXT,
  reviewed_at     TEXT,
  reject_reason   TEXT,
  ip              TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_proofs_status ON payment_proofs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_proofs_order  ON payment_proofs (order_id);
CREATE INDEX IF NOT EXISTS idx_payment_proofs_txn    ON payment_proofs (transaction_id);
`,
  },
  {
    id: '004_retention',
    sql: `
-- Affiliate / referral program: one code per user, attributed events per order.
CREATE TABLE IF NOT EXISTS referrals (
  code            TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL,
  UNIQUE (user_id)
);
CREATE TABLE IF NOT EXISTS referral_events (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL,
  referrer_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  referred_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  order_id        TEXT REFERENCES orders(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL DEFAULT 'order',   -- signup | order
  commission      BIGINT NOT NULL DEFAULT 0,       -- cents
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | approved | paid | void
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_referral_events_ref ON referral_events (referrer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_referral_events_code ON referral_events (code);

-- Forge+ membership (and the referral code captured at signup).
ALTER TABLE users ADD COLUMN IF NOT EXISTS membership_tier  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS membership_until TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by      TEXT;
`,
  },
  {
    id: '005_auth_devices',
    sql: `
-- Phone number for SMS OTP login (optional second identifier).
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone          TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone);

-- Trusted "remember this device" tokens → future logins skip OTP.
CREATE TABLE IF NOT EXISTS trusted_devices (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       TEXT,                 -- client fingerprint (x-device-id)
  token_hash      TEXT NOT NULL,        -- sha256 of the httpOnly device secret
  name            TEXT,                 -- editable label, e.g. "Chrome · Windows"
  user_agent      TEXT,
  ip              TEXT,
  last_used_at    TEXT,
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices (user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_dev  ON trusted_devices (device_id);

-- SMS verification codes (phone OTP), kept separate from email otp_codes.
CREATE TABLE IF NOT EXISTS sms_verifications (
  id              TEXT PRIMARY KEY,
  phone           TEXT NOT NULL,
  code_hash       TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  consumed_at     TEXT,
  ip              TEXT,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sms_phone ON sms_verifications (phone, created_at);
CREATE INDEX IF NOT EXISTS idx_sms_ip    ON sms_verifications (ip, created_at);

-- Login history + brute-force tracking (both successful and failed attempts).
CREATE TABLE IF NOT EXISTS login_attempts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  identifier      TEXT,                 -- email or phone entered
  channel         TEXT,                 -- email | sms | trusted_device | oauth
  success         INTEGER NOT NULL DEFAULT 0,
  suspicious      INTEGER NOT NULL DEFAULT 0,
  reason          TEXT,
  ip              TEXT,
  user_agent      TEXT,
  device_id       TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_user ON login_attempts (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_id   ON login_attempts (identifier, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip   ON login_attempts (ip, created_at);
`,
  },
  {
    id: '006_social_proof',
    sql: `
-- Live social-proof feed. One privacy-safe snapshot per delivered order:
-- ONLY a first name + (optional) city are stored — never the email, surname or
-- any other PII. Captured at completion so the public feed is a cheap read and
-- past deliveries can't change retroactively.
CREATE TABLE IF NOT EXISTS social_events (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL DEFAULT 'purchase',  -- purchase
  order_id         TEXT REFERENCES orders(id) ON DELETE CASCADE,
  first_name       TEXT,                 -- privacy-safe display name (first name only)
  city             TEXT,                 -- optional, "from {city}"
  country          TEXT,                 -- optional ISO/name
  product_label    TEXT NOT NULL,        -- e.g. "1,700 Robux"
  category         TEXT,                 -- product category (for the icon)
  delivery_seconds INTEGER,              -- completed_at − created_at
  status           TEXT NOT NULL DEFAULT 'visible',   -- visible | hidden
  pinned           INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL         -- delivery time
);
-- One feed event per order (idempotent re-delivery never double-posts).
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_events_order ON social_events (order_id);
CREATE INDEX IF NOT EXISTS idx_social_events_feed ON social_events (status, pinned, created_at);

-- Tie reviews to a real, completed purchase so we can show a "Verified buyer"
-- badge that actually means something (only set for account-submitted reviews).
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS verified  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS order_id  TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_id   TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS email     TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS city      TEXT;
-- One verified review per order.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_order ON reviews (order_id) WHERE order_id IS NOT NULL;

-- Moderation permission (added here, not just in seed(), so it lands on already-
-- seeded production databases where seed() no longer runs). Granted to owner+admin.
INSERT INTO permissions (id, description) VALUES ('social.moderate', 'Moderate social proof feed & reviews')
  ON CONFLICT(id) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, 'social.moderate' FROM roles r WHERE r.id IN ('owner', 'admin')
  ON CONFLICT DO NOTHING;
`,
  },
  {
    id: '007_wallet',
    sql: `
-- Store credit / wallet. An append-only ledger: the balance is SUM(amount) over
-- a user's rows (amount is positive for credits, negative for debits). Every entry
-- records the running balance for an auditable statement.
CREATE TABLE IF NOT EXISTS credit_transactions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount         BIGINT NOT NULL,            -- cents, signed (+credit / -debit)
  balance_after  BIGINT NOT NULL,            -- running balance after this entry
  type           TEXT NOT NULL,              -- referral | refund | grant | spend | adjustment
  description    TEXT,
  order_id       TEXT REFERENCES orders(id) ON DELETE SET NULL,
  created_by     TEXT,                       -- staff/system actor for grants
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_credit_tx_order ON credit_transactions (order_id);

-- Permission to adjust customer store credit (granted to owner+admin).
INSERT INTO permissions (id, description) VALUES ('wallet.manage', 'Grant or adjust customer store credit')
  ON CONFLICT(id) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, 'wallet.manage' FROM roles r WHERE r.id IN ('owner', 'admin')
  ON CONFLICT DO NOTHING;
`,
  },
  {
    id: '008_wallet_tag',
    sql: `
-- Idempotency marker for one-time credits (e.g. "loyalty:gold") so a given bonus
-- is granted at most once per user.
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS tag TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_tx_user_tag
  ON credit_transactions (user_id, tag) WHERE tag IS NOT NULL;
`,
  },
  {
    id: '009_page_views',
    sql: `
-- Privacy-friendly visitor analytics: anonymous page views keyed by a random
-- client-generated session id. NO IP, no PII — just enough to count real unique
-- visitors and compute a true conversion rate (paid orders ÷ unique visitors).
CREATE TABLE IF NOT EXISTS page_views (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,        -- anonymous visitor id (random, client-side)
  path        TEXT,
  referrer    TEXT,
  user_id     TEXT,                 -- set only if the visitor is signed in
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_page_views_session ON page_views (session_id);
CREATE INDEX IF NOT EXISTS idx_page_views_time    ON page_views (created_at);
`,
  },
  {
    id: '010_monetization',
    sql: `
-- ── Coupons (database-backed, admin-managed) ───────────────────────────────
-- Replaces the env-only COUPONS list. Supports percent or fixed-amount discounts,
-- a minimum spend, total + per-user redemption caps, and a validity window.
CREATE TABLE IF NOT EXISTS coupons (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,          -- stored uppercased
  kind            TEXT NOT NULL DEFAULT 'percent', -- percent | fixed
  value           BIGINT NOT NULL,               -- percent (1-90) or cents off
  min_subtotal    BIGINT NOT NULL DEFAULT 0,     -- cents
  max_redemptions INTEGER,                        -- null = unlimited
  per_user_limit  INTEGER,                        -- null = unlimited
  redeemed_count  INTEGER NOT NULL DEFAULT 0,
  starts_at       TEXT,
  expires_at      TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons (active, code);

-- ── Gift cards ─────────────────────────────────────────────────────────────
-- A code carrying store value; redeeming credits the customer's wallet.
CREATE TABLE IF NOT EXISTS gift_cards (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,          -- stored uppercased
  initial_balance BIGINT NOT NULL,               -- cents
  balance         BIGINT NOT NULL,               -- cents remaining
  currency        TEXT NOT NULL DEFAULT 'EUR',
  status          TEXT NOT NULL DEFAULT 'active', -- active | redeemed | disabled
  note            TEXT,
  recipient_email TEXT,
  issued_by       TEXT,                           -- staff user id
  redeemed_by     TEXT,                           -- customer user id
  redeemed_at     TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gift_cards_status ON gift_cards (status);

-- ── Bundles ────────────────────────────────────────────────────────────────
-- A named set of products that earns a % discount when all are bought together.
CREATE TABLE IF NOT EXISTS bundles (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  product_ids     TEXT NOT NULL DEFAULT '[]',    -- JSON array of product ids
  discount_percent INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bundles_active ON bundles (active);

-- Single permission covering all monetization tooling (granted to owner+admin).
INSERT INTO permissions (id, description) VALUES ('monetization.manage', 'Manage coupons, gift cards & bundles')
  ON CONFLICT(id) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, 'monetization.manage' FROM roles r WHERE r.id IN ('owner', 'admin')
  ON CONFLICT DO NOTHING;
`,
  },
  {
    id: '011_growth_ops',
    sql: `
-- ── Abandoned-payment recovery ──────────────────────────────────────────────
-- One reminder email per unpaid order; stamped so it is never sent twice.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reminder_sent_at TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_pending_reminder
  ON orders (created_at) WHERE status = 'pending' AND reminder_sent_at IS NULL;

-- ── TOTP two-factor authentication (authenticator apps) ─────────────────────
-- pending secret lives until the user confirms a first valid code, then it is
-- promoted to totp_secret + totp_enabled_at (both cleared on disable).
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at TEXT;

-- ── Low-stock alerting ──────────────────────────────────────────────────────
-- When code stock drops under the threshold we post one Discord alert; the
-- stamp prevents repeats and is cleared again on restock.
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_alerted_at TEXT;

-- Seed the abandoned-payment reminder template on existing databases (fresh
-- installs also get it via seed.js). Admin-editable like every other template.
INSERT INTO email_templates (id, name, subject, body_html, enabled, updated_at)
VALUES ('payment_reminder', 'Payment Reminder',
  'Your {{brand.name}} order {{order.number}} is waiting ⏳',
  '<h1>Your order is reserved — complete your payment</h1>' ||
  '<p>Hi {{user.name}}, we noticed you placed order <strong>{{order.number}}</strong> ' ||
  '(total <strong>{{order.total}}</strong>) but we have not received your payment yet. ' ||
  'Your items are still reserved for you.</p>' ||
  '{{order.itemsHtml}}{{order.paymentHtml}}' ||
  '<p><a class="btn" href="{{order.url}}">Complete your order</a></p>' ||
  '<p>Already paid? Then you can ignore this email — payments can take a few minutes ' ||
  'to be confirmed. Questions? Just reply or open a ticket in our Discord.</p>',
  1, '2026-07-02T00:00:00.000Z')
ON CONFLICT (id) DO NOTHING;
`,
  },
  {
    id: '012_forge_coins',
    sql: `
-- ── Forge Coins — a loyalty currency (€10 spent = 1 coin) ────────────────────
-- Append-only ledger; a member's balance is SUM(delta). Positive rows are
-- earned (on paid orders), negative rows are spent in the Forge Shop. The
-- unique index makes earning idempotent per order (retries never double-award).
CREATE TABLE IF NOT EXISTS forge_coin_ledger (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  ref         TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forge_coins_user ON forge_coin_ledger(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_coins_earn_ref
  ON forge_coin_ledger(reason, ref) WHERE ref IS NOT NULL AND delta > 0;
`,
  },
  {
    id: '013_mystery_boxes',
    sql: `
-- ── Mystery boxes — a paid 'giveaway' ───────────────────────────────────────
-- A mystery box is a product with kind='mystery'. Its reward pool lives here;
-- each row is a possible prize with a weight (relative odds) that pays out as
-- store credit. On payment we roll one reward per unit and grant the credit.
CREATE TABLE IF NOT EXISTS mystery_box_rewards (
  id            TEXT PRIMARY KEY,
  box_id        TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  weight        INTEGER NOT NULL DEFAULT 1,
  credit_cents  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mystery_rewards_box ON mystery_box_rewards(box_id);

-- What each buyer actually won (one row per unit), so it can be shown back on
-- the order + kept for audit.
CREATE TABLE IF NOT EXISTS mystery_pulls (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id TEXT,
  box_id        TEXT,
  user_id       TEXT,
  reward_label  TEXT NOT NULL,
  credit_cents  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mystery_pulls_order ON mystery_pulls(order_id);
`,
  },
  {
    id: '014_mystery_reroll',
    sql: `
-- One free reroll per pull (box). Stamped when used so it can't be reused.
ALTER TABLE mystery_pulls ADD COLUMN IF NOT EXISTS rerolled_at TEXT;
`,
  },
  {
    id: '015_drop_calendar',
    sql: `
-- ── Drop calendar — scheduled restocks / launches / sales ───────────────────
CREATE TABLE IF NOT EXISTS drops (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  category    TEXT,
  note        TEXT,
  starts_at   TEXT NOT NULL,
  created_by  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drops_starts ON drops(starts_at);
`,
  },
  {
    id: '016_price_history',
    sql: `
-- ── Price history — a snapshot every time a product's price changes ─────────
CREATE TABLE IF NOT EXISTS price_history (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price       INTEGER NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'EUR',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id, created_at);

-- Seed one baseline point per existing product so the chart isn't empty.
INSERT INTO price_history (id, product_id, price, currency, created_at)
SELECT 'ph_seed_' || id, id, price, currency, created_at FROM products
ON CONFLICT (id) DO NOTHING;
`,
  },
  {
    id: '017_discord_outbox',
    sql: `
-- ── Discord relay outbox ─────────────────────────────────────────────────────
-- When no webhook/bot token is configured on the server, Discord events
-- (sales pings, drops, stock alerts, delivery DMs) are queued here and the
-- community bot pulls them over the signed /api/discord/outbox endpoint —
-- zero Discord secrets needed on the hosting side.
CREATE TABLE IF NOT EXISTS discord_outbox (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  payload       TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  delivered_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_discord_outbox_pending
  ON discord_outbox(created_at) WHERE delivered_at IS NULL;

-- Tiny key/value store (first use: when the bot last polled the outbox).
CREATE TABLE IF NOT EXISTS kv (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
`,
  },
  {
    id: '018_review_requests',
    sql: `
-- ── Post-delivery review request ────────────────────────────────────────────
-- One "how was your order?" email per completed order, sent a while after
-- delivery. Stamped so it is never sent twice (same pattern as reminders).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS review_request_sent_at TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_review_request
  ON orders (updated_at) WHERE status = 'completed' AND review_request_sent_at IS NULL;
`,
  },
  {
    id: '019_forge_shop_items',
    sql: `
-- ── Admin-managed Forge Shop rewards ────────────────────────────────────────
-- Custom discount codes the owner adds; members buy them with Forge Coins and a
-- personal single-use coupon is generated. Sits alongside the built-in rewards.
CREATE TABLE IF NOT EXISTS forge_shop_items (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  blurb        TEXT,
  cost         INTEGER NOT NULL,          -- price in Forge Coins
  coupon_kind  TEXT NOT NULL DEFAULT 'fixed', -- 'fixed' (cents) | 'percent'
  value        INTEGER NOT NULL,          -- cents for fixed, percent for percent
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forge_shop_active ON forge_shop_items (active, created_at);
`,
  },
  {
    id: '020_saved_carts',
    sql: `
-- ── Abandoned-cart recovery ─────────────────────────────────────────────────
-- Signed-in shoppers' carts are mirrored here so they survive devices and power
-- a single "you left items behind" reminder email. reminded_at is stamped when
-- a reminder goes out; a fresh change (updated_at > reminded_at) re-arms it.
CREATE TABLE IF NOT EXISTS saved_carts (
  user_id      TEXT PRIMARY KEY,
  items        TEXT NOT NULL DEFAULT '[]',
  updated_at   TEXT NOT NULL,
  reminded_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_saved_carts_reminder ON saved_carts (updated_at);
`,
  },
  {
    id: '021_supplier_listing_url',
    sql: `
-- The exact supplier listing to buy from (e.g. an Eldorado URL). Passed to the
-- connector at fulfilment time alongside the SKU + quantity.
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS supplier_url TEXT;
`,
  },
  {
    id: '022_order_pay_link',
    sql: `
-- ── Per-order payment link ──────────────────────────────────────────────────
-- Payment is manual: the buyer gets one shared payment link and has to type the
-- amount and the reference themselves, which is where it goes wrong — a wrong
-- cent or a missing reference turns into the owner matching payments by hand.
-- The owner can now drop a payment request with the exact amount already in it
-- (made in seconds in the bank app) onto a single order; the buyer's live status
-- page picks it up without a refresh.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_link TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_link_at TEXT;
`,
  },
  {
    id: '023_withdrawal_consent',
    sql: `
-- ── Proof that the buyer waived the 14-day withdrawal right ─────────────────
-- Digital goods keep that right unless the buyer gave express prior consent to
-- immediate delivery AND acknowledged losing it. The checkout has always shown
-- the checkbox, but it lived only in React state: the payload never carried it,
-- so nothing was ever recorded. In a chargeback or a complaint that leaves the
-- shop with no evidence at all, holding codes that were already spent.
--
-- The exact sentence is stored, not just a flag, because the wording is what
-- was actually agreed to and it will change over time.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS consent_at TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS consent_text TEXT;
`,
  },
  {
    id: '024_outbox_lease',
    sql: `
-- ── Lease Discord events instead of marking them delivered on hand-over ─────
-- delivered_at used to be stamped the moment the bot POLLED, so a failed send,
-- a missing permission or a bot restart lost the event permanently and silently.
-- claimed_at now holds a short lease; delivered_at is only set once the bot
-- acknowledges what it really sent, and an expired lease is offered again.
ALTER TABLE discord_outbox ADD COLUMN IF NOT EXISTS claimed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON discord_outbox (delivered_at, claimed_at, created_at);
`,
  },
  {
    id: '025_psp_payment',
    sql: `
-- ── The PSP payment behind an order ────────────────────────────────────────
-- payment_ref only gets written once money has arrived, which is too late for
-- two things: resuming a checkout the buyer abandoned halfway, and issuing a
-- refund. Both need the payment id from the moment it is created.
--
-- Kept provider-agnostic. A shop that switches PSP must still be able to refund
-- what the previous one took, so the row has to say which API owns the id.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS psp_provider TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS psp_payment_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS psp_status TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS psp_checkout_url TEXT;
-- The webhook arrives with nothing but a payment id.
CREATE INDEX IF NOT EXISTS idx_orders_psp_payment ON orders (psp_payment_id);
`,
  },
  {
    id: '026_fraud_controls',
    sql: `
-- ── Holding a delivery, and the evidence for doing it ──────────────────────
-- The shop already scored every order for fraud and then delivered it anyway:
-- fraud_status was written and never read again. These columns are what turns
-- that score into a decision that actually holds a code back.
--
-- fraud_hold is separate from the order status on purpose. A held order is
-- still a normal paid order — it just has not been handed over yet. Folding it
-- into the state machine would mean inventing a status that every report, email
-- and transition table has to learn, and un-holding it would rewrite history.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fraud_hold INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fraud_hold_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fraud_reviewed_at TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fraud_reviewed_by TEXT;
-- The IP an order was placed from. Scoring needs it (one address ordering under
-- five different emails is the whole signal), and nothing else on the order
-- carried it. Swept by the retention job like every other ip column.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ip TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_ip ON orders (ip, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_email_created ON orders (email, created_at);
-- The review queue is read by "what is waiting", not by order id.
CREATE INDEX IF NOT EXISTS idx_orders_fraud_hold ON orders (fraud_hold, created_at);

-- ── Chargebacks ────────────────────────────────────────────────────────────
-- A chargeback was only ever visible as an order that turned 'refunded', which
-- is indistinguishable from a refund we chose to give. They are opposite facts:
-- one is service, the other is money taken back against our will, and only the
-- second should make the next order from that buyer harder.
--
-- Kept as its own table rather than an order flag because the useful lookups
-- are by email and by IP across ALL orders, including ones since deleted.
CREATE TABLE IF NOT EXISTS chargebacks (
  id              TEXT PRIMARY KEY,
  order_id        TEXT REFERENCES orders(id) ON DELETE SET NULL,
  order_number    TEXT,
  email           TEXT NOT NULL,
  ip              TEXT,
  amount          BIGINT NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'EUR',
  provider        TEXT,
  payment_id      TEXT,
  reason          TEXT,
  source          TEXT NOT NULL DEFAULT 'psp',
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chargebacks_email ON chargebacks (email, created_at);
CREATE INDEX IF NOT EXISTS idx_chargebacks_ip ON chargebacks (ip);
-- One row per payment: the PSP can report the same chargeback more than once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_chargebacks_payment
  ON chargebacks (payment_id) WHERE payment_id IS NOT NULL;
`,
  },
  {
    id: '027_discord_link',
    sql: `
-- ── Connecting a Discord account to a ForgeMarket account ──────────────────
-- Signing in WITH Discord already created this link as a side effect. That only
-- ever worked for people whose Discord email happens to match the address they
-- shop under, and it forced anyone who wanted to connect to log out and back in
-- through Discord. Linking is now its own action, which needs somewhere to
-- remember who started it.
--
-- The intent is stored server-side rather than in a cookie so the callback can
-- never be talked into attaching someone else's Discord account: the state
-- string is the only thing that travels, and it resolves to a user id here.
CREATE TABLE IF NOT EXISTS oauth_link_intents (
  state           TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_link_intents_expiry ON oauth_link_intents (expires_at);

-- When this account's Discord roles were last reconciled. Read by the
-- maintenance sweep to pick the stalest members, so someone who links today and
-- joins the server next week still ends up with the roles they earned.
ALTER TABLE oauth_accounts ADD COLUMN IF NOT EXISTS synced_at TEXT;

-- A vouch posted in Discord carries no site account, so the review role could
-- never be given for one. The bot can now send the author's Discord id along
-- with the review, which is the only thing that ties the two identities
-- together. Optional: reviews without it still work exactly as before.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS discord_uid TEXT;
CREATE INDEX IF NOT EXISTS idx_reviews_discord_uid ON reviews (discord_uid) WHERE discord_uid IS NOT NULL;
`,
  },
  {
    id: '028_hot_path_indexes',
    sql: `
-- Postgres does NOT index a foreign-key column for you, and these two never got
-- one. Every order hydrate reads order_items and deliveries by order_id, and
-- both were sequential scans of the whole table.
--
-- The track page is where it bites: GET /api/track/:number is deliberately
-- uncached, and the page polls it every 5 seconds while an order is in flight.
-- Each poll scanned both tables end to end to return a handful of rows. At a
-- few hundred orders that is invisible; the cost grows with every order ever
-- placed and never comes back down. order_status_history already had its index
-- (idx_status_hist_order) — these two were simply missed.
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_order  ON deliveries (order_id);

-- The same table is aggregated by product for trending, recommendations and the
-- public delivered-count, all of which grouped over a full scan.
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items (product_id);
`,
  },
  {
    id: '029_stock_alert_level',
    sql: `
-- Stock alerts used to be one flag: alerted, or not. That is enough for a single
-- threshold and useless for a ladder of them — an owner told "10 left" would
-- hear nothing further as the product went to 4, and nothing at all when it hit
-- zero and orders started needing hand delivery.
--
-- This column records the LOWEST tier already announced for the current stock
-- cycle. The claim is a conditional UPDATE against it, so concurrent orders
-- crossing the same tier produce exactly one alert, a drop straight past a tier
-- announces the severe one rather than both, and a tier already passed is never
-- repeated. Cleared on restock, which re-arms the whole ladder.
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_alert_level INTEGER;
`,
  },
];
