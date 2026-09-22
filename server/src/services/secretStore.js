/**
 * Every key the shop needs, typed into the admin instead of into a deploy.
 *
 * ── WHY ───────────────────────────────────────────────────────────────────
 * A Stripe key, a Resend key, a Kinguin key: all of them were environment
 * variables, which means the owner sets them in Vercel, redeploys, and hopes.
 * The seller identity already moved for exactly this reason, and the same trap
 * applies harder here — a webhook secret that is set but not deployed produces
 * a shop that takes money and never delivers, with nothing on any screen
 * explaining why.
 *
 * Typed here, a key is live on the next cold start of a serverless instance and
 * immediately in the running one.
 *
 * ── HOW THEY ARE STORED ───────────────────────────────────────────────────
 * Encrypted with AES-256-GCM, under a key derived from JWT_SECRET — which lives
 * in the environment and is therefore NOT in the database. A dump of the
 * database alone does not yield a Stripe key. That is the whole point; it is
 * not a claim that this is a vault.
 *
 * Two consequences, stated plainly rather than discovered later:
 *   · changing JWT_SECRET makes every stored secret unreadable. They are
 *     reported as unreadable rather than as unset, so the owner is told to type
 *     them again instead of wondering why payments stopped.
 *   · a secret is never returned to the browser. The admin sees whether one is
 *     set, where it came from, and its last four characters — enough to tell
 *     two keys apart, not enough to use one.
 *
 * ── AND WHY THE ENVIRONMENT STILL WINS NOTHING ────────────────────────────
 * A stored value overrides the environment, because the admin is the newer,
 * more deliberate action. The environment remains the fallback, so a shop that
 * has always used Vercel variables keeps working untouched.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { all, get, run, nowIso } from '../db/index.js';
import { config } from '../config/env.js';
import { audit } from './auditService.js';

/**
 * Whether the keyring is worth anything.
 *
 * The encryption key is derived from JWT_SECRET, and JWT_SECRET falls back to
 * `dev-only-insecure-secret-change-me` — a string that is IN THIS REPOSITORY.
 * A shop running on that default stores its live Stripe key encrypted under a
 * value anybody can read, which is not encryption; it is the appearance of it,
 * which is worse, because it is the reason somebody would paste a real key in.
 *
 * So it is named. In production a save is refused outright rather than
 * performed badly; everywhere else it is allowed, because a developer typing a
 * fake key into a laptop is not the threat, and loudly reported so nobody
 * mistakes a laptop for a shop.
 */
export const DEV_SECRET_PREFIX = 'dev-only';
export function keyringStrength() {
  const secret = String(config.auth.jwtSecret || '');
  if (!secret || secret.startsWith(DEV_SECRET_PREFIX)) {
    return {
      safe: false,
      reason: 'JWT_SECRET is the built-in default, which is published in this repository. '
        + 'Anything stored here would be encrypted with a key anyone can derive.',
    };
  }
  if (secret.length < 24) {
    return {
      safe: false,
      reason: `JWT_SECRET is only ${secret.length} characters. It is the key everything stored `
        + 'here is encrypted with, so it needs to be long and random.',
    };
  }
  return { safe: true, reason: null };
}

/* One derivation per process. scrypt is deliberately slow; doing it per read
   would put 100ms on every cold start that touches a key. */
let KEY = null;
const key = () => {
  if (!KEY) KEY = scryptSync(String(config.auth.jwtSecret || ''), 'forgemarket.secrets.v1', 32);
  return KEY;
};

function seal(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}

function open(blob) {
  const [v, iv, tag, data] = String(blob || '').split('.');
  if (v !== 'v1' || !iv || !tag || !data) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  } catch {
    /* Wrong key, or a tampered row. Both mean "cannot be used", and neither
       means "empty" — the difference matters to whoever has to fix it. */
    return null;
  }
}

/**
 * What the shop can be given, where each value lands, and what it unlocks.
 *
 * `path` is where it is written into the live config, so a saved key takes
 * effect without a restart. `why` is what stops working without it — the reason
 * the owner is being asked, in the words of the consequence rather than the
 * setting.
 */
