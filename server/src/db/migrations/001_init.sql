-- ForgeMarket initial schema.
-- All timestamps are ISO-8601 UTC strings. Monetary amounts are stored as
-- integer minor units (cents) to avoid floating-point drift.

-- ─────────────────────────────────────────────────────────────────────────
-- IDENTITY & ACCESS
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  display_name    TEXT,
  avatar_url      TEXT,
  -- Free-form preferences blob (notification toggles, locale, etc.)
  preferences     TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active', -- active | suspended | banned
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_login_at   TEXT
);

-- External identity providers linked to a user (google, discord, ...).
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,          -- google | discord
  provider_uid    TEXT NOT NULL,          -- stable id at the provider
  email           TEXT,
  raw_profile     TEXT,                   -- JSON snapshot of last profile
  created_at      TEXT NOT NULL,
  UNIQUE (provider, provider_uid)
);

-- One-time passcodes for passwordless email login.
CREATE TABLE IF NOT EXISTS otp_codes (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL,
  code_hash       TEXT NOT NULL,          -- SHA-256 of the 6-digit code
  purpose         TEXT NOT NULL DEFAULT 'login',
  attempts        INTEGER NOT NULL DEFAULT 0,
  consumed_at     TEXT,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email, created_at);

-- Long-lived refresh sessions (access tokens are stateless JWTs).
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

-- ── Role-based access control ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id              TEXT PRIMARY KEY,       -- owner | admin | support | fulfillment_manager | customer
  name            TEXT NOT NULL,
  description     TEXT,
  rank            INTEGER NOT NULL DEFAULT 0 -- higher = more privileged
);

CREATE TABLE IF NOT EXISTS permissions (
  id              TEXT PRIMARY KEY,       -- e.g. orders.refund
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

-- ─────────────────────────────────────────────────────────────────────────
-- CATALOG & SUPPLIERS
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  sku             TEXT UNIQUE,
  name            TEXT NOT NULL,
  category        TEXT,
  description     TEXT,
  -- price in minor units; currency ISO code
  price           INTEGER NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'EUR',
  -- digital | physical; drives fulfillment behaviour
  kind            TEXT NOT NULL DEFAULT 'digital',
  stock           INTEGER,                -- null = unlimited / supplier-managed
  active          INTEGER NOT NULL DEFAULT 1,
  metadata        TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Suppliers are fully data-driven. A connector "kind" selects the integration
-- strategy; "config" holds connector-specific settings (endpoints, field maps).
CREATE TABLE IF NOT EXISTS suppliers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  connector_kind  TEXT NOT NULL,          -- api | csv | manual
  status          TEXT NOT NULL DEFAULT 'active', -- active | paused | error
  config          TEXT NOT NULL DEFAULT '{}',     -- JSON, connector-specific
  -- Encrypted/opaque credentials reference (never the raw secret in prod).
  credentials_ref TEXT,
  last_sync_at    TEXT,
  last_sync_status TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Mapping between a supplier's catalog item and our product. A product may be
-- offered by multiple suppliers; priority breaks ties for auto-fulfillment.
CREATE TABLE IF NOT EXISTS supplier_products (
  id                  TEXT PRIMARY KEY,
  supplier_id         TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  -- Nullable: catalog items can be synced before being mapped to a product.
  product_id          TEXT REFERENCES products(id) ON DELETE CASCADE,
  supplier_sku        TEXT NOT NULL,
  cost                INTEGER,            -- supplier cost, minor units
  available_stock     INTEGER,
  supplier_status     TEXT,               -- in_stock | out_of_stock | discontinued
  priority            INTEGER NOT NULL DEFAULT 100,
  last_synced_at      TEXT,
  UNIQUE (supplier_id, supplier_sku)
);

-- Append-only record of every sync run for observability/audit.
CREATE TABLE IF NOT EXISTS supplier_sync_runs (
  id              TEXT PRIMARY KEY,
  supplier_id     TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  sync_type       TEXT NOT NULL,          -- inventory | price | status | full
  status          TEXT NOT NULL,          -- success | partial | error
  items_processed INTEGER NOT NULL DEFAULT 0,
  items_changed   INTEGER NOT NULL DEFAULT 0,
  detail          TEXT,                   -- JSON summary or error message
  started_at      TEXT NOT NULL,
  finished_at     TEXT
);

-- ─────────────────────────────────────────────────────────────────────────
-- ORDERS
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,       -- internal id
  number          TEXT NOT NULL UNIQUE,   -- human-facing order number
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  email           TEXT NOT NULL,          -- snapshot for guest/record
  status          TEXT NOT NULL DEFAULT 'pending',
  -- pending | payment_received | processing | awaiting_fulfillment
  -- | completed | refunded | cancelled
  currency        TEXT NOT NULL DEFAULT 'EUR',
  subtotal        INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL DEFAULT 0,
  payment_status  TEXT NOT NULL DEFAULT 'unpaid', -- unpaid | paid | refunded
  payment_ref     TEXT,
  billing         TEXT NOT NULL DEFAULT '{}',     -- snapshot of billing details
  fraud_score     INTEGER,
  fraud_status    TEXT,                   -- ok | review | blocked
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
  name            TEXT NOT NULL,          -- snapshot
  quantity        INTEGER NOT NULL DEFAULT 1,
  unit_price      INTEGER NOT NULL,       -- minor units, snapshot
  metadata        TEXT NOT NULL DEFAULT '{}'
);

