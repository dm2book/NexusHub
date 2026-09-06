/**
 * Order lifecycle + state machine.
 *
 * Status flow (per spec):
 *   pending → payment_received → processing → awaiting_fulfillment
 *           → completed | refunded | cancelled
 *
 * Transitions are validated centrally; every change appends to
 * order_status_history (powering real-time tracking) and emits the matching
 * customer notification + branded email.
 */
import { run, get, all, nowIso, tx } from '../db/index.js';
import { newId, newOrderNumber } from '../utils/ids.js';
import { formatMoney } from '../utils/money.js';
import { config, manualPayMethods } from '../config/env.js';
import { badRequest, notFound, conflict } from '../utils/errors.js';
import { sendEmailAsync } from './emailService.js';
import { validatePayLink } from '../utils/payLink.js';
import { payMethodsFor } from '../utils/payMethodUrl.js';
import { renderTemplate, baseContext } from './templateService.js';
import { notify } from './notificationService.js';
import { scoreOrder } from './fraudService.js';
import { assertOrderLimits } from './orderLimitService.js';
import { audit } from './auditService.js';
import { getProduct } from './productService.js';
import { postOrderEvent, postFraudHoldAlert, postDeliveryProof, postReviewRequest,
  postPaymentReminder } from './discordService.js';
import { alertOwner } from './notifyService.js';
import { assertLaunched } from './launchGateService.js';
import { syncMemberRoles, sendDeliveryDm, discordUidForUser } from './discordRolesService.js';
import { availableCount, claimCodes, checkLowStock, releaseCodes } from './codeStockService.js';
import { memberDiscountPercent } from './membershipService.js';
import { recordOrderCommission, reverseOrderCommission } from './affiliateService.js';
import { recordPurchaseEvent } from './socialProofService.js';
import { bustSocialCaches } from '../routes/social.js';
import { balanceOf, debit, credit, hasOrderEntry } from './walletService.js';
import { grantTierRewards } from './loyaltyService.js';
import { awardCoinsForOrder } from './forgeCoinService.js';
import { settleMysteryForOrder } from './mysteryBoxService.js';
import { evaluateCoupon, recordCouponRedemption } from './couponService.js';
/* The one detail a category needs from the buyer, from the same module the
   product page and the checkout read. */
import { deliveryField as deliveryFieldFor } from '../../../src/lib/deliveryInfo.js';
import { emailCopy, redeemSteps, redeemFallback } from './emailCopy.js';
import { bestBundleDiscount } from './bundleService.js';

export const STATUSES = [
  'pending', 'payment_received', 'processing', 'awaiting_fulfillment',
  'completed', 'refunded', 'cancelled', 'failed',
];

const TRANSITIONS = {
  pending: ['payment_received', 'cancelled', 'failed'],
  payment_received: ['processing', 'refunded', 'cancelled', 'failed'],
  processing: ['awaiting_fulfillment', 'completed', 'refunded', 'cancelled', 'failed'],
  awaiting_fulfillment: ['completed', 'refunded', 'cancelled', 'failed'],
  completed: ['refunded'],
  refunded: [],
  cancelled: [],
  failed: ['cancelled', 'pending'],   // can retry or close out a failed order
};

const STATUS_EMAIL = {
  payment_received: 'payment_confirmed',
  processing: 'order_processing',
  completed: 'order_completed',
  refunded: 'refund_issued',
};

const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

export function canTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Creation ───────────────────────────────────────────────────────────────

