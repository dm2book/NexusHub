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
];
