/**
 * Discord integration.
 *
 * - getServerInfo(): live community stats via Discord's public widget.json
 *   (no bot/token needed; the server just needs the Widget enabled). Cached
 *   briefly. Returns a graceful, always-renderable shape even when unconfigured.
 * - postOrderEvent(): posts a branded embed to an ops/sales channel webhook
 *   when an order is placed/completed/refunded. Best-effort; never throws.
 * - postDropEvent(): announces new products / restocks / coupons / bundles in
 *   the community #drops-and-deals channel (DISCORD_DROPS_WEBHOOK_URL).
 * - postStockAlert(): pings staff when a product's code stock runs low
 *   (DISCORD_STOCK_WEBHOOK_URL, falls back to the order webhook).
 */
import { config } from '../config/env.js';
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';

let cache = { at: 0, data: null };
const TTL_MS = 60_000;

// ── Relay outbox ─────────────────────────────────────────────────────────────
// No webhook/bot token on the server? Queue the event; the community bot polls
// the signed /api/discord/outbox endpoint and posts it — so Discord automation
// works with ZERO Discord secrets in the hosting environment.

async function enqueueOutbox(channel, body) {
  try {
    await run(
      `INSERT INTO discord_outbox (id, kind, payload, created_at) VALUES (@id, @k, @p, @at)`,
      { id: newId('dox'), k: channel, p: JSON.stringify(body), at: nowIso() });
    return true;
  } catch (err) {
    console.error('[discord] outbox enqueue failed:', err.message);
    return false;
  }
}

/**
 * Direct webhook when configured, otherwise queue for the bot relay.
 *
 * And queue it anyway when the direct post fails. The outbox exists because a
 * lost event is worth more than the queue costs — its own comment says "a lost
 * ping means a paid order nobody knows about" — but the webhook path was
 * bypassing it entirely: one 500 from Discord, one rate limit, one network
 * blip, and the sale ping, the chargeback alert or the out-of-stock warning was
 * simply gone, best-effort all the way down to nothing.
 *
 * A queued event is not lost, it is late: the bot polls, and if no bot is
 * running it is pruned after thirty days like any other.
 */
async function deliver(channel, url, body) {
  if (!url) return enqueueOutbox(channel, body);
  /* `fmPing` is ours, not Discord's — it tells the relay bot which opt-in role
     this event belongs to. A webhook has no roles to resolve and no member list
     to be careful with, so it is dropped here rather than posted as an unknown
     field. */
  const { fmPing, ...forDiscord } = body || {};
  if (await postWebhook(url, forDiscord)) return true;
  console.warn(`[discord] ${channel} webhook failed — queued for the bot relay instead`);
  return enqueueOutbox(channel, body);
}

/** Queue a DM for the bot relay (used when no bot token on the server). */
export async function relayDm(discordUserId, body) {
  return enqueueOutbox('dm', { discordUserId, ...body });
}

/**
 * Bot relay: lease pending events + housekeeping.
 *
 * This used to stamp delivered_at while merely HANDING the events over, before
 * the bot had sent anything. Anything that went wrong after that point — the
 * response never arriving, a missing channel permission, the bot restarting —
 * lost the event permanently and silently. Order pings ride this queue, and with
 * manual payment confirmation a lost ping means a paid order nobody knows about.
 *
 * Now the rows are LEASED: claimed_at is stamped so a second poll does not pick
 * up the same work, but delivered_at stays null until the bot confirms via
 * ackOutbox(). A lease older than LEASE_MS is offered again, so a crash between
 * lease and send costs one retry instead of the event.
 */
const LEASE_MS = 5 * 60_000;

/** How long an UNDELIVERED event is worth keeping before it is only clutter. */
const OUTBOX_MAX_AGE_DAYS = 30;