export async function createOrder(input, ctx = {}) {
  /* The pre-launch gate, at the choke point rather than at the routes.

     Every purchase in this system becomes an order here — the checkout, a
     mystery box, a bundle, a gift card, an admin creating one by hand. Guarding
     the routes instead would mean remembering to guard the next one, which is
     exactly how the Discord events ended up missing three of their call sites.
     `ctx.user` is the same object the auth middleware attached, so staff are
     recognised here the same way they are everywhere else. */
  await assertLaunched(ctx.user, 'The checkout', { money: true });

  const email = String(input.email || '').toLowerCase();
  if (!email) throw badRequest('Customer email is required');
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw badRequest('An order needs at least one item');
  }

  // EU distance selling: for digital goods the 14-day withdrawal right only
  // lapses if the buyer expressly consented to immediate delivery AND
  // acknowledged losing it — and the trader has to be able to PROVE that. The
  // checkout has shown this checkbox for a while, but it never left the browser,
  // so a chargeback would have found nothing on file. Recorded here, and the
  // sentence itself is kept because the wording is what was agreed to.
  //
  // Refusing the order rather than defaulting to "consented" is deliberate: an
  // assumed waiver is exactly the thing a dispute would throw out.
  const consentText = String(input.consentText || '').trim().slice(0, 400);
  if (!input.consent) throw badRequest('Please confirm immediate delivery before ordering');

  const orderId = newId('ord');
  const number = newOrderNumber();
  const at = nowIso();
  let subtotal = 0;
  const currency = input.currency || 'EUR';
  const lineItems = [];
  /* What this order still needs from the buyer before it can be delivered —
     "Roblox-gebruikersnaam" and the like. Collected while walking the items so
     a mixed order names each thing once. */
  const missingTargets = new Set();

  for (const li of input.items) {
    const product = await getProduct(li.productId);
    if (!product) throw badRequest(`Unknown product: ${li.productId}`);
    if (!product.active) throw conflict(`Product not available: ${product.name}`);
    /* A mystery box pays out as store credit, and store credit lives in an
       account. A guest could buy one: the checkout takes the money, and then
       settleMysteryForOrder() begins `if (!order.userId) return []` — no roll,
       no prize, no pull recorded, and nothing a human in the fulfillment queue
       can do about it either, because there is no wallet to credit. The product
       page meanwhile promises that every box wins a real prize.

       Refused here rather than hidden in the UI: this is the choke point every
       purchase passes through, and a product that cannot be fulfilled must not
       be sellable, not merely hard to reach. */
    if (product.kind === 'mystery' && !input.userId) {
      throw badRequest(
        `${product.name} pays out as store credit, so it needs an account — please sign in or create one first.`);
    }
    /* A top-up we cannot address stalls until somebody asks for the address.

       Robux goes onto an account, not into a code, and the product page says
       so: "geef ons je Roblox-gebruikersnaam door (in je bestelling of via een
       ticket)". The checkout was reading only `metadata.deliveryField`, which
       is set on none of the seventy-two products, so that field never rendered
       and every Robux order arrived with nothing to deliver it to.

       Not refused here. The page offers a ticket as an equally valid way to
       hand it over, so an order without it is incomplete rather than invalid —
       and refusing a payment over a field the shop says you may supply later
       would lose the sale outright. It is RECORDED instead, so the buyer is
       asked for it in the confirmation mail and on the track page, and the
       fulfilment queue shows what it is waiting for. */
    const needsTarget = deliveryFieldFor(product.category, 'nl');
    if (needsTarget && !String(input.billing?.deliveryDetails || '').trim()) {
      missingTargets.add(needsTarget);
    }
    const qty = Math.max(1, Number(li.quantity || 1));
    const unit = product.price;
    subtotal += unit * qty;
    lineItems.push({
      id: newId('oit'), product_id: product.id, name: product.name,
      quantity: qty, unit_price: unit,
      // Snapshot the category: the delivery email picks its redeem instructions
      // from it, and it must stay correct even if the product is later re-filed
      // or deleted. Client-supplied metadata never overrides it.
      metadata: { ...(li.metadata || {}), category: product.category },
    });
  }
  // Apply a discount coupon if one was supplied and is valid (DB-backed; server
  // is authoritative — the discount is recomputed here, never trusted from client).
  const couponEval = await evaluateCoupon(input.coupon, { subtotal, userId: input.userId, email });
  const couponCode = couponEval.ok ? couponEval.code : null;
  const couponDiscount = couponEval.ok ? couponEval.discount : 0;
  // Forge+ members get a standing discount on top (stacked with any coupon).
  const memberPercent = input.userId ? await memberDiscountPercent(input.userId) : 0;
  const memberDiscount = memberPercent ? Math.round(subtotal * memberPercent / 100) : 0;
  // Bundle discount: best single bundle whose products are all in the order.
  const bundle = await bestBundleDiscount(lineItems);
  const bundleDiscount = bundle.discount;
  /* One ceiling over the whole stack.
     These were summed and capped at the subtotal, which is not a cap: a 90%
     coupon, a 20% bundle and the 5% Forge+ discount is 115%, so the order came
     to €0 and the shop delivered a code it had paid for. Each source is
     individually sane; nothing was looking at the total.
     Clamped rather than refused — a buyer who found a legitimate stack should
     still get the best discount the shop is willing to give, not an error. */
  const stacked = couponDiscount + memberDiscount + bundleDiscount;
  const discountCeiling = Math.round(subtotal * Math.max(0, Math.min(100,
    config.market.maxTotalDiscountPercent)) / 100);
  const discount = Math.min(subtotal, stacked, discountCeiling);
  if (stacked > discount) {
    console.warn(`[order] discount stack ${stacked} clamped to ${discount} `
      + `(${config.market.maxTotalDiscountPercent}% of ${subtotal})`);
  }
  const afterDiscount = Math.max(0, subtotal - discount);
  // Optionally pay part of the order with the customer's store credit.
  let creditApplied = 0;
  if (input.userId && input.useCredit) {
    const bal = await balanceOf(input.userId);
    creditApplied = Math.max(0, Math.min(Math.round(Number(input.useCredit) || 0), bal, afterDiscount));
  }
  const total = Math.max(0, afterDiscount - creditApplied);
  const billing = { ...(input.billing || {}) };
  // Bound the free-text billing fields (they flow into emails and admin views).
  if (billing.full_name) billing.full_name = String(billing.full_name).trim().slice(0, 80);
  if (billing.city) billing.city = String(billing.city).trim().slice(0, 80);
  /* Which language the buyer read the shop in — kept so the person answering a
     ticket knows which one to answer in. Bounded to the codes the storefront
     actually offers; anything else is dropped rather than stored. */
  billing.lang = ['nl', 'en', 'de', 'fr'].includes(billing.lang) ? billing.lang : undefined;
  // How the buyer wants this order delivered: 'code' = emailed gift code, 'account'
  // = we top up their account directly (needs a target). A supplied target implies
  // account delivery unless the buyer explicitly chose a code (backward compatible
  // with the pre-choice checkout that only sent the target).
  const suppliedTarget = !!String(billing.deliveryDetails || '').trim();
  billing.deliveryMethod = billing.deliveryMethod === 'account' ? 'account'
    : billing.deliveryMethod === 'code' ? 'code'
    : (suppliedTarget ? 'account' : 'code');
  // Delivery target the buyer supplied for a hand-delivered/P2P item (e.g. their
  // in-game username) — bounded, and surfaced to the owner in the manual queue.
  if (billing.deliveryDetails) billing.deliveryDetails = String(billing.deliveryDetails).trim().slice(0, 200);
  if (billing.deliveryLabel) billing.deliveryLabel = String(billing.deliveryLabel).trim().slice(0, 60);
  // A plain gift-code order carries no account target — drop any stray value so
  // the fulfillment queue never shows a phantom "deliver to" on a code order.
  if (billing.deliveryMethod !== 'account') { delete billing.deliveryDetails; delete billing.deliveryLabel; }
  /* What we still have to ask the buyer for. Recorded on the order so the
     confirmation mail, the track page and the fulfilment queue all name the
     same thing — and only when the buyer did not already supply it. */
  if (missingTargets.size && !suppliedTarget) {
    billing.needsFromBuyer = [...missingTargets].join(' / ');
  }
  if (couponCode) { billing.coupon = couponCode; billing.discount = couponDiscount; }
  if (memberDiscount) { billing.memberDiscount = memberDiscount; billing.memberPercent = memberPercent; }
  if (bundleDiscount) { billing.bundle = bundle.bundle?.name; billing.bundleDiscount = bundleDiscount; }
  if (creditApplied) billing.creditApplied = creditApplied;

  // Ceilings, checked before anything is written. Scoring decides how suspicious
  // an order is; this decides whether it is plausible at all. A stolen card that
  // trips no rule can still place forty orders overnight — these bound that
  // without needing to be clever about it.
  await assertOrderLimits({ email, ip: ctx.ip || null, total, currency });

  await tx(async () => {
    await run(`INSERT INTO orders
          (id, number, user_id, email, status, currency, subtotal, total, billing,
           consent_at, consent_text, ip, created_at, updated_at)
         VALUES (@id, @num, @uid, @email, 'pending', @cur, @sub, @tot, @bill,
           @consentAt, @consentText, @ip, @at, @at)`,
        { id: orderId, num: number, uid: input.userId || null, email,
          cur: currency, sub: subtotal, tot: total,
          bill: JSON.stringify(billing), ip: ctx.ip || null,
          consentAt: at, consentText: consentText || null, at });
    for (const it of lineItems) {
      await run(`INSERT INTO order_items (id, order_id, product_id, name, quantity, unit_price, metadata)
           VALUES (@id, @oid, @pid, @name, @qty, @price, @meta)`,
          { id: it.id, oid: orderId, pid: it.product_id, name: it.name,
            qty: it.quantity, price: it.unit_price, meta: JSON.stringify(it.metadata) });
    }
    // Spend the store credit atomically with the order (rolls back if it can't).
    if (creditApplied) {
      await debit(input.userId, creditApplied, 'spend',
        `Applied to order ${number}`, { orderId, createdBy: input.userId });
    }
    await appendHistory(orderId, null, 'pending', ctx.actorId || 'system', 'Order created');
  });

  /* Remember which language this person reads in.
     The order carries it, but a login code and a cart reminder do not have an
     order behind them — so it lands on the user too, and every later mail
     follows the language they last bought in. Best-effort: a shop that cannot
     write a preference must still take the order. */
  if (input.userId && billing.lang) {
    await run('UPDATE users SET lang = @l WHERE id = @id', { l: billing.lang, id: input.userId })
      .catch((e) => console.warn('[order] could not store buyer language:', e.message));
  }

  // Record the coupon redemption (per-user limits + usage counter). Best-effort.
  if (couponCode) {
    await recordCouponRedemption({ code: couponCode, userId: input.userId, email, orderId, ip: ctx.ip })
      .catch((e) => console.error('[coupon] redemption', e.message));
  }

  // ── Fraud screening ────────────────────────────────────────────────────
  // The score used to be written here and then never read again: an order could
  // be recorded as `blocked` and have its codes auto-delivered seconds later.
  // Now the decision does something.
  const order = await getOrder(orderId);
  const fraud = await scoreOrder({
    order, user: ctx.user, email, ip: ctx.ip || null, country: ctx.country || null,
  });
  // `review` holds the delivery. The order stays a perfectly normal paid order —
  // it just does not hand anything over until a person has looked at it. That
  // matters here more than in a physical shop: a code cannot be un-read, and the
  // chargeback arrives weeks later with nothing left to reclaim.
  const hold = fraud.decision === 'review' || fraud.decision === 'block';
  await run(
    `UPDATE orders SET fraud_score=@s, fraud_status=@d, fraud_hold=@h, fraud_hold_reason=@r
      WHERE id=@id`,
    { s: fraud.score, d: fraud.decision, id: orderId,
      h: hold ? 1 : 0,
      r: hold ? fraud.signals.map((x) => x.detail).join(' · ').slice(0, 500) : null });

  if (fraud.decision === 'block') {
    // Refused outright, before the buyer is asked for a cent. The order row
    // stays — it is the evidence, and deleting the record of a blocked attempt
    // throws away the history the next attempt would be scored against.
    await transitionOrder(orderId, 'failed',
      { actorId: 'fraud', reason: `Blocked by fraud screening (score ${fraud.score})` })
      .catch((e) => console.error('[fraud] could not fail blocked order:', e.message));
    await audit({
      actor: { id: 'fraud', email: 'fraud' }, action: 'order.blocked',
      targetType: 'order', targetId: orderId,
      metadata: { score: fraud.score, signals: fraud.signals.map((x) => x.rule) },
    }).catch(() => {});
    throw badRequest(
      'We could not accept this order. Nothing has been charged. '
      + 'If you think this is a mistake, email us and a person will place it for you.');
  }

  if (hold) {
    console.warn(`[fraud] holding ${number} (score ${fraud.score}): ${fraud.signals.map((x) => x.rule).join(', ')}`);
    await audit({
      actor: { id: 'fraud', email: 'fraud' }, action: 'order.held',
      targetType: 'order', targetId: orderId,
      metadata: { score: fraud.score, signals: fraud.signals.map((x) => x.rule) },
    }).catch(() => {});
    // Staff need to know something is waiting; the buyer is told at the point
    // where they would otherwise be wondering where their code is.
    await postFraudHoldAlert(await getOrder(orderId), fraud).catch(() => {});
  }

  // Nothing left to pay — store credit (or a 100% coupon) covered the lot. The
  // credit was already debited above, so leaving this 'pending' would park the
  // buyer on a screen asking them to transfer €0.00 with a reference, until the
  // 14-day auto-cancel swept it up. Settle it here instead, down the same path a
  // real payment takes, so stock is dispensed and the delivery email goes out.
  if (total === 0) {
    const settled = await markPaymentReceived(orderId, `credit_${orderId}`,
      { actorId: ctx.actorId || 'system', reason: 'Covered in full by store credit' })
      .catch((e) => { console.error('[order] zero-total settle:', e.message); return null; });
    if (settled) return settled;
  }

  // Customer comms.
  const fresh = await getOrder(orderId);
  await sendEmailAsync('order_received', email, emailContext(fresh));
  await postOrderEvent(fresh, 'received').catch(() => {});
  /* And on the owner's phone. postOrderEvent goes to a Discord CHANNEL, which
     is only seen by somebody who happens to be looking at Discord; alertOwner is
     the path that reaches Telegram and Pushover. This shop is paid by manual
     transfer, so the minutes between an order being placed and the owner
     watching for the money are the minutes the delivery promise is spending. */
  await alertOwner('order.placed', {
    title: `${fresh.number} · ${fresh.totalFormatted || formatMoney(fresh.total, fresh.currency)}`,
    lines: [
      (fresh.items || []).map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.name}`).join(', ') || 'no items',
      `Customer: ${fresh.email}`,
      'Waiting for the transfer — nothing has been paid yet.',
    ],
    url: `${config.appUrl}/admin/orders/${fresh.id}`,
    key: `placed:${fresh.id}`,
  }).catch(() => {});
  if (input.userId) {
    await notify(input.userId, {
      type: 'order_update', title: `Order ${number} received`,
      body: 'We have received your order and it is pending payment.',
      link: `/account/orders/${orderId}`,
    });
  }
  return fresh;
}

// ── State machine ────────────────────────────────────────────────────────

/** Staff: attach delivery code(s) to an order and complete it — the codes are
 *  e-mailed to the customer via the order_completed template (deliveriesHtml). */
/**
 * Write deliveries onto an order, once each, all or nothing.
 *
 * Exported because there are two doors into an order's deliveries — this file's
 * deliverOrder (staff, auto-dispense) and fulfillmentService's persistResult
 * (supplier connectors) — and both were bare INSERTs. Anything that ran either
 * step again wrote the same content a second time: a double-clicked button, a
 * retried dispense, and worst of all retryPendingFulfillments, which re-reads an
 * in-progress supplier request on every maintenance pass and persisted its
 * deliveries again each time.
 *
 * Returns only what was actually new, so a caller can tell "delivered" from
 * "already had it" — the difference between emailing a buyer their codes and
 * emailing them a second time about codes they already have.
 */
export async function insertDeliveries(orderId, list = []) {
  const already = new Set((await all(
    'SELECT content FROM deliveries WHERE order_id=@o', { o: orderId })).map((d) => d.content));
  const fresh = [];
  for (const d of list) {
    const content = String(d.content ?? '').trim();
    // A delivery with no content is a file or a done-on-the-supplier's-side
    // top-up; there is nothing to compare, so it is written as given.
    if (content && already.has(content)) continue;
    if (content) already.add(content);
    fresh.push({ ...d, content: content || null });
  }
  if (!fresh.length) return [];
  // One transaction: a loop of separate INSERTs that throws halfway leaves the
  // earlier rows written and the order never completed, which is a paid order
  // showing part of its codes with no way to tell that is what happened.
  await tx(async () => {
    for (const d of fresh) {
      await run(`INSERT INTO deliveries (id, order_id, order_item_id, type, content, filename, max_downloads, created_at)
           VALUES (@id, @oid, @iid, @type, @c, @file, @max, @at)`,
          { id: newId('dlv'), oid: orderId, iid: d.orderItemId || d.order_item_id || null,
            type: d.type || 'code', c: d.content, file: d.filename || null,
            max: d.maxDownloads ?? null, at: nowIso() });
    }
  });
  return fresh;
}

export async function deliverOrder(orderId, deliveries = [], ctx = {}) {
  const order = await getOrderRow(orderId);
  if (!order) throw notFound('Order not found');
  // An order whose money has gone back is not deliverable, and the force-complete
  // below would otherwise drag it straight out of `refunded` into `completed`.
  //
  // This is not theoretical: auto-dispense runs in the background from the moment
  // an order is paid, so a refund or chargeback landing seconds later raced it and
  // the loser was always the refund. The buyer kept the code AND the money, and the
  // order read `completed` — nothing in the dashboard would ever have shown it.
  if (['refunded', 'cancelled'].includes(order.status)) {
    throw conflict(`Order is ${order.status} — it cannot be delivered`);
  }
  // Held for review. Refused here rather than only in auto-dispense, because
  // this is also the door the supplier queue and the staff button come through,
  // and a hold that only covers one of the three routes is not a hold. Approving
  // the order in the review queue clears it; there is no way past it that does
  // not involve a person deciding.
  if (order.fraud_hold) {
    throw conflict('This order is held for fraud review — approve it before delivering');
  }
  const fresh = await insertDeliveries(orderId, deliveries);
  // Already completed (e.g. staff sends a replacement code)? The transition
  // below would early-return and the customer would never be emailed the new
  // code — send the delivery email explicitly instead. Only for content that is
  // actually new: re-sending "here is your code" for a code the buyer already
  // has reads as a second order.
  if (order.status === 'completed' && fresh.length) {
    const current = await getOrder(orderId);
    await sendEmailAsync('order_completed', current.email, emailContext(current, ctx));
    if (current.userId) {
      await notify(current.userId, { type: 'delivery', title: `Order ${current.number}: new delivery`,
        body: 'A new code was added to your order — check your email and dashboard.',
        link: `/account/orders/${orderId}` }).catch(() => {});
    }
    return current;
  }
  // Force-complete from any state — staff is explicitly fulfilling the order.
  return transitionOrder(orderId, 'completed', { ...ctx, force: true, reason: ctx.reason || 'Delivered by staff' });
}

export async function transitionOrder(orderId, to, ctx = {}) {
  const order = await getOrderRow(orderId);
  if (!order) throw notFound('Order not found');
  if (order.status === to) return getOrder(orderId);
  if (!ctx.force && !canTransition(order.status, to)) {
    throw conflict(`Cannot move order from "${order.status}" to "${to}"`);
  }

  /* The one thing `force` may never do.

     Money that has gone back has gone back. Auto-dispense runs in the
     background from the moment an order is paid, so a refund landing seconds
     later races it — and deliverOrder force-completes. Its own guard reads the
     status first, but a refund arriving between that read and the UPDATE was
     still able to lose: the order ended `completed`, the buyer had the code and
     the money, and nothing in the dashboard would ever have shown it.

     Measured directly: forcing the transition to retry after losing a race
     turned that from occasional into reliable — four rounds out of six went
     refunded → completed. So the rule belongs here, at the choke point every
     status change passes through, rather than in the callers that happen to
     remember it. */
  if (['refunded', 'cancelled'].includes(order.status) && ['completed', 'payment_received'].includes(to)) {
    throw conflict(`Order is ${order.status} — it cannot become "${to}"`);
  }

  let paymentSet = '';
  if (to === 'payment_received') paymentSet = ", payment_status='paid'";
  if (to === 'refunded') paymentSet = ", payment_status='refunded'";

  // Atomic guard: the UPDATE only fires when the row is still in its observed
  // status. Concurrent callers (two admins confirming payment, a PSP webhook
  // racing a manual confirm, a double-clicked button) that lose the race get
  // changes=0 and return WITHOUT re-running the side-effects below — so an order
  // can never be dispensed / emailed / completed twice.
  /* One attempt, guarded on the status we observed. A caller that loses the race
     gets changes=0 and returns without re-running any of the side-effects below,
     which is what stops an order being dispensed or emailed twice. */
  const attempt = async (from) => tx(async () => {
    const r = await run(`UPDATE orders SET status=@status, updated_at=@at${paymentSet} WHERE id=@id AND status=@from`,
        { status: to, at: nowIso(), id: orderId, from });
    if (!r?.changes) return false;
    await appendHistory(orderId, from, to, ctx.actorId || 'system', ctx.reason);
    return true;
  });

  let moved = await attempt(order.status);

  /* `force` means the caller has decided, so losing a race must not silently
     drop the decision.
     Measured: a refund arriving while auto-dispense was completing the same
     order read `payment_received`, and by the time its UPDATE ran the row said
     `completed`. changes=0, and transitionOrder returned the order unchanged —
     no error, no history row, nothing to notice. The money had gone back and the
     order still read completed. Mollie's refund path carries its own retry loop
     for exactly this, which is what made it survivable there and nowhere else.
     A forced transition now re-reads and tries again against what it finds. */
  if (!moved && ctx.force) {
    for (let i = 0; i < 4 && !moved; i++) {
      const now = await getOrderRow(orderId);
      if (!now || now.status === to) return getOrder(orderId);
      // Re-checked on every pass: the race we are retrying through is exactly
      // how an order reaches one of these while we are looping.
      if (['refunded', 'cancelled'].includes(now.status) && ['completed', 'payment_received'].includes(to)) {
        throw conflict(`Order is ${now.status} — it cannot become "${to}"`);
      }
      moved = await attempt(now.status);
    }
    if (!moved) {
      console.error(`[order] forced transition to ${to} kept losing races on ${order.number || orderId}`);
    }
  }
  if (!moved) return getOrder(orderId); // another transition already moved this order

  const updated = await getOrder(orderId);
  const emailEvent = STATUS_EMAIL[to];
  if (emailEvent) {
    await sendEmailAsync(emailEvent, updated.email, emailContext(updated, ctx));
  }
  if (to === 'completed') {
    await postOrderEvent(updated, 'completed').catch(() => {});
    // …and the public half of the same event: staff get the order in #leads,
    // the community gets the proof that orders actually land (best-effort).
    await postDeliveryProof(updated).catch(() => {});
    // Capture a privacy-safe snapshot for the live social-proof feed (best-effort).
    await recordPurchaseEvent(updated).catch(() => {});
    // Delivered count / live feed just changed → refresh the public stats now.
    bustSocialCaches();
    // DM Discord-linked buyers their codes + a /vouch prompt (best-effort).
    await sendDeliveryDm(updated).catch(() => {});
  }
  // If the order is cancelled/refunded, return any store credit that was spent on it.
  /* An order that stops being a sale takes its referral commission with it.
     The commission is paid the moment money arrives, as spendable credit, and
     nothing reversed it — so a refunded referred order left the 5% out of the
     door with the goods and the money both gone. */
  if (to === 'refunded' || to === 'cancelled' || to === 'failed') {
    await reverseOrderCommission(updated.id, to).catch((e) =>
      console.error('[order] commission reversal', e.message));
  }

  if ((to === 'refunded' || to === 'cancelled') && updated.userId && updated.billing?.creditApplied > 0) {
    if (!(await hasOrderEntry(orderId, 'refund').catch(() => true))) {
      await credit(updated.userId, updated.billing.creditApplied, 'refund',
        `Store credit returned · order ${updated.number}`, { orderId }).catch((e) => console.error('[wallet refund]', e.message));
    }
  }
  if (to === 'refunded') await postOrderEvent(updated, 'refunded').catch(() => {});

  /* Tell the OWNER, on their phone, within seconds.
     Hung off the state machine rather than off the call sites: every status
     change in this system goes through here, so a new payment provider or an
     admin action added later is covered without anyone remembering to. Wiring
     it per-call-site is how the Discord events ended up missing three of the
     places that should have fired them. */
  const NOTIFY_ON = {
    payment_received: 'order.paid',
    failed: 'payment.failed',
    refunded: 'order.refunded',
  };
  if (NOTIFY_ON[to]) {
    const items = (updated.items || [])
      .map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.name}`);
    await alertOwner(NOTIFY_ON[to], {
      title: `${updated.number} · ${updated.totalFormatted || formatMoney(updated.total, updated.currency)}`,
      lines: [
        items.length ? items.join(', ') : 'no items',
        `Customer: ${updated.email}`,
        ...(ctx.reason ? [`Reason: ${ctx.reason}`] : []),
      ],
      url: `${config.appUrl}/admin/orders/${updated.id}`,
      /* One alert per order per transition, not per call.
         transitionOrder is reached from the checkout, the PSP webhook, the
         admin panel and the retry sweep, and a replayed webhook walks the same
         path again. The order number plus the state it moved to is the event;
         anything else is the same event described twice. */
      key: `${updated.number}:${to}`,
    }).catch(() => {});
  }

  // Bring the buyer's Discord roles in line with this order.
  //
  // Fired on the way DOWN as well as up, which is the part that was missing:
  // roles were granted when an order was paid and never touched again, so a
  // refund or a chargeback left a VIP badge on someone who no longer had a
  // single paid order. The reconciler works out the whole set from scratch, so
  // one call handles both directions.
  if (['payment_received', 'completed', 'refunded', 'cancelled', 'failed'].includes(to)) {
    await syncMemberRoles(updated.userId, { reason: `order ${updated.number} → ${to}` })
      .catch((e) => console.error('[discord] role sync:', e.message));
  }
  if (updated.userId) {
    await notify(updated.userId, {
      type: 'order_update',
      title: `Order ${updated.number}: ${labelFor(to)}`,
      body: statusBlurb(to),
      link: `/account/orders/${orderId}`,
    });
  }
  // Once paid, auto-deliver from code stock if every item is in stock; if not,
  // fall through to supplier auto-fulfillment (hands-off). Only engages when a
  // supplier integration actually covers an item — otherwise the order waits in
  // the manual queue exactly as before.
  if (to === 'payment_received') {
    autoDispenseFromStock(orderId, ctx)
      .then(async (delivered) => {
        if (delivered) return;
        // Not in local stock → hand off to the serial supplier queue, which
        // buys + delivers paid orders one at a time, oldest first.
        // A held order belongs in the review queue, not the fulfilment one.
        // Putting it in both would show staff a "deliver this" task they cannot
        // action — deliverOrder refuses a held order — and the resulting error
        // teaches people to distrust the queue rather than the order.
        const held = await get('SELECT fraud_hold FROM orders WHERE id=@id', { id: orderId });
        if (held?.fraud_hold) return;
        const { drainSupplierQueue, ensureManualFulfillment } = await import('./fulfillmentService.js');
        await drainSupplierQueue(ctx);
        // Still nothing auto (no stock, no auto-supplier, e.g. a P2P top-up)?
        // Queue it for hand delivery so it never sits invisible.
        await ensureManualFulfillment(orderId, ctx);
      })
      .catch((e) => console.error('[autodispense]', e.message));
    // Paid spend may push the buyer into a new loyalty tier → grant its bonus.
    if (updated.userId) grantTierRewards(updated.userId).catch((e) => console.error('[loyalty]', e.message));
    // Earn Forge Coins (€10 = 1 coin), idempotent per order.
    if (updated.userId) awardCoinsForOrder(updated).catch((e) => console.error('[coins]', e.message));
    // Open any mystery boxes in the order → roll rewards, grant store credit.
    // A pure mystery-box order is fully delivered by that payout, so complete
    // it right away instead of leaving it in the manual-fulfillment queue.
    if (updated.userId) {
      settleMysteryForOrder(updated).then(async (won) => {
        if (!won.length) return;
        const kinds = await Promise.all(updated.items.map((it) =>
          get('SELECT kind FROM products WHERE id=@id', { id: it.product_id })));
        if (kinds.length && kinds.every((k) => k?.kind === 'mystery')) {
          await transitionOrder(orderId, 'completed',
            { force: true, reason: 'Mystery box opened — prize paid out as store credit' });
        }
      }).catch((e) => console.error('[mystery]', e.message));
    }
  }
  return updated;
}