export const SECRETS = [
  { id: 'stripe.secretKey', label: 'Stripe secret key', env: 'STRIPE_SECRET_KEY',
    path: ['payments', 'stripe', 'secretKey'], group: 'Payments',
    why: 'Without it the checkout has no card or iDEAL payment to send buyers to.',
    hint: 'Starts with sk_live_ — the test key (sk_test_) takes fake cards and moves no money.' },
  { id: 'stripe.webhookSecret', label: 'Stripe webhook signing secret', env: 'STRIPE_WEBHOOK_SECRET',
    path: ['payments', 'stripe', 'webhookSecret'], group: 'Payments',
    why: 'Without it buyers can pay, the money arrives, and no order is ever marked paid.',
    hint: 'Starts with whsec_ — from the endpoint you add in Stripe → Developers → Webhooks.' },
  { id: 'mollie.apiKey', label: 'Mollie API key', env: 'MOLLIE_API_KEY',
    path: ['payments', 'mollie', 'apiKey'], group: 'Payments',
    why: 'An alternative to Stripe for iDEAL. Only needed if you use Mollie.',
    hint: 'live_… — a test_ key marks orders paid while no money moves.' },
  { id: 'pay.tikkie', label: 'Tikkie payment link', env: 'PAY_TIKKIE',
    path: ['payments', 'manual', 'tikkie'], group: 'Payments', secret: false,
    why: 'A manual fallback: the buyer pays by link and you confirm it by hand.' },
  { id: 'pay.revolut', label: 'Revolut link', env: 'PAY_REVOLUT',
    path: ['payments', 'manual', 'revolut'], group: 'Payments', secret: false,
    why: 'A second manual fallback.' },
  { id: 'pay.paypal', label: 'PayPal link', env: 'PAY_PAYPAL',
    path: ['payments', 'manual', 'paypal'], group: 'Payments', secret: false,
    why: 'A third manual fallback.' },

  { id: 'email.resendApiKey', label: 'Resend API key', env: 'RESEND_API_KEY',
    path: ['email', 'resendApiKey'], group: 'Email',
    why: 'Without it a delivered code is written to a table and never reaches the buyer.',
    hint: 're_… — from resend.com → API Keys.' },

  { id: 'notify.discordWebhookUrl', label: 'Discord alert webhook', env: 'NOTIFY_DISCORD_WEBHOOK_URL',
    path: ['notify', 'discordWebhookUrl'], group: 'Alerts', secret: false,
    why: 'Where a chargeback or a failed delivery reaches you in seconds instead of by email.' },
  { id: 'notify.telegram.botToken', label: 'Telegram bot token', env: 'TELEGRAM_BOT_TOKEN',
    path: ['notify', 'telegram', 'botToken'], group: 'Alerts',
    why: 'An alternative alert channel.' },
  { id: 'notify.telegram.chatId', label: 'Telegram chat id', env: 'TELEGRAM_CHAT_ID',
    path: ['notify', 'telegram', 'chatId'], group: 'Alerts', secret: false,
    why: 'Which chat the Telegram alerts go to.' },

  { id: 'market.kinguin.apiKey', label: 'Kinguin API key', env: 'KINGUIN_API_KEY',
    path: ['market', 'sources', 'kinguin', 'apiKey'], group: 'Suppliers & market',
    why: 'Lets the shop read Kinguin prices, and buy keys automatically for paid orders.' },
  { id: 'market.eneba.apiKey', label: 'Eneba API key', env: 'ENEBA_API_KEY',
    path: ['market', 'sources', 'eneba', 'apiKey'], group: 'Suppliers & market',
    why: 'Lets the shop read Eneba prices. Requires a partner agreement.' },
  { id: 'market.g2a.apiKey', label: 'G2A API key', env: 'G2A_API_KEY',
    path: ['market', 'sources', 'g2a', 'apiKey'], group: 'Suppliers & market',
    why: 'Lets the shop read G2A prices, with the hash and email below.' },
  { id: 'market.g2a.apiHash', label: 'G2A API hash', env: 'G2A_API_HASH',
    path: ['market', 'sources', 'g2a', 'apiHash'], group: 'Suppliers & market',
    why: 'The second half of the G2A credentials.' },
];

const byId = new Map(SECRETS.map((s) => [s.id, s]));

/** The environment's own values, snapshotted before anything is applied. */
const readPath = (obj, path) => path.reduce((o, k) => (o == null ? o : o[k]), obj);
const ENV_BASELINE = Object.freeze(Object.fromEntries(
  SECRETS.map((s) => [s.id, String(readPath(config, s.path) ?? '')])));

/** Stored rows, decrypted. Unreadable ones are reported, never treated as unset. */
export async function storedSecrets() {
  const rows = await all(`SELECT key, value, updated_at FROM app_secrets`).catch(() => []);
  const out = {};
  for (const r of rows) {
    if (!byId.has(r.key)) continue;
    const plain = open(r.value);
    out[r.key] = { value: plain, readable: plain != null, updatedAt: r.updated_at };
  }
  return out;
}

/** One secret's value in force — stored first, then the environment. */
export async function secretValue(id) {
  const stored = await storedSecrets();
  const s = stored[id];
  if (s?.readable && s.value) return s.value;
  return ENV_BASELINE[id] || '';
}