/**
 * Drop events nobody will ever deliver.
 *
 * The only pruning here used to run inside claimOutbox and only touched rows
 * with a delivered_at — so it required a working bot to clean up after a working
 * bot. If the bot is never started, which is the state every shop is in before
 * it is set up, nothing is delivered and therefore nothing is deleted: the table
 * grows for as long as the shop takes orders.
 *
 * That is not only disk. A sale ping carries the buyer's email address
 * (postOrderEvent → 'Customer'), so an unattended outbox is an unbounded,
 * unreviewed store of customer data with no retention policy — next to a
 * maintenance job that carefully expires IPs after 90 days.
 *
 * A month-old announcement has no value even if the bot appears tomorrow: the
 * drop has passed, the restock has sold out, the order is long since delivered.
 */
export async function pruneOutbox({ days = OUTBOX_MAX_AGE_DAYS } = {}) {
  const cutoff = new Date(Date.now() - days * 864e5).toISOString();
  const r = await run(
    `DELETE FROM discord_outbox WHERE delivered_at IS NULL AND created_at < @old`,
    { old: cutoff });
  return r?.changes ?? 0;
}

export async function claimOutbox(limit = 20) {
  const staleBefore = new Date(Date.now() - LEASE_MS).toISOString();
  const rows = await all(
    `SELECT id, kind, payload FROM discord_outbox
      WHERE delivered_at IS NULL AND (claimed_at IS NULL OR claimed_at < @stale)
      ORDER BY created_at ASC LIMIT @l`, { l: limit, stale: staleBefore });
  if (rows.length) {
    await run(`UPDATE discord_outbox SET claimed_at=@at WHERE id = ANY(@ids)`,
      { at: nowIso(), ids: rows.map((r) => r.id) });
  }
  // Housekeeping: delivered events older than 14 days can go.
  run(`DELETE FROM discord_outbox WHERE delivered_at IS NOT NULL AND delivered_at < @old`,
    { old: new Date(Date.now() - 14 * 864e5).toISOString() }).catch(() => {});
  pruneOutbox().catch(() => {});
  return rows.map((r) => {
    try { return { id: r.id, channel: r.kind, body: JSON.parse(r.payload) }; }
    catch { return null; }
  }).filter(Boolean);
}

/**
 * The bot confirms what it actually managed to send. Only these are retired;
 * everything else stays in the queue and is offered again once its lease ages
 * out, which is the whole point of leasing rather than marking on hand-over.
 */
export async function ackOutbox(ids = []) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))].slice(0, 200);
  if (!list.length) return 0;
  const r = await run(
    `UPDATE discord_outbox SET delivered_at=@at WHERE id = ANY(@ids) AND delivered_at IS NULL`,
    { at: nowIso(), ids: list });
  return r?.changes ?? 0;
}

/** Stamp/read when the bot last polled — powers the launch-check status. */
export async function stampBotSeen() {
  const at = nowIso();
  await run(`INSERT INTO kv (key, value, updated_at) VALUES ('discord_bot_seen_at', @v, @v)
             ON CONFLICT (key) DO UPDATE SET value=@v, updated_at=@v`, { v: at }).catch(() => {});
}
export async function botSeenRecently(hours = 24) {
  try {
    const r = await get(`SELECT value FROM kv WHERE key='discord_bot_seen_at'`);
    return !!r && Date.now() - Date.parse(r.value) < hours * 3_600_000;
  } catch { return false; }
}

// ── Live invite link ─────────────────────────────────────────────────────────
// Discord invites created with default settings expire after 7 days — a dead
// invite on the storefront silently kills community sign-ups. The bot creates a
// PERMANENT invite (maxAge 0) on boot and pushes it here; everything that shows
// an invite reads this live value first, then falls back to the env-configured
// link.
export async function setLiveInviteUrl(url) {
  await run(`INSERT INTO kv (key, value, updated_at) VALUES ('discord_invite_url', @v, @at)
             ON CONFLICT (key) DO UPDATE SET value=@v, updated_at=@at`,
    { v: url, at: new Date().toISOString() });
}
export async function getLiveInviteUrl() {
  try {
    const r = await get(`SELECT value FROM kv WHERE key='discord_invite_url'`);
    return r?.value || config.discord.inviteUrl || null;
  } catch { return config.discord.inviteUrl || null; }
}