/** If every item has enough pre-loaded stock, claim codes and complete the order.
 *  Products set to 'manual' delivery are never auto-dispensed — the whole order
 *  is left in the queue for staff to deliver by hand, even if codes are in stock. */
export async function autoDispenseFromStock(orderId, ctx = {}) {
  const order = await getOrder(orderId);
  if (!order || ['completed', 'refunded', 'cancelled'].includes(order.status)) return false;
  // A held order delivers nothing, automatically or otherwise.
  //
  // This single line is what the whole fraud score was missing. The score was
  // computed, stored, shown in the admin — and then the codes went out anyway,
  // because nothing between the payment and the delivery ever read it. Held
  // orders now wait for a person, and a digital code is the one thing where
  // waiting is still an option: it cannot be recalled once it has been read.
  if (order.fraudHold) {
    console.warn(`[autodispense] ${order.number} is held for review — not delivering`);
    return false;
  }
  // Direct account top-up is always hand-delivered — never auto-dispense a code.
  if (order.billing?.deliveryMethod === 'account') return false;
  for (const it of order.items) {
    const product = await getProduct(it.product_id);
    if (product?.deliveryMode === 'manual') return false; // owner hand-delivers this product
    if (await availableCount(it.product_id) < it.quantity) return false; // not enough stock → leave for manual
  }
  const deliveries = [];
  let short = null;
  for (const it of order.items) {
    const codes = await claimCodes(it.product_id, it.quantity, orderId);
    if (codes.length < it.quantity) { short = { it, got: codes.length }; break; }
    for (const c of codes) deliveries.push({ orderItemId: it.id, content: c, type: 'code' });
  }
  /* Half an order is not an order.

     The count above and the claim below are two separate reads, and claimCodes
     takes rows FOR UPDATE SKIP LOCKED — so two orders for two copies each,
     against three codes, both pass the availability check and one of them comes
     back with a single code. Before this, that order was delivered and marked
     completed: the buyer paid for two, received one, and the dashboard said
     fulfilled. Nothing anywhere would ever have shown it.

     So the claim result is the authority, not the count. Anything short goes
     back on the shelf and the whole order falls through to the queue, where a
     person delivers all of it. */
  if (short) {
    const freed = await releaseCodes(orderId).catch(() => 0);
    console.warn(`[autodispense] ${order.number}: only ${short.got}/${short.it.quantity} `
      + `code(s) available for ${short.it.name} — returned ${freed} to stock, leaving the order for manual delivery`);
    return false;
  }
  if (!deliveries.length) return false;
  // Re-read: claiming the codes above took time, and a refund or cancellation
  // landing in that window means these codes must go back on the shelf rather
  // than sit marked `used` against an order nobody will ever receive.
  const now = await getOrderRow(orderId);
  if (!now || ['refunded', 'cancelled'].includes(now.status)) {
    const freed = await releaseCodes(orderId).catch(() => 0);
    console.warn(`[autodispense] ${order.number} became ${now?.status} mid-delivery — returned ${freed} code(s) to stock`);
    return false;
  }
  await deliverOrder(orderId, deliveries, { ...ctx, reason: 'Auto-delivered from stock' });
  /* Stock just moved — walk the alert ladder for anything now running low.

     Awaited, not fired and forgotten. On a serverless platform the function can
     be frozen the moment the response is sent, which kills anything still in
     flight — and this is a webhook path, so the response goes out the instant
     delivery finishes. An unawaited alert here is an alert that sometimes never
     leaves the process, which is indistinguishable from not having the feature.

     Both are bounded and neither can throw: checkLowStock swallows its own
     errors, and the notifications inside it are budgeted per channel. The items
     go together rather than one after another — an order with several products
     should not pay for each of them in turn. */
  await Promise.all(order.items.map((it) => checkLowStock(it.product_id).catch(() => {})));
  return true;
}

