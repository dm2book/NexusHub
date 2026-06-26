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
];