-- Immutable status timeline powering real-time tracking.
CREATE TABLE IF NOT EXISTS order_status_history (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  changed_by      TEXT,                   -- user id, 'system', or supplier id
  reason          TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_status_hist_order ON order_status_history(order_id, created_at);

-- Saved billing details per user (multiple allowed; one default).
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

-- ─────────────────────────────────────────────────────────────────────────
-- FULFILLMENT
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fulfillment_requests (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id   TEXT REFERENCES order_items(id) ON DELETE SET NULL,
  supplier_id     TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  mode            TEXT NOT NULL,          -- auto | manual
  status          TEXT NOT NULL DEFAULT 'pending',
  -- pending | requested | in_progress | fulfilled | failed | cancelled
  external_ref    TEXT,                   -- supplier-side reference
  payload         TEXT,                   -- request payload sent to supplier
  result          TEXT,                   -- result/delivery payload received
  assigned_to     TEXT REFERENCES users(id) ON DELETE SET NULL, -- manual owner
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fulfill_order ON fulfillment_requests(order_id);

-- Every fulfillment action is logged here (requirement: all actions logged).
CREATE TABLE IF NOT EXISTS fulfillment_logs (
  id              TEXT PRIMARY KEY,
  request_id      TEXT REFERENCES fulfillment_requests(id) ON DELETE CASCADE,
  order_id        TEXT REFERENCES orders(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,          -- created | dispatched | result | retried | manual_note | error
  actor           TEXT,                   -- user id / 'system' / supplier id
  detail          TEXT,                   -- JSON
  created_at      TEXT NOT NULL
);

-- Digital deliveries / downloadable assets produced by fulfillment.
CREATE TABLE IF NOT EXISTS deliveries (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id   TEXT REFERENCES order_items(id) ON DELETE SET NULL,
  type            TEXT NOT NULL DEFAULT 'code', -- code | file | license | message
  -- For codes/licenses: the secret value. For files: a storage key/URL.
  content         TEXT,
  filename        TEXT,
  download_count  INTEGER NOT NULL DEFAULT 0,
  max_downloads   INTEGER,
  expires_at      TEXT,
  created_at      TEXT NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────
-- EMAIL
-- ─────────────────────────────────────────────────────────────────────────

-- Admin-customizable templates keyed by event. Subject/html may contain
-- {{handlebars}}-style tokens resolved by the template service.
CREATE TABLE IF NOT EXISTS email_templates (
  id              TEXT PRIMARY KEY,       -- event key, e.g. order_completed
  name            TEXT NOT NULL,
  subject         TEXT NOT NULL,
  -- Body of the content block; wrapped in the branded layout at send time.
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
  status          TEXT NOT NULL,          -- sent | failed | recorded
  provider_ref    TEXT,
  error           TEXT,
  context         TEXT,                   -- JSON of variables used
  created_at      TEXT NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────
-- NOTIFICATIONS / SUPPORT / DOWNLOADS
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,          -- order_update | delivery | system | support
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
  category        TEXT,                   -- general | refund | delivery | billing
  status          TEXT NOT NULL DEFAULT 'open', -- open | pending | resolved | closed
  priority        TEXT NOT NULL DEFAULT 'normal',
  assigned_to     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id              TEXT PRIMARY KEY,
  ticket_id       TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_kind     TEXT NOT NULL,          -- customer | staff | system
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

-- Refund requests raised by customers (distinct from admin-issued refunds).
CREATE TABLE IF NOT EXISTS refund_requests (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason          TEXT,
  amount          INTEGER,
  status          TEXT NOT NULL DEFAULT 'requested', -- requested | approved | rejected | processed
  decided_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────
-- SECURITY
-- ─────────────────────────────────────────────────────────────────────────

-- Tamper-evident audit trail of privileged/security-relevant actions.
CREATE TABLE IF NOT EXISTS audit_logs (
  id              TEXT PRIMARY KEY,
  actor_id        TEXT,                   -- user id or null for system
  actor_email     TEXT,
  action          TEXT NOT NULL,          -- e.g. order.refund, role.grant
  target_type     TEXT,
  target_id       TEXT,
  ip              TEXT,
  user_agent      TEXT,
  metadata        TEXT,                   -- JSON
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_type, target_id);

-- Fraud signals/decisions attached to orders or accounts.
CREATE TABLE IF NOT EXISTS fraud_signals (
  id              TEXT PRIMARY KEY,
  order_id        TEXT REFERENCES orders(id) ON DELETE CASCADE,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  score           INTEGER NOT NULL,
  decision        TEXT NOT NULL,          -- ok | review | block
  signals         TEXT NOT NULL,          -- JSON array of {rule, weight, detail}
  created_at      TEXT NOT NULL
);

-- Persistent counters backing the rate limiter (also enforced in-memory).
CREATE TABLE IF NOT EXISTS rate_limit_hits (
  key             TEXT NOT NULL,          -- bucket key (ip/user + route)
  window_start    INTEGER NOT NULL,       -- epoch ms of window
  count           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