/**
 * Abandoned-payment recovery: email a single reminder (with the pay links) for
 * orders that are still unpaid `afterMinutes` after checkout. One reminder per
 * order — reminder_sent_at is stamped BEFORE sending so a crash can never cause
 * duplicates. Runs from the hourly maintenance cron.
 */
export async function sendPaymentReminders({ afterMinutes = 60, maxAgeHours = 72, limit = 50 } = {}) {
  const newest = new Date(Date.now() - afterMinutes * 60_000).toISOString();
  const oldest = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString();
  const rows = await all(
    `SELECT id FROM orders
      WHERE status = 'pending' AND reminder_sent_at IS NULL
        AND created_at < @newest AND created_at > @oldest
      ORDER BY created_at ASC LIMIT @limit`,
    { newest, oldest, limit });

  let sent = 0;
  for (const row of rows) {
    // Claim the reminder atomically; if another cron run got here first, skip.
    const r = await run(
      `UPDATE orders SET reminder_sent_at = @at
        WHERE id = @id AND reminder_sent_at IS NULL AND status = 'pending'`,
      { at: nowIso(), id: row.id });
    if (!r?.changes) continue;
    const order = await getOrder(row.id);
    if (!order) continue;
    await sendEmailAsync('payment_reminder', order.email, emailContext(order));
    if (order.userId) {
      await notify(order.userId, {
        type: 'order_update', title: `Order ${order.number} is waiting for payment`,
        body: 'Complete your payment to receive your items — they are still reserved for you.',
        link: `/account/orders/${order.id}`,
      }).catch(() => {});
      /* And in Discord. This is revenue the shop has ALREADY won — an order
         placed and not yet paid — and it was chased on one channel, an inbox,
         for a customer who ordered from a Discord server. One reminder at sixty
         minutes and then silence until the fourteen-day auto-cancel. */
      const uid = await discordUidForUser(order.userId).catch(() => null);
      if (uid) {
        await postPaymentReminder(uid, {
          orderNumber: order.number,
          amount: order.totalFormatted || formatMoney(order.total, order.currency),
        }).catch(() => {});
      }
    }
    sent++;
  }
  return sent;
}

