import { Zap, Clock, PackageCheck, ShieldCheck, MessageCircle, BadgeCheck, User, Wallet } from 'lucide-react';

/**
 * Stock and delivery, stated in a way the shop can keep.
 *
 * The buy area used to say "Delivery: as fast as possible" — a non-answer in a
 * green pill with a lightning bolt, rendered for every product regardless of
 * whether a code existed. For a shop where a person confirms every payment by
 * hand, that is the exact question a buyer needs answered honestly before they
 * transfer money to a stranger.
 *
 * Everything here is derived from fields the server already computes:
 *   instant      true only when the product auto-delivers AND a code is in stock
 *   deliveryMode 'manual' means a person fulfils it, always
 *   stockLeft    the real count, but only when it is 1-6 (the server hides
 *                exact inventory otherwise, deliberately)
 *   deliveryField set when the buyer has to supply a target (a Roblox username)
 */

/** @returns {{key, label, detail, tone}} — one stock signal, never two. */
export function stockStatus(product, t, orderingPaused = false) {
  const low = typeof product.stockLeft === 'number' && product.stockLeft > 0;

  /* The shop cannot honour an order at all — no payment method configured, or
     the launch gate is closed. /api/config has carried this flag all along, and
     its own comment says the point is "so the storefront can say so up front
     instead of letting someone fill a cart and hit a wall at the last step".
     Only Checkout read it. So the product page showed "Available to order"
     above a working Buy button, and the buyer found out three screens later.
     It outranks every other stock signal, so it is checked first. */
  if (orderingPaused) {
    return {
      key: 'paused',
      label: t('pd.stockPaused', 'Not taking orders right now'),
      detail: t('pd.stockPausedSub', 'You can still put this in your basket and read up on it — checkout will tell you the moment it reopens.'),
      tone: 'amber',
    };
  }

  if (product.instant) {
    return {
      key: low ? 'low' : 'inStock',
      label: low
        ? (product.stockLeft === 1
          ? t('pd.stockLast', 'Last one in stock')
          : t('pd.stockLow', 'Only {n} left in stock', { n: product.stockLeft }))
        : t('pd.stockIn', 'In stock'),
      detail: t('pd.stockInSub', 'Sent automatically the moment your payment is confirmed.'),
      // Low stock is urgent but not alarming: it is a real number, not a
      // manufactured countdown, so it gets amber rather than red.
      tone: low ? 'amber' : 'emerald',
    };
  }

  // Not "out of stock": nothing is unavailable, it is bought in per order. That
  // distinction is the difference between a buyer leaving and a buyer waiting.
  return {
    key: 'toOrder',
    label: t('pd.stockToOrder', 'Available to order'),
    detail: t('pd.stockToOrderSub', 'Bought in for you and delivered by hand after your payment is confirmed.'),
    tone: 'sky',
  };
}

/**
 * The honest estimate.
 *
 * Both branches are bounded by the same real constraint — a person matches the
 * payment — so neither promises a clock the shop does not control.
 */
export function deliveryEstimate(product, t) {
  return product.instant
    ? {
      icon: Zap,
      headline: t('pd.etaInstantT', 'Sent automatically after payment'),
      body: t('pd.etaInstant', 'Your code is already here. Payments are matched by a person, so confirmation is fastest during the day — and the code goes out by itself the second that happens.'),
      tone: 'emerald',
    }
    : {
      icon: Clock,
      headline: t('pd.etaHandT', 'Delivered by hand, usually within a few hours'),
      body: t('pd.etaHand', 'We buy this in for you once your payment is confirmed. During the day that is normally a few hours; if you order late at night it goes out first thing in the morning.'),
      tone: 'sky',
    };
}

const TONES = {
  emerald: 'text-emerald-800 bg-emerald-50 border-emerald-200',
  amber: 'text-amber-800 bg-amber-50 border-amber-200',
  sky: 'text-sky-800 bg-sky-50 border-sky-200',
};
const DOTS = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', sky: 'bg-sky-500' };

/**
 * The compact block that sits with the price and the buy button — the three
 * facts a buyer weighs at the moment of deciding, without scrolling.
 */
export function DeliveryFacts({ product, t, orderingPaused = false }) {
  const stock = stockStatus(product, t, orderingPaused);
  const eta = deliveryEstimate(product, t);
  const Icon = eta.icon;

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className={`flex items-center gap-2.5 px-4 py-2.5 border-b ${TONES[stock.tone]}`}>
        <span className={`w-2 h-2 rounded-full shrink-0 ${DOTS[stock.tone]}`} />
        <span className="font-bold text-[14px]">{stock.label}</span>
      </div>

      <div className="px-4 py-3.5">
        <div className="flex items-start gap-3">
          <Icon size={17} className="text-slate-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="font-semibold text-slate-900 text-[14px]">{eta.headline}</div>
            <p className="text-[13px] text-slate-600 mt-0.5 leading-relaxed">{eta.body}</p>
          </div>
        </div>

        {/* What the buyer has to supply. Asked for at checkout either way, but
            saying so here stops the surprise that makes people abandon the form. */}
        {product.deliveryField && (
          <div className="flex items-start gap-3 mt-3 pt-3 border-t border-slate-100">
            <User size={17} className="text-slate-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 text-[14px]">
                {t('pd.needT', 'We will ask for your {n}', { n: product.deliveryField })}
              </div>
              <p className="text-[13px] text-slate-600 mt-0.5 leading-relaxed">
                {product.deliveryChoice
                  ? t('pd.needChoice', 'Or pick a gift code at checkout and redeem it yourself — your call.')
                  : t('pd.need', 'You enter it at checkout. We never ask for your password.')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Trust indicators, on the row a buyer reads last before tapping.
 *
 * Every one is a policy or a mechanism that holds on day one — deliberately
 * nothing that depends on order volume, because this shop has none yet and an
 * empty statistic is worse than no statistic.
 */
export function TrustRow({ t }) {
  /* The row led with "money back if we cannot deliver" and never mentioned the
     thing that actually removes the risk of pressing Buy: nothing is charged
     until the buyer chooses to transfer it. On a shop that takes bank transfers
     from strangers that is the strongest sentence available, and it was on the
     homepage and not here — where the decision is made. */
  const items = [
    { icon: Wallet, label: t('pd.tPayAfter', 'You pay after ordering — nothing is charged automatically') },
    { icon: ShieldCheck, label: t('pd.tMoneyBack', 'Money back if we cannot deliver') },
    { icon: PackageCheck, label: t('pd.tNoAccount', 'No account needed to order') },
    { icon: BadgeCheck, label: t('pd.tVerified', 'Reviews tied to real orders') },
    { icon: MessageCircle, label: t('pd.tHuman', 'A real person answers') },
  ];
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4">
      {items.map(({ icon: Icon, label }, i) => (
        // Five items in two columns leaves an orphan, so the first — the one
        // that answers "what am I risking by pressing Buy" — takes the full row.
        <li key={label} className={`flex items-start gap-2 text-[12.5px] ${
          i === 0 ? 'col-span-2 font-semibold text-slate-800' : 'text-slate-600'}`}>
          <Icon size={14} className="text-emerald-600 shrink-0 mt-0.5" />
          <span className="leading-snug">{label}</span>
        </li>
      ))}
    </ul>
  );
}