export async function getServerInfo() {
  const base = {
    configured: !!config.discord.guildId,
    name: config.discord.serverName,
    // Only send a tagline the owner actually wrote. Handing the built-in
    // English default to the storefront left a Dutch page with one English
    // line in it — the storefront has a translated fallback and can use it
    // whenever there is nothing custom to show.
    tagline: process.env.DISCORD_TAGLINE ? config.discord.tagline : null,
    // Bot-maintained permanent invite first; env-configured link as fallback.
    inviteUrl: await getLiveInviteUrl(),
    online: null,
    memberPreview: [],
  };

  if (!config.discord.guildId) return base;
  if (cache.data && Date.now() - cache.at < TTL_MS) return cache.data;

  try {
    /* A deadline, because this sits on the homepage's critical path.
       getServerInfo() is called by publicStats(), which serves /api/stats, which
       the storefront requests on first paint. An endpoint that accepts the
       connection and then never answers does not fail — it hangs, and takes the
       whole request with it until the platform kills the function, at which
       point the visitor gets a platform error page instead of JSON. Discord's
       widget is a nice-to-have; three seconds is already generous, and the catch
       below degrades to the static info exactly as it does for a widget that is
       switched off. */
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3_000);
    let res;
    try {
      res = await fetch(`https://discord.com/api/guilds/${config.discord.guildId}/widget.json`,
        { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`widget ${res.status}`);
    const w = await res.json();
    const data = {
      ...base,
      name: w.name || base.name,
      online: w.presence_count ?? null,
      inviteUrl: base.inviteUrl || w.instant_invite || null,
      memberPreview: (w.members || []).slice(0, 12).map((m) => ({
        name: m.username, avatar: m.avatar_url, status: m.status,
      })),
    };
    cache = { at: Date.now(), data };
    return data;
  } catch {
    // Widget disabled or unreachable — return static info, don't error the page.
    return base;
  }
}

const COLORS = { received: 0x6366f1, completed: 0x10b981, refunded: 0xec4899 };

/** Post an order event embed to the configured Discord webhook (best-effort). */
export async function postOrderEvent(order, event = 'received') {
  const url = config.discord.orderWebhookUrl;
  const title = {
    received: '🧾 New order received',
    completed: '✅ Order completed',
    refunded: '↩️ Order refunded',
  }[event] || 'Order update';

  const embed = {
    title,
    color: COLORS[event] || 0x6366f1,
    thumbnail: { url: `${config.appUrl}/icon-512.png` },
    fields: [
      { name: 'Order', value: `\`${order.number}\``, inline: true },
      { name: 'Total', value: order.totalFormatted || String(order.total), inline: true },
      { name: 'Items', value: String(order.items?.length ?? '—'), inline: true },
    ],
    footer: { text: config.email.fromName },
    timestamp: new Date().toISOString(),
  };

  await deliver('leads', url, { embeds: [embed] });
}

/**
 * A delivery, announced in public.
 *
 * #proof-of-delivery has existed in the server plan since it was written, is one
 * of the few channels marked public, and its topic reads "Screenshots of real,
 * completed deliveries" — and nothing has ever posted to it. Every order event
 * went to the private #leads staff channel, so the channel a new visitor opens
 * to answer "has anyone actually received anything from this shop?" was empty.
 * For a store nobody has heard of that is the most expensive empty room there is.
 *
 * PUBLIC, so it carries no buyer and no order identity: not the email, not the
 * name, and deliberately not the order number either — that number is the public
 * lookup key for /track, and posting it would hand every reader the ability to
 * watch a stranger's order. What is left is the only thing that actually builds
 * trust: what was delivered, and how quickly.
 */
export async function postDeliveryProof(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) return;
  const placed = Date.parse(order.createdAt || order.created_at || '');
  const seconds = Number.isFinite(placed) ? Math.max(0, Math.round((Date.now() - placed) / 1000)) : null;
  // Anything over a day is a manual fulfilment that sat overnight; "1 day" reads
  // as a slow shop rather than a busy one, so the speed line is simply dropped.
  const speed = seconds !== null && seconds < 86400
    ? (seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)} min`)
    : null;

  const lines = items.slice(0, 4)
    .map((i) => `• ${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.name}`)
    .join('\n');
  const more = items.length > 4 ? `\n• …and ${items.length - 4} more` : '';

  await deliver('proof', config.discord.reviewsWebhookUrl, {
    embeds: [{
      title: '✅ Delivered',
      description: `${lines}${more}` + (speed ? `\n\nDelivered in **${speed}**.` : ''),
      color: 0x10b981,
      footer: { text: `${config.email.fromName} · every order, as it lands` },
      timestamp: new Date().toISOString(),
    }],
  });
}

/**
 * Ping staff the moment a customer submits payment proof — manual (Tikkie/
 * PayPal) orders deliver only as fast as the owner confirms them, so an instant
 * heads-up in the staff channel is the difference between minutes and hours.
 * Best-effort: a Discord hiccup never blocks the proof submission.
 */
export async function postPaymentProofAlert(order, proof = {}) {
  const flags = Array.isArray(proof.flags) ? proof.flags : [];
  const embed = {
    title: '💸 Payment proof submitted — verify now',
    color: flags.length ? 0xf59e0b : 0x10b981, // amber when fraud flags, green otherwise
    fields: [
      { name: 'Order', value: `\`${order.number}\``, inline: true },
      { name: 'Amount', value: money(order.total, order.currency), inline: true },
      { name: 'Method', value: proof.method || 'manual', inline: true },
      ...(proof.transactionId ? [{ name: 'Transaction ID', value: `\`${String(proof.transactionId).slice(0, 100)}\`` }] : []),
      ...(flags.length ? [{ name: '⚠️ Flags', value: flags.join(', ') }] : []),
      { name: 'Review', value: `${config.appUrl}/admin/payments` },
    ],
    footer: { text: config.email.fromName },
    timestamp: new Date().toISOString(),
  };
  await deliver('leads', config.discord.orderWebhookUrl, { embeds: [embed] });
}