/**
 * Post-delivery review request: email a single "how was your order?" note for
 * orders completed `afterHours` ago that don't yet have a review. One per order
 * — review_request_sent_at is stamped BEFORE sending so a crash never duplicates
 * it. Runs from maintenance. The link lands the buyer straight on the review
 * widget for their order (works for guests too).
 */
export async function sendReviewRequests({ afterHours = 24, limit = 25 } = {}) {
  const cutoff = new Date(Date.now() - afterHours * 3_600_000).toISOString();
  const rows = await all(
    `SELECT o.id FROM orders o
      WHERE o.status = 'completed' AND o.review_request_sent_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.order_id = o.id)
        AND EXISTS (SELECT 1 FROM order_status_history h
                     WHERE h.order_id = o.id AND h.to_status = 'completed' AND h.created_at < @cutoff)
      ORDER BY o.updated_at ASC LIMIT @limit`,
    { cutoff, limit });

  let sent = 0;
  for (const row of rows) {
    // Claim atomically; if another run got here first, skip.
    const r = await run(
      `UPDATE orders SET review_request_sent_at = @at
        WHERE id = @id AND review_request_sent_at IS NULL AND status = 'completed'`,
      { at: nowIso(), id: row.id });
    if (!r?.changes) continue;
    const order = await getOrder(row.id);
    if (!order?.email) continue;
    await sendEmailAsync('review_request', order.email, {
      user: { name: order.billing?.full_name || order.email.split('@')[0] },
      order: { number: order.number },
      review: {
        url: `${config.appUrl}/track?number=${encodeURIComponent(order.number)}`,
        // A buyer who just clicked "leave a review" is the only person who will
        // ever write a second one. Rendered as an empty string when no profile
        // is configured, so the mail simply has one paragraph fewer.
        //
        // Points at the FORM, not the profile: this mail is an ask, and a
        // profile page makes them hunt for the button before they can start.
        trustpilotHtml: config.shop.trustpilotReviewUrl
          ? `<p style="text-align:center;color:#8b93a7;font-size:13px;margin-top:-6px">or leave it on
             <a href="${config.shop.trustpilotReviewUrl}" style="color:#f59e0b;font-weight:600">Trustpilot</a>
             — that one is public and we can't edit it.</p>`
          : '',
      },
    });

    /* And in Discord, for a buyer who linked it.
       This shop has zero reviews and its entire social-proof position rests on
       getting the first ones — and the ask went out on exactly one channel, to
       an inbox, for a customer who arrived through Discord, ordered through
       Discord and was delivered through Discord. The email still goes; this is
       the same ask where they already are. */
    if (order.userId) {
      const uid = await discordUidForUser(order.userId).catch(() => null);
      if (uid) {
        await postReviewRequest(uid, {
          orderNumber: order.number,
          productName: order.items?.length === 1 ? order.items[0].name : null,
        }).catch(() => {});
      }
    }
    sent++;
  }
  return sent;
}

/**
 * Attach a payment link with the exact amount already in it to one order.
 *
 * The shared link on the checkout page cannot carry an amount, so the buyer
 * types it themselves — and a wrong cent or a missing reference becomes the
 * owner reconciling payments by hand. A per-order link removes both.
 *
 * Only meaningful while the order is still unpaid: once money has arrived,
 * showing a pay button invites a second payment.
 */
export async function setOrderPayLink(orderId, rawUrl, ctx = {}) {
  const order = await getOrder(orderId);
  if (!order) throw notFound('Order not found');
  if (order.status !== 'pending') {
    throw badRequest(`Order ${order.number} is not waiting for payment (${order.statusLabel}).`);
  }
  const url = validatePayLink(rawUrl);
  await run('UPDATE orders SET pay_link=@u, pay_link_at=@at, updated_at=@at WHERE id=@id',
    { u: url, at: nowIso(), id: orderId });
  // Deliberately NOT in order_status_history: nothing about the order's state
  // changed, and the buyer's public timeline would show "Pending" twice. The
  // admin audit log records who attached it.
  // The buyer may be sitting on the status page right now — it polls, so this
  // arrives without them doing anything.
  if (order.userId) {
    await notify(order.userId, {
      type: 'order_update', title: `Payment link ready for ${order.number}`,
      body: 'Your payment link with the exact amount is ready.',
      link: `/account/orders/${orderId}`,
    }).catch(() => {});
  }
  return { ok: true, payLink: url, number: order.number };
}

/** Remove a payment link (wrong link pasted, or the order moved on). */
export async function clearOrderPayLink(orderId) {
  await run('UPDATE orders SET pay_link=NULL, pay_link_at=NULL, updated_at=@at WHERE id=@id',
    { at: nowIso(), id: orderId });
  return { ok: true };
}

export async function appendHistory(orderId, from, to, changedBy, reason) {
  await run(`INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, reason, created_at)
       VALUES (@id, @oid, @from, @to, @by, @reason, @at)`,
      { id: newId('osh'), oid: orderId, from, to, by: changedBy || 'system',
        reason: reason || null, at: nowIso() });
}

// ── Reads ──────────────────────────────────────────────────────────────────

function getOrderRow(id) { return get('SELECT * FROM orders WHERE id = @id', { id }); }

export async function getOrder(id) {
  const row = await getOrderRow(id);
  if (!row) return null;
  return hydrate(row);
}

export async function getOrderByNumber(number) {
  const row = await get('SELECT * FROM orders WHERE number = @n', { n: number });
  return row ? hydrate(row) : null;
}