/**
 * Write the stored values into the live config.
 *
 * Same shape as the seller identity: the environment's values first, so a
 * cleared secret falls back rather than keeping what it used to be, then the
 * stored ones on top.
 */
export async function applyStoredSecrets() {
  const stored = await storedSecrets().catch(() => ({}));
  const applied = [];
  for (const s of SECRETS) {
    const held = stored[s.id];
    const value = (held?.readable && held.value) ? held.value : ENV_BASELINE[s.id];
    const parent = s.path.slice(0, -1).reduce((o, k) => (o[k] ??= {}), config);
    parent[s.path[s.path.length - 1]] = value;
    if (held?.readable && held.value) applied.push(s.id);
  }
  return applied;
}

const last4 = (v) => (v && v.length > 4 ? `…${v.slice(-4)}` : (v ? '…' : ''));

/**
 * What the admin is allowed to see: whether each is set, from where, and enough
 * of it to tell two keys apart.
 */
export async function secretStatus() {
  const stored = await storedSecrets();
  const strength = keyringStrength();
  return SECRETS.map((s) => {
    const held = stored[s.id];
    const fromAdmin = !!(held?.readable && held.value);
    const value = fromAdmin ? held.value : ENV_BASELINE[s.id];
    return {
      id: s.id, label: s.label, group: s.group, env: s.env, why: s.why,
      hint: s.hint || null,
      /* A link is not a secret — showing a Tikkie URL in full is how an owner
         checks it is the right one. */
      masked: s.secret === false ? (value || '') : last4(value),
      set: !!value,
      source: fromAdmin ? 'admin' : (ENV_BASELINE[s.id] ? 'environment' : 'unset'),
      unreadable: !!(held && !held.readable),
      updatedAt: held?.updatedAt || null,
      /* Carried per row so the screen can say it beside the box somebody is
         about to paste a live key into, not only in a banner they scrolled
         past. */
      keyringSafe: strength.safe,
      keyringReason: strength.reason,
    };
  });
}

export async function setSecret(id, value, { actor = null } = {}) {
  const spec = byId.get(id);
  if (!spec) { const e = new Error('Unknown setting.'); e.status = 400; throw e; }
  const v = String(value ?? '').trim();
  const at = nowIso();

  /* Refused, not stored badly. A live Stripe key encrypted under a published
     string is a key in plaintext with extra steps, and the owner would have
     every reason to believe otherwise. Clearing is always allowed: taking a
     value out is never the unsafe direction. */
  const strength = keyringStrength();
  if (v && !strength.safe && config.env === 'production') {
    const err = new Error(`${strength.reason} Set a long random JWT_SECRET in your hosting `
      + 'environment first — then save this again.');
    err.status = 400;
    throw err;
  }
  if (v && !strength.safe) {
    console.warn(`[secrets] storing "${id}" under a weak keyring — ${strength.reason}`);
  }

  if (!v) {
    await run(`DELETE FROM app_secrets WHERE key = @k`, { k: id });
  } else {
    if (v.length > 4000) { const e = new Error('That value is too long.'); e.status = 400; throw e; }
    await run(
      `INSERT INTO app_secrets (key, value, updated_at, updated_by)
       VALUES (@k, @v, @at, @by)
       ON CONFLICT (key) DO UPDATE SET value = @v, updated_at = @at, updated_by = @by`,
      { k: id, v: seal(v), at, by: actor?.email || actor?.id || null });
  }
  await applyStoredSecrets();

  /* The VALUE is never audited — an audit log is not a place to keep a live
     Stripe key. That it changed, by whom, and when, is the whole record. */
  await audit({ actor, action: v ? 'settings.secret_set' : 'settings.secret_cleared',
    targetType: 'secret', targetId: id, metadata: { label: spec.label } });

  return secretStatus();
}

/** Which of the things the shop needs are still missing, in plain words. */
export async function missingEssentials() {
  const status = await secretStatus();
  const by = Object.fromEntries(status.map((s) => [s.id, s]));
  const out = [];
  const payments = by['stripe.secretKey'].set || by['mollie.apiKey'].set
    || by['pay.tikkie'].set || by['pay.revolut'].set || by['pay.paypal'].set;
  if (!payments) out.push({ id: 'payments', what: 'a way to be paid', why: by['stripe.secretKey'].why });
  if (by['stripe.secretKey'].set && !by['stripe.webhookSecret'].set) {
    out.push({ id: 'stripe.webhookSecret', what: 'the Stripe webhook secret',
      why: by['stripe.webhookSecret'].why });
  }
  if (!by['email.resendApiKey'].set && !config.email.smtpUrl) {
    out.push({ id: 'email.resendApiKey', what: 'a way to email buyers',
      why: by['email.resendApiKey'].why });
  }
  return out;
}