/**
 * A paid order whose delivery is being held back.
 *
 * This is the one alert that costs money to ignore in both directions: leave it
 * and a real customer sits waiting for a code they paid for, act on it wrongly
 * and a stolen card gets handed a code that cannot be recalled. So it names the
 * exact signals rather than just a score, and links straight to the queue.
 */
export async function postFraudHoldAlert(order, { score, signals = [] } = {}) {
  const embed = {
    title: '🛑 Delivery held — order needs a human',
    description: 'Nothing has been delivered. It stays held until someone approves or rejects it.',
    color: 0xef4444,
    fields: [
      { name: 'Order', value: `\`${order.number}\``, inline: true },
      { name: 'Amount', value: money(order.total, order.currency), inline: true },
      { name: 'Risk score', value: `${score} / 100`, inline: true },
      { name: 'Customer', value: order.email || 'unknown' },
      ...(signals.length ? [{ name: 'Why', value: signals.map((s) => `• ${s.detail}`).join('\n').slice(0, 1000) }] : []),
      { name: 'Review', value: `${config.appUrl}/admin/security` },
    ],
    footer: { text: config.email.fromName },
    timestamp: new Date().toISOString(),
  };
  await deliver('leads', config.discord.orderWebhookUrl, { embeds: [embed] });
}

/** Fire a webhook payload; best-effort, logs and swallows every failure. */
/**
 * Post to a Discord webhook, with a deadline.
 *
 * Every other outbound call in this codebase carries one — Mollie 15s, Resend
 * 10s — for the same reason, written out next to each: these run inside request
 * handlers, and a call that is accepted and then never answered does not fail,
 * it hangs, holding the function until the platform kills it at maxDuration.
 * This one is reached from transitionOrder, which is the payment path: a sales
 * ping to a Discord that has stopped answering must not be able to stall an
 * order being marked paid.
 */
async function postWebhook(url, payload) {
  if (!url) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: config.email.fromName, ...payload }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`webhook ${res.status}`);
    return true;
  } catch (err) {
    console.error('[discord] webhook failed:',
      err.name === 'AbortError' ? 'timed out after 5s' : err.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const money = (cents, cur = 'EUR') =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur }).format((cents || 0) / 100);