async function hydrate(row) {
  const [items, history, deliveries] = await Promise.all([
    all('SELECT * FROM order_items WHERE order_id=@id', { id: row.id }),
    all('SELECT * FROM order_status_history WHERE order_id=@id ORDER BY created_at ASC', { id: row.id }),
    all('SELECT * FROM deliveries WHERE order_id=@id', { id: row.id }),
  ]);
  // Orders placed before the category snapshot existed still need their redeem
  // instructions, so fall back to the product's current category.
  const missing = items.filter((i) => i.product_id && !parse(i.metadata)?.category);
  const backfill = {};
  for (const id of [...new Set(missing.map((i) => i.product_id))]) {
    const p = await get('SELECT category FROM products WHERE id=@id', { id }).catch(() => null);
    if (p?.category) backfill[id] = p.category;
  }
  return {
    id: row.id, number: row.number, userId: row.user_id, email: row.email,
    status: row.status, statusLabel: labelFor(row.status),
    currency: row.currency, subtotal: row.subtotal, total: row.total,
    totalFormatted: formatMoney(row.total, row.currency),
    paymentStatus: row.payment_status, paymentRef: row.payment_ref,
    billing: parse(row.billing), fraudScore: row.fraud_score, fraudStatus: row.fraud_status,
    // Whether this order's delivery is stopped, and why. Read by auto-dispense,
    // by the buyer's status page and by the review queue — the same fact, so it
    // can never be true in one place and false in another.
    fraudHold: !!row.fraud_hold, fraudHoldReason: row.fraud_hold_reason || null,
    fraudReviewedAt: row.fraud_reviewed_at || null,
    ip: row.ip || null,
    notes: row.notes,
    // Per-order payment link with the exact amount already in it, when the
    // owner has pasted one. Public on purpose: the buyer needs to click it.
    payLink: row.pay_link || null, payLinkAt: row.pay_link_at || null,
    // The buyer's waiver of the 14-day withdrawal right. Written on creation but
    // never read back until now, which made it evidence nobody could produce:
    // in a chargeback the owner would have had to open the database by hand.
    // Surfaced on the order itself so the admin screen, the buyer's own status
    // page and the confirmation email all read the same record.
    consentAt: row.consent_at || null,
    consentText: row.consent_text || null,
    // Which PSP holds this payment. Needed by the admin refund (money has to go
    // back through the same rails it came in on) and by the buyer's status page.
    pspProvider: row.psp_provider || null,
    pspPaymentId: row.psp_payment_id || null,
    pspStatus: row.psp_status || null,
    // Resolved once, on the server: each configured method with the amount (and
    // where the provider allows it, the reference) already in the URL.
    payMethods: payMethodsFor(manualPayMethods(), {
      total: row.total, currency: row.currency, number: row.number,
    }),
    items: items.map((i) => {
      const metadata = parse(i.metadata) || {};
      if (!metadata.category && backfill[i.product_id]) metadata.category = backfill[i.product_id];
      return { ...i, metadata };
    }),
    history, deliveries,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// Whitelisted sort columns (never interpolate raw user input into SQL).
const SORT_COLUMNS = { date: 'created_at', amount: 'total', status: 'status', number: 'number' };

export async function listOrders({ status, statuses, userId, email, search, sort, dir, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = { limit, offset };
  if (status) { where.push('status = @status'); params.status = status; }
  // Multi-status filter (dashboard buckets span several internal statuses).
  const list = Array.isArray(statuses) ? statuses : (statuses ? String(statuses).split(',') : []);
  const clean = list.map((s) => s.trim()).filter((s) => STATUSES.includes(s));
  if (clean.length) {
    where.push(`status IN (${clean.map((_, i) => `@st${i}`).join(',')})`);
    clean.forEach((s, i) => { params[`st${i}`] = s; });
  }
  if (userId) { where.push('user_id = @userId'); params.userId = userId; }
  if (email) { where.push('email = @email'); params.email = String(email).toLowerCase(); }
  if (search) { where.push('(number ILIKE @q OR email ILIKE @q)'); params.q = `%${search}%`; }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const col = SORT_COLUMNS[sort] || 'created_at';
  const order = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const rows = await all(`SELECT * FROM orders ${clause} ORDER BY ${col} ${order}, created_at DESC
                    LIMIT @limit OFFSET @offset`, params);
  const totalRow = await get(`SELECT COUNT(*) AS n FROM orders ${clause}`, params);
  const orders = await Promise.all(rows.map((r) => summarize(r)));
  return { orders, total: totalRow.n };
}

/** Compact row for admin tables: id, customer, product, amount, date, status. */
async function summarize(row) {
  const items = await all('SELECT name, quantity FROM order_items WHERE order_id=@id', { id: row.id });
  const productLabel = items.length
    ? items[0].name + (items.length > 1 ? ` +${items.length - 1} more` : '')
    : '—';
  return {
    id: row.id, number: row.number, customer: row.email, userId: row.user_id,
    product: productLabel, itemCount: items.length,
    amount: row.total, amountFormatted: formatMoney(row.total, row.currency),
    currency: row.currency, status: row.status, statusLabel: labelFor(row.status),
    fraudStatus: row.fraud_status, fraudScore: row.fraud_score, fraudHold: !!row.fraud_hold,
    date: row.created_at,
  };
}

/**
 * Bookkeeping export: the (filtered) order list as CSV. Money is exported in
 * euros (decimal point) so it drops straight into a spreadsheet; per-order
 * discounts/credit are broken out of the billing snapshot.
 */
export async function exportOrdersCsv({ status, statuses, search, from, to } = {}) {
  const where = [];
  const params = {};
  if (status) { where.push('status = @status'); params.status = status; }
  const list = Array.isArray(statuses) ? statuses : (statuses ? String(statuses).split(',') : []);
  const clean = list.map((s) => s.trim()).filter((s) => STATUSES.includes(s));
  if (clean.length) {
    where.push(`status IN (${clean.map((_, i) => `@st${i}`).join(',')})`);
    clean.forEach((s, i) => { params[`st${i}`] = s; });
  }
  if (search) { where.push('(number ILIKE @q OR email ILIKE @q)'); params.q = `%${search}%`; }
  if (from) { where.push('created_at >= @from'); params.from = new Date(from).toISOString(); }
  if (to) { where.push('created_at <= @to'); params.to = new Date(to).toISOString(); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await all(`SELECT * FROM orders ${clause} ORDER BY created_at ASC LIMIT 10000`, params);

  const eur = (cents) => (Number(cents || 0) / 100).toFixed(2);
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['order_number', 'date', 'customer_email', 'status', 'payment_status',
    'payment_ref', 'currency', 'subtotal_eur', 'discount_eur', 'store_credit_eur',
    'total_eur', 'coupon', 'items'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const billing = parse(r.billing);
    const items = await all('SELECT name, quantity FROM order_items WHERE order_id=@id', { id: r.id });
    const discount = (billing.discount || 0) + (billing.memberDiscount || 0) + (billing.bundleDiscount || 0);
    lines.push([
      cell(r.number), cell(r.created_at), cell(r.email), cell(r.status),
      cell(r.payment_status), cell(r.payment_ref), cell(r.currency),
      eur(r.subtotal), eur(discount), eur(billing.creditApplied || 0), eur(r.total),
      cell(billing.coupon || ''), cell(items.map((i) => `${i.name} x${i.quantity}`).join(' | ')),
    ].join(','));
  }
  return '\ufeff' + lines.join('\n'); // BOM so Excel detects UTF-8
}

export async function markPaymentReceived(orderId, paymentRef, ctx = {}) {
  if (paymentRef) await run('UPDATE orders SET payment_ref=@r WHERE id=@id', { r: paymentRef, id: orderId });
  const result = await transitionOrder(orderId, 'payment_received', { ...ctx, reason: ctx.reason || 'Payment received' });
  // Record an affiliate commission if this buyer was referred (best-effort).
  try { await recordOrderCommission(await getOrder(orderId)); } catch { /* non-fatal */ }
  return result;
}

/**
 * Remember which PSP payment belongs to this order.
 *
 * Written when the payment is CREATED, not when it succeeds: resuming an
 * abandoned checkout and issuing a refund both need the id long before any
 * money has moved. Fields are updated individually so a webhook that only knows
 * the status cannot wipe the checkout URL a buyer still needs.
 */
export async function setPspPayment(orderId, { provider, paymentId, status, checkoutUrl } = {}) {
  const sets = ['updated_at=@at'];
  const params = { id: orderId, at: nowIso() };
  if (provider) { sets.push('psp_provider=@prov'); params.prov = provider; }
  if (paymentId) { sets.push('psp_payment_id=@pid'); params.pid = paymentId; }
  if (status) { sets.push('psp_status=@st'); params.st = status; }
  if (checkoutUrl !== undefined) { sets.push('psp_checkout_url=@url'); params.url = checkoutUrl || null; }
  await run(`UPDATE orders SET ${sets.join(', ')} WHERE id=@id`, params);
}

/** The PSP payment behind an order, for refunds and for resuming a checkout. */
export async function getPspPayment(orderId) {
  const r = await get(
    'SELECT psp_provider, psp_payment_id, psp_status, psp_checkout_url FROM orders WHERE id=@id',
    { id: orderId });
  if (!r?.psp_payment_id) return null;
  return { provider: r.psp_provider, paymentId: r.psp_payment_id,
           status: r.psp_status, checkoutUrl: r.psp_checkout_url };
}

// ── Fraud review ───────────────────────────────────────────────────────────

/**
 * Approve a held order: release it and deliver.
 *
 * The hold is cleared first and the delivery attempted after, in that order —
 * `deliverOrder` and `autoDispenseFromStock` both refuse a held order, so doing
 * it the other way round would have staff clicking approve and nothing
 * happening. Who approved it and when are kept: if this order charges back
 * later, that decision is the thing worth being able to look back at.
 */
export async function releaseFraudHold(orderId, ctx = {}) {
  const order = await getOrder(orderId);
  if (!order) throw notFound('Order not found');
  if (!order.fraudHold) return { order, alreadyReleased: true };

  await run(
    `UPDATE orders SET fraud_hold=0, fraud_status='ok', fraud_reviewed_at=@at,
            fraud_reviewed_by=@by, updated_at=@at WHERE id=@id`,
    { at: nowIso(), by: ctx.actorId || 'staff', id: orderId });

  await audit({
    actor: ctx.user || { id: ctx.actorId || 'staff', email: ctx.actorId || 'staff' },
    action: 'order.fraud_released', targetType: 'order', targetId: orderId,
    metadata: { score: order.fraudScore, reason: ctx.reason || null },
  }).catch(() => {});

  // Only if the money is already in. Approving an unpaid order just means it may
  // proceed normally once it is paid — the usual payment path picks it up.
  let delivered = false;
  if (!['pending', 'refunded', 'cancelled', 'failed', 'completed'].includes(order.status)) {
    delivered = await autoDispenseFromStock(orderId, { ...ctx, reason: 'Released after fraud review' })
      .catch((e) => { console.error('[fraud] release dispense:', e.message); return false; });
  }
  return { order: await getOrder(orderId), delivered };
}

/**
 * Reject a held order: refund it and keep the hold.
 *
 * The hold stays deliberately. It is the record that this order was stopped on
 * purpose, and a refunded order can no longer be delivered anyway — clearing it
 * would only make the queue look tidier while losing why it was there.
 *
 * The refund itself goes through the caller, because sending money back is a PSP
 * operation and this module does not talk to a PSP.
 */
export async function rejectFraudHold(orderId, ctx = {}) {
  const order = await getOrder(orderId);
  if (!order) throw notFound('Order not found');

  await run(
    `UPDATE orders SET fraud_status='block', fraud_reviewed_at=@at, fraud_reviewed_by=@by,
            fraud_hold_reason=@r, updated_at=@at WHERE id=@id`,
    { at: nowIso(), by: ctx.actorId || 'staff',
      r: (ctx.reason || order.fraudHoldReason || 'Rejected in fraud review').slice(0, 500), id: orderId });

  await audit({
    actor: ctx.user || { id: ctx.actorId || 'staff', email: ctx.actorId || 'staff' },
    action: 'order.fraud_rejected', targetType: 'order', targetId: orderId,
    metadata: { score: order.fraudScore, reason: ctx.reason || null },
  }).catch(() => {});

  return getOrder(orderId);
}

export async function setOrderNotes(orderId, notes) {
  await run('UPDATE orders SET notes=@n, updated_at=@at WHERE id=@id',
      { n: notes, at: nowIso(), id: orderId });
  return getOrder(orderId);
}

// ── Presentation helpers ───────────────────────────────────────────────────

export function labelFor(status) {
  return {
    pending: 'Pending',
    payment_received: 'Payment Received',
    processing: 'Processing',
    awaiting_fulfillment: 'Awaiting Fulfillment',
    completed: 'Completed',
    refunded: 'Refunded',
    cancelled: 'Cancelled',
    failed: 'Failed',
  }[status] || status;
}

/**
 * What the buyer is told, in words they can act on.
 *
 * "Your order is awaiting fulfillment" is what the database calls it, not what
 * happened. A buyer reading that has no idea whether something went wrong, what
 * comes next, or whether they need to do anything — and this is the status an
 * order lands in whenever it cannot be auto-delivered, which now includes the
 * case where stock ran out between the check and the claim. So it says what is
 * actually going on: a person is getting it, and it arrives by email.
 */
function statusBlurb(status) {
  return {
    payment_received: 'We confirmed your payment and are preparing your order.',
    processing: 'Your order is being processed — we will email you the moment it is ready.',
    awaiting_fulfillment:
      'We are getting this one for you by hand. It arrives by email, usually within a few hours during the day; orders placed late at night go out first thing in the morning.',
    completed: 'Your order is complete — check your deliveries & downloads.',
    refunded: 'A refund has been issued for your order.',
    cancelled: 'Your order has been cancelled.',
  }[status] || `Order status: ${labelFor(status)}`;
}

/** Build an email-safe HTML summary table of the order's line items + total. */
/**
 * The buyer's own record of waiving the 14-day withdrawal right.
 *
 * Storing the waiver server-side covers the shop in a dispute, but EU distance
 * selling also requires the trader to CONFIRM the agreement to the consumer on a
 * durable medium — the consent to immediate performance and the acknowledgement
 * that the right lapses included. An email is that medium; a checkbox that only
 * ever existed on a page they have since closed is not.
 *
 * Quoted back verbatim, with the timestamp, so what the buyer keeps and what the
 * shop can produce are the same sentence.
 */
function consentHtml(order, lang) {
  const c = emailCopy(lang);
  if (!order.consentAt) return '';
  const when = new Date(order.consentAt);
  const stamp = Number.isNaN(when.getTime()) ? '' : when.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const sentence = String(order.consentText || '').trim();
  const escaped = sentence
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<p style="color:#8b93a7;font-size:12px;line-height:1.6;margin-top:18px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08)">
    <strong style="color:#b6c1d1">${escapeHtml(c.withdrawalTitle)}</strong><br>
    ${escaped ? `${c.withdrawalConfirmed(stamp, escaped)}<br>` : `${c.withdrawalDefault(stamp)}<br>`}
    ${escapeHtml(c.withdrawalCancel)}</p>`;
}

/**
 * The one thing we still need from the buyer, asked where they will read it.
 *
 * A Robux order goes onto an account, and until we know which account it can
 * only sit in the queue. The product page says to send the username "in je
 * bestelling of via een ticket"; when the order carries neither, this asks for
 * it in the confirmation mail — which is the message every buyer opens — so the
 * order resolves itself instead of waiting for somebody to notice it.
 */
function needsFromBuyerHtml(order, lang) {
  const c = emailCopy(lang);
  const need = String(order.billing?.needsFromBuyer || '').trim();
  if (!need) return '';
  const settled = ['completed', 'refunded', 'cancelled'].includes(order.status);
  if (settled) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 4px">
    <tr><td style="background-color:#241d09;border:1px solid #6b5115;border-radius:14px;padding:16px 18px">
      <div style="font:700 14px/1.35 'Segoe UI',Arial,sans-serif;color:#fbbf24">${escapeHtml(c.needTitle)}</div>
      <div style="font:400 13.5px/1.6 'Segoe UI',Arial,sans-serif;color:#d8c9a3;padding-top:6px">
        ${c.needBody(escapeHtml(need))}
      </div>
    </td></tr></table>`;
}

/** Manual-payment instructions block for the order-received email (Tikkie/Revolut/PayPal). */
function paymentInstructionsHtml(order, lang) {
  const c = emailCopy(lang);
  const methods = manualPayMethods();
  const settled = ['completed', 'refunded', 'cancelled', 'payment_received'].includes(order.status);
  if (settled) return '';
  // A per-order link stands on its own: it must still reach the buyer when no
  // generic method is configured, which is exactly the case while the owner is
  // between payment providers.
  if (!methods.length && !order.payLink) return '';
  const amt = formatMoney(order.total, order.currency);

  // A payment request the owner made for THIS order already carries the amount
  // and needs no reference — so it goes first, and the generic methods below
  // become the fallback rather than the instruction.
  const exact = order.payLink
    ? `<div class="quote"><strong>${escapeHtml(c.payExact(amt))}</strong><br>` +
      `<a href="${escapeHtml(order.payLink)}">${escapeHtml(String(order.payLink).replace(/^https?:\/\//, '').slice(0, 60))}</a>` +
      `</div>`
    : '';
  const rows = payMethodsFor(methods, order).map((m) => {
    if (m.kind === 'email') {
      return `<tr><td><strong>${m.label}</strong></td><td class="r">${escapeHtml(c.paySendTo(amt, m.target))}</td></tr>`;
    }
    // Saying which links already carry the amount is the difference between a
    // buyer tapping once and a buyer typing a number wrong.
    const note = m.prefilled ? ` <span style="color:#34d399">· ${escapeHtml(c.payPrefilled)}</span>` : '';
    return `<tr><td><strong>${m.label}</strong>${note}</td><td class="r">` +
      `<a href="${m.url}">${escapeHtml(String(m.url).replace(/^https?:\/\//, ''))}</a></td></tr>`;
  }).join('');
  if (!methods.length) return exact;   // only the exact-amount link to show
  return exact +
    `<div class="quote"><strong>${escapeHtml(exact ? c.payOr : c.payComplete)} — ${amt}</strong><br>` +
    `${c.payHow(escapeHtml(order.number))}</div>` +
    `<table class="summary"><tbody>${rows}</tbody></table>`;
}

/* The redeem instructions and every other phrase these blocks need moved to
   emailCopy.js when the emails became multilingual. They lived here as one
   hardcoded Dutch table, which would have put Dutch redeem steps inside a
   German email — the templates translated and the generated half not. */

function redeemHtml(order, lang) {
  const c = emailCopy(lang);
  // Account top-ups have nothing to redeem — we already did it for them.
  if (order.billing?.deliveryMethod === 'account' && order.billing?.deliveryDetails) return '';
  if (!order.deliveries?.length) return '';

  // One block per distinct category in the order, so a mixed order (Robux +
  // a Steam card) explains both instead of guessing at one.
  const cats = [...new Set((order.items || []).map((i) => String(i.metadata?.category || i.category || '').toLowerCase()).filter(Boolean))];
  const recipes = cats.map((cat) => redeemSteps(lang, cat)).filter(Boolean);
  const list = recipes.length ? recipes : [redeemFallback(lang)];

  return list.map((r) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0">
      <tr><td style="background-color:#141426;border:1px solid #2c2c48;border-radius:14px;padding:16px 18px">
        <div style="font:700 14px/1.3 'Segoe UI',Arial,sans-serif;color:#ffffff">${r.icon} ${escapeHtml(r.title)}</div>
        <div style="font:400 12.5px/1.6 'Segoe UI',Arial,sans-serif;color:#8b8fa3;padding-top:3px">${escapeHtml(c.redeemAt)} ${escapeHtml(r.where)}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:11px">
          ${r.steps.map((s, n) => `<tr>
            <td valign="top" style="padding:3px 9px 3px 0"><span style="display:inline-block;width:19px;height:19px;background-color:#26264a;border-radius:999px;color:#c7d2fe;font:700 11px/19px Arial,sans-serif;text-align:center">${n + 1}</span></td>
            <td style="padding:3px 0;font:400 13.5px/1.55 'Segoe UI',Arial,sans-serif;color:#b9bfcd">${s}</td>
          </tr>`).join('')}
        </table>
      </td></tr>
    </table>`).join('');
}

/** The hero block of the completion email: a green "delivered to your account"
 *  confirmation for direct top-ups, otherwise premium copyable code cards. All
 *  styles are inline so it renders intact even where a client strips <style>. */
function deliveryHtml(order, lang) {
  const c = emailCopy(lang);
  // Direct account top-up → reassuring confirmation, no code to show.
  if (order.billing?.deliveryMethod === 'account' && order.billing?.deliveryDetails) {
    const label = escapeHtml(order.billing.deliveryLabel || c.yourAccount);
    const target = escapeHtml(order.billing.deliveryDetails);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px">
      <tr><td style="background:#0e1f19;border:1px solid #1f5140;border-radius:16px;padding:20px 22px">
        <div style="font:800 15px/1.3 'Segoe UI',Arial,sans-serif;color:#34d399">${escapeHtml(c.deliveredTitle)}</div>
        <div style="font:400 13.5px/1.6 'Segoe UI',Arial,sans-serif;color:#9fb8ad;margin:6px 0 12px">${escapeHtml(c.deliveredSub)}</div>
        <div style="font:600 11px/1 Arial,sans-serif;color:#6f8f83;text-transform:uppercase;letter-spacing:1.2px;margin:0 0 5px">${label}</div>
        <div style="font:700 18px/1.3 'Courier New',monospace;color:#eafff6;background:#0a1712;border:1px solid #1f5140;border-radius:10px;padding:12px 16px;word-break:break-all">${target}</div>
      </td></tr></table>`;
  }
  // Gift-code / key delivery → one premium card per delivered item.
  if (!order.deliveries?.length) return '';
  return order.deliveries.map((d) => {
    const label = escapeHtml((d.type || 'code').toUpperCase());
    const value = d.content ? escapeHtml(d.content) : (d.filename ? escapeHtml(d.filename) : '—');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px">
      <tr><td style="height:4px;background:linear-gradient(90deg,#7c5cff,#d946ef);border-radius:14px 14px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>
      <tr><td style="background:#17172a;border:1px solid #34345a;border-top:0;border-radius:0 0 14px 14px;padding:16px 18px 18px">
        <div style="font:700 11px/1 Arial,sans-serif;color:#8b8fa3;text-transform:uppercase;letter-spacing:1.4px;margin:0 0 9px">${label}</div>
        <div style="font:800 24px/1.25 'Courier New',monospace;letter-spacing:4px;color:#ffffff;word-break:break-all">${value}</div>
      </td></tr></table>`;
  }).join('');
}

/** Order breakdown for the emails: subtotal, each discount, store credit, total.
 *  Without this the line-item (list price) and the final total look mismatched
 *  whenever a coupon/member/bundle discount or store credit was applied. */
function summaryHtml(order, lang) {
  const c = emailCopy(lang);
  const cur = order.currency;
  const b = order.billing || {};
  const money = (c) => escapeHtml(formatMoney(c, cur));
  const rows = [];
  for (const i of order.items || []) {
    rows.push(`<tr><td style="padding:9px 0;border-bottom:1px solid #24243a;color:#cbd1de;font-size:14px">${escapeHtml(i.name)} <span style="color:#8b8fa3">× ${i.quantity}</span></td>` +
      `<td style="padding:9px 0;border-bottom:1px solid #24243a;color:#fff;font-size:14px;text-align:right;white-space:nowrap">${money(i.unit_price * i.quantity)}</td></tr>`);
  }
  const line = (label, cents, neg = false) => `<tr><td style="padding:8px 0;border-bottom:1px solid #24243a;color:#9aa3b8;font-size:13.5px">${label}</td>` +
    `<td style="padding:8px 0;border-bottom:1px solid #24243a;font-size:13.5px;text-align:right;white-space:nowrap;color:${neg ? '#34d399' : '#cbd1de'}">${neg ? '−' : ''}${money(cents)}</td></tr>`;
  const couponDiscount = Number(b.discount || 0);
  const memberDiscount = Number(b.memberDiscount || 0);
  const bundleDiscount = Number(b.bundleDiscount || 0);
  const credit = Number(b.creditApplied || 0);
  const extras = [];
  if (order.subtotal != null && (couponDiscount || memberDiscount || bundleDiscount || credit)) {
    extras.push(line(c.subtotal, order.subtotal));
    if (couponDiscount) extras.push(line(`${c.coupon}${b.coupon ? ` (${escapeHtml(b.coupon)})` : ''}`, couponDiscount, true));
    if (memberDiscount) extras.push(line(`${c.memberOff}${b.memberPercent ? ` (${b.memberPercent}%)` : ''}`, memberDiscount, true));
    if (bundleDiscount) extras.push(line(`${c.bundle}${b.bundle ? ` (${escapeHtml(b.bundle)})` : ''}`, bundleDiscount, true));
    if (credit) extras.push(line(c.credit, credit, true));
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:2px 0 20px">` +
    `<tbody>${rows.join('')}${extras.join('')}` +
    `<tr><td style="padding:13px 0 0;border-top:2px solid #34345a;color:#fff;font-weight:800;font-size:15px">${escapeHtml(c.total)}</td>` +
    `<td style="padding:13px 0 0;border-top:2px solid #34345a;color:#fff;font-weight:800;font-size:15px;text-align:right;white-space:nowrap">${money(order.total)}</td></tr>` +
    `</tbody></table>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Where this customer can actually see their order.
 *
 * The dashboard requires an account. Most orders are placed as a guest, so
 * pointing every email at /account/orders/<id> sent the majority of buyers to a
 * login wall right when they wanted to know where their code was. Guests get the
 * public track page pre-filled with their order number instead — same status,
 * same live updates, no account.
 */
export function orderUrlFor(order) {
  return order?.userId
    ? `${config.appUrl}/account/orders/${order.id}`
    : `${config.appUrl}/track?number=${encodeURIComponent(order?.number || '')}`;
}

function emailContext(order, ctx = {}) {
  /* The language this buyer read the shop in, recorded at checkout. Resolved
     once here and handed to every generated block, so the prose in a German
     email and the order summary inside it cannot end up in different
     languages — which is what would have happened if each generator asked
     separately and one of them forgot. */
  const lang = order.billing?.lang || 'nl';
  return {
    lang,
    user: { name: order.billing?.full_name || order.email.split('@')[0] },
    order: {
      lang,
      number: order.number,
      total: order.totalFormatted,
      status: order.statusLabel,
      // `itemsHtml` now renders the FULL breakdown (subtotal, discounts, credit,
      // total) so the line-item price and the final total never look mismatched.
      itemsHtml: summaryHtml(order, lang),
      summaryHtml: summaryHtml(order, lang),
      deliveryHtml: deliveryHtml(order, lang),
      deliveriesHtml: deliveryHtml(order, lang), // back-compat alias for older templates
      redeemHtml: redeemHtml(order, lang),
      paymentHtml: paymentInstructionsHtml(order, lang),
      consentHtml: consentHtml(order, lang),
      needsFromBuyerHtml: needsFromBuyerHtml(order, lang),
      url: orderUrlFor(order),
    },
    refund: ctx.refundAmount != null
      ? { amount: formatMoney(ctx.refundAmount, order.currency) }
      : { amount: order.totalFormatted },
  };
}

/** Render a transactional order email to { subject, html } — used by previews
 *  and tests to verify the real rendered output without sending anything. */
export async function renderOrderEmail(orderId, eventKey = 'order_completed', ctx = {}) {
  const order = await getOrder(orderId);
  if (!order) return null;
  /* The buyer's own language, same resolution the send path uses.
     This selected on `id` alone, which after templates became per-language
     meant it picked whichever row Postgres returned first — so a preview, and
     the admin's own "what did this buyer get?" view, could show a different
     language from the mail that was actually sent. */
  const lang = order.billing?.lang || 'nl';
  const tpl = await get('SELECT * FROM email_templates WHERE id = @id AND lang = @lang',
    { id: eventKey, lang })
    || await get('SELECT * FROM email_templates WHERE id = @id AND lang = @nl',
      { id: eventKey, nl: 'nl' });
  if (!tpl) return null;
  return renderTemplate(tpl, baseContext(emailContext(order, ctx)));
}