/**
 * Announce a storefront event in the community #drops-and-deals channel.
 * kind: 'product' | 'restock' | 'coupon' | 'bundle'. Best-effort.
 */
export async function postDropEvent(kind, data = {}) {
  const url = config.discord.dropsWebhookUrl;
  const shop = `${config.appUrl}/shop`;
  let embed;
  if (kind === 'product') {
    embed = {
      title: `🆕 New drop: ${data.name}`,
      /* Was "instant delivery". 0 of 72 products auto-deliver, every product
         page says "delivered by hand, usually within a few hours", and the
         phrase is on honest-copy's banned list — which never scanned this
         directory, so the claim survived here after being removed everywhere
         a person could see it on the site. */
      description: `Fresh in the shop — **${money(data.price, data.currency)}**.\n[Grab it now](${config.appUrl}/product/${data.id})`,
      color: 0x6366f1,
    };
  } else if (kind === 'restock') {
    embed = {
      title: `📦 Restocked: ${data.name}`,
      description: `**${data.added}** new codes just landed${data.price ? ` — ${money(data.price, data.currency)}` : ''}.\n[Shop before it's gone](${config.appUrl}/product/${data.id})`,
      color: 0x10b981,
    };
  } else if (kind === 'coupon') {
    const off = data.kind === 'fixed' ? money(data.value, 'EUR') : `${data.value}%`;
    embed = {
      title: `🏷️ New discount code: ${data.code}`,
      description: `Use code **\`${data.code}\`** for **${off} OFF** at checkout.` +
        (data.minSubtotal ? `\nMinimum spend ${money(data.minSubtotal, 'EUR')}.` : '') +
        (data.expiresAt ? `\nValid until <t:${Math.floor(new Date(data.expiresAt).getTime() / 1000)}:D>.` : '') +
        `\n[Start shopping](${shop})`,
      color: 0xec4899,
    };
  } else if (kind === 'drop-scheduled') {
    // dropService.createDrop has always sent this kind, and nothing here handled
    // it — the call fell through to `else return` inside a .catch(() => {}), so
    // staff scheduled a drop, saw no error, and the server was never told. The
    // drop calendar is the one feature built purely for hype; it was announcing
    // to nobody.
    const when = data.startsAt ? Math.floor(new Date(data.startsAt).getTime() / 1000) : null;
    embed = {
      title: `⏰ Drop scheduled: ${data.title}`,
      description: (data.note ? `${data.note}\n\n` : '')
        + (when ? `Goes live <t:${when}:F> — <t:${when}:R>.\n` : '')
        + `Grab the 🔔 Drops & Restocks role in #roles so you hear it first.\n[See what's coming](${config.appUrl}/drops)`,
      color: 0xf59e0b,
    };
  } else if (kind === 'bundle') {
    embed = {
      title: `🎁 New bundle: ${data.name}`,
      description: `${data.description || 'Buy them together and save.'}\n**${data.discountPercent}% OFF** when bought together.\n[View bundles](${shop})`,
      color: 0xa855f7,
    };
  } else return;

  // Product announcements show the product's own art when available; every
  // drop gets the brand banner so the channel looks consistently premium.
  // Every kind must be in here: an unmapped kind produced the URL
  // /discord/banner-undefined.png, which Discord renders as a broken image.
  const banner = {
    product: 'products', restock: 'products', coupon: 'deals', bundle: 'deals',
    'drop-scheduled': 'deals',
  }[kind] || 'products';
  embed.image = { url: `${config.appUrl}/discord/banner-${banner}.png` };
  /* Absolute, always. `data.image` is a site-relative path like
     /products/art/robux-4500.svg, and Discord silently drops a thumbnail whose
     url is not a full URL — so every product drop announced its artwork to
     nobody. A data URI is skipped rather than absolutised: it is not a path,
     and Discord will not fetch one. */
  const thumb = kind === 'product' && data.image && !/^data:/.test(data.image)
    ? (/^https?:\/\//.test(data.image) ? data.image : `${config.appUrl}${data.image}`)
    : `${config.appUrl}/icon-512.png`;
  embed.thumbnail = { url: thumb };
  embed.footer = { text: `${config.email.fromName} · drops & deals` };
  embed.timestamp = new Date().toISOString();

  /* Which game this is about, so the bot can ping the people who asked about
     THAT game.
     #roles has offered a self-assignable role per game since the server was
     built, and nothing has ever pinged one: every restock went to everybody who
     opted into any drop at all. Someone who only buys Robux was pinged for
     every Steam restock, which is how an opt-in role becomes an opt-out. */
  await deliver('deals', url, {
    embeds: [embed],
    ...(data.category ? { fmPing: { category: String(data.category) } } : {}),
  });
}

/**
 * Mirror a new customer review into the community.
 *
 * #reviews has always told members that verified reviews "are posted here
 * automatically after real orders" — but nothing ever wrote to it, so the one
 * channel that answers "has anyone actually received their order?" sat empty
 * while the panel above it claimed otherwise. This makes the promise true.
 *
 * Only reviews tied to a real order carry the verified badge; a Discord vouch
 * is mirrored as an ordinary community review, never as a verified one.
 */
export async function postReviewEvent({ author, stars, body, product, verified = false, city } = {}) {
  const text = String(body || '').trim();
  if (!text) return;
  const s = Math.min(5, Math.max(1, Number(stars) || 5));
  const embed = {
    author: { name: String(author || 'Customer').slice(0, 80) },
    description: `${'⭐'.repeat(s)}${s < 5 ? '☆'.repeat(5 - s) : ''}\n\n${text.slice(0, 900)}`,
    color: verified ? 0x22c55e : 0x6366f1,
    fields: [
      ...(product ? [{ name: 'Product', value: String(product).slice(0, 100), inline: true }] : []),
      ...(city ? [{ name: 'From', value: String(city).slice(0, 60), inline: true }] : []),
    ],
    footer: {
      text: verified
        ? `${config.email.fromName} · verified purchase`
        : `${config.email.fromName} · community vouch`,
    },
    timestamp: new Date().toISOString(),
  };
  await deliver('reviews', config.discord.reviewsWebhookUrl, { embeds: [embed] });
}

/**
 * Alert staff when the API throws an unhandled 500. Throttled to one alert per
 * route per 5 minutes so an error storm can't flood the channel. Best-effort.
 */
const errorAlertAt = new Map(); // route -> last alert ts
/**
 * Tell a referrer, in Discord, that their link just earned something.
 *
 * The commission has always been credited and an in-app notification written,
 * and a member who lives in Discord — which is most of them, because that is
 * where the shop's community is — heard nothing. A referral programme nobody is
 * told about pays out once and is never shared again.
 *
 * Deliberately says WHAT was earned and nothing else — not who bought, not what
 * they bought, not even the order number. The buyer did not agree to have their
 * purchase reported to whoever shared a link, and the commission already tells
 * the referrer everything they are entitled to know.
 */
export async function postReferralEarned(discordUserId, { commissionCents } = {}) {
  if (!discordUserId || !(commissionCents > 0)) return;
  await relayDm(discordUserId, {
    embeds: [{
      title: '🤝 Your referral link just earned',
      description: `**${money(commissionCents, 'EUR')}** in store credit has been added to your account.\n`
        + 'It spends like money at checkout — nothing to claim.\n\n'
        + `[See your wallet](${config.appUrl}/account/wallet) · \`/ref\` for your link`,
      color: 0xa855f7,
      footer: { text: `${config.email.fromName} · referrals` },
      timestamp: new Date().toISOString(),
    }],
  }).catch(() => {});
}

/**
 * Chase an unpaid order in Discord.
 *
 * This is revenue the shop has ALREADY won: an order placed, priced and
 * reserved, waiting on a transfer. It was chased on exactly one channel — an
 * inbox — for a customer who found the shop in a Discord server, and then went
 * quiet until the fourteen-day auto-cancel took it away.
 *
 * Says what is owed and where to pay it, and nothing that pressures: the
 * order is not going anywhere for two weeks and saying otherwise would be a
 * countdown that is not counting anything.
 */
export async function postPaymentReminder(discordUserId, { orderNumber, amount } = {}) {
  if (!discordUserId || !orderNumber) return;
  await relayDm(discordUserId, {
    embeds: [{
      title: '💳 Your order is waiting for payment',
      description: `**${orderNumber}**${amount ? ` · ${amount}` : ''}\n\n`
        + 'Transfer the exact amount shown with your order number as the reference, '
        + 'and it goes out as soon as the payment is matched.\n\n'
        + `[Open your order](${config.appUrl}/track?number=${encodeURIComponent(orderNumber)})`,
      color: 0x6366f1,
      footer: { text: `${config.email.fromName} · nothing is charged automatically` },
      timestamp: new Date().toISOString(),
    }],
  }).catch(() => {});
}

/**
 * Ask a Discord-linked buyer for the review, where they already are.
 *
 * sendReviewRequests has run on the maintenance sweep since it was written and
 * has only ever sent an email. This shop has zero reviews and its whole social
 * proof problem hangs on that one channel — a buyer who arrived through Discord,
 * ordered through Discord and was delivered through Discord was then asked for
 * the review by email.
 *
 * One ask per order, because the sweep already only picks orders it has not
 * asked about; a second prompt is a shop nagging someone who bought from it.
 */
export async function postReviewRequest(discordUserId, { orderNumber, productName } = {}) {
  if (!discordUserId) return;
  await relayDm(discordUserId, {
    embeds: [{
      title: '⭐ How did it go?',
      description: (productName ? `Your **${productName}** landed a day ago.\n\n` : 'Your order landed a day ago.\n\n')
        + 'A review here only counts if it came from a delivered order, so yours is worth '
        + 'more than a page of five stars from nobody.\n\n'
        + `Type \`/vouch\` in the server, or [write it on the site](${config.appUrl}/reviews).`,
      color: 0xf59e0b,
      footer: { text: `${config.email.fromName}${orderNumber ? ` · ${orderNumber}` : ''}` },
      timestamp: new Date().toISOString(),
    }],
  }).catch(() => {});
}

export async function postErrorAlert(route, message) {
  const url = config.discord.stockWebhookUrl || config.discord.orderWebhookUrl;
  const now = Date.now();
  if (now - (errorAlertAt.get(route) || 0) < 5 * 60_000) return;
  errorAlertAt.set(route, now);
  await deliver('leads', url, { embeds: [{
    title: '🚨 API error (500)',
    description: `**Route:** \`${route}\`\n**Error:** ${String(message || 'unknown').slice(0, 300)}\n\nCheck the Vercel function logs for the stack trace.`,
    color: 0xef4444,
    footer: { text: `${config.email.fromName} · error monitor` },
    timestamp: new Date().toISOString(),
  }] });
}

/** Ping staff that a product's pre-loaded code stock is running low. */
export async function postStockAlert(product, remaining, tier = null) {
  const url = config.discord.stockWebhookUrl || config.discord.orderWebhookUrl;
  // `tier` is the rung that was just crossed. Naming it beats naming a single
  // configured threshold, which stopped being the whole story once the alerts
  // became a ladder: "below the 5 mark" says which warning this is.
  const crossed = tier === null ? config.discord.lowStockThreshold : tier;
  const out = remaining === 0;
  const critical = !out && crossed <= 5;
  const embed = {
    title: out ? `🔴 OUT OF STOCK: ${product.name}`
      : `${critical ? '🟠' : '📉'} ${critical ? 'Stock critical' : 'Low stock'}: ${product.name}`,
    description: out
      ? `**No codes left.** New orders cannot be delivered automatically.\n`
        + `Load codes in the admin panel → Products → Codes, or take it offline.`
      : `**${remaining}** code${remaining === 1 ? '' : 's'} left — below the ${crossed} mark.\n`
        + `Top up in the admin panel → Products → Codes.`,
    color: out ? 0xef4444 : critical ? 0xf59e0b : 0xf97316,
    footer: { text: `${config.email.fromName} · stock monitor` },
    timestamp: new Date().toISOString(),
  };
  await deliver('leads', url, { embeds: [embed] });
}
