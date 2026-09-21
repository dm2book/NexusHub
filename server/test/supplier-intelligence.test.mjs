/**
 * Every supplier for a product, side by side — and the discipline underneath it.
 *
 * The comparison itself is arithmetic. What this file is mostly about is the
 * three places a dashboard like this normally starts lying:
 *
 *   · a supplier with no fulfilment history has NO reliability. Not 100%. A
 *     brand-new supplier that has never failed has also never succeeded, and
 *     rendering that as a perfect score is how it wins a comparison it has not
 *     earned.
 *   · a mapping with no cost has NO margin. Not 0%, which sorts like the worst
 *     supplier in the list, and not 100%, which sorts like the best.
 *   · `best` is a RECOMMENDATION and `routed` is what will actually happen
 *     tonight — routing goes on `priority ASC`, a number somebody typed once.
 *     Where they disagree the row has to say so, because that gap is the only
 *     reason to open this page.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

import {
  offerRow, chooseBest, isDeliverable, intelligenceWarnings,
} from '../src/services/supplier/supplierIntelligenceService.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const CFG = {
  vatPercent: 0, pricesIncludeVat: true, paymentFeePercent: 2.9, paymentFixedFee: 0.35,
  fulfillmentCostEur: 0, sourceCostPercent: 0, minimumMarginPercent: 6,
};

/** A mapping row shaped the way the join hands one over. */
const mapping = (over = {}) => ({
  supplier_id: 's1', supplier_name: 'Kinguin', connector_kind: 'kinguin',
  supplier_status_row: 'active', sku_status: 'in_stock', supplier_sku: 'K-1',
  cost: 700, available_stock: 40, priority: 100, last_synced_at: new Date().toISOString(),
  ...over,
});
const offer = (over = {}, metrics = {}) =>
  ({ ...offerRow(mapping(over), { priceCents: 999, metrics, cfg: CFG }), deliverable: true,
    ...(over.__patch || {}) });

console.log('\n— Every number the decision needs, per supplier —');
{
  const o = offerRow(mapping(), { priceCents: 999, cfg: CFG,
    metrics: { fulfilled: 18, failed: 2, avgFulfillSeconds: 45 } });
  ok('name, kind and SKU', o.supplierName === 'Kinguin' && o.kind === 'kinguin' && o.supplierSku === 'K-1');
  ok('buy price', o.costCents === 700);
  ok('stock', o.stock === 40);
  ok('lead time is measured, not configured', o.leadSeconds === 45);
  ok('reliability is fulfilled over attempts', o.reliabilityPct === 90, String(o.reliabilityPct));
  ok('fulfilment rate rides along', o.fulfilmentRate === 90 && o.attempts === 20);
  ok('margin comes off the real price', o.marginPct != null && o.marginPct > 0, String(o.marginPct));
  ok('and profit per sale is a euro figure', o.profitPerSaleEur > 0, String(o.profitPerSaleEur));
}

console.log('\n— Unknown is not a score —');
{
  const fresh = offerRow(mapping(), { priceCents: 999, cfg: CFG, metrics: {} });
  ok('a supplier that has never delivered has no reliability',
    fresh.reliabilityPct === null, String(fresh.reliabilityPct));
  ok('…and no lead time', fresh.leadSeconds === null);
  ok('…and it is not silently perfect', fresh.reliabilityPct !== 100);

  const noCost = offerRow(mapping({ cost: null }), { priceCents: 999, cfg: CFG, metrics: {} });
  ok('a mapping with no cost has no margin', noCost.marginPct === null);
  ok('…and no profit figure', noCost.profitPerSaleEur === null);

  const noStock = offerRow(mapping({ available_stock: null }), { priceCents: 999, cfg: CFG });
  ok('stock never reported is unknown, not zero', noStock.stock === null);
  ok('…and unknown stock can still take an order', isDeliverable(
    { supplierStatus: 'active', skuStatus: 'in_stock', stock: null }));
}

console.log('\n— Who can actually take an order —');
{
  ok('a paused supplier cannot', !isDeliverable({ supplierStatus: 'paused', stock: 5 }));
  ok('an out-of-stock SKU cannot', !isDeliverable(
    { supplierStatus: 'active', skuStatus: 'out_of_stock', stock: 5 }));
  ok('zero stock cannot', !isDeliverable({ supplierStatus: 'active', skuStatus: 'in_stock', stock: 0 }));
  ok('an active, stocked one can', isDeliverable(
    { supplierStatus: 'active', skuStatus: 'in_stock', stock: 3 }));
}

console.log('\n— Choosing, and refusing to choose —');
{
  const cheap = offer({ supplier_id: 'a', supplier_name: 'Kinguin', cost: 650 }, { fulfilled: 10, failed: 0 });
  const dear = offer({ supplier_id: 'b', supplier_name: 'G2A', cost: 800 }, { fulfilled: 10, failed: 0 });
  const pick = chooseBest([cheap, dear], { cfg: CFG });
  ok('the cheaper deliverable supplier wins', pick.bestSupplierId === 'a', pick.reason);
  ok('…and the reason names the saving', /cheaper than the next/.test(pick.reason), pick.reason);

  /* Cheap and unreliable is not cheap. */
  const flaky = offer({ supplier_id: 'c', supplier_name: 'Eldorado', cost: 500 },
    { fulfilled: 4, failed: 6 });
  const solid = offer({ supplier_id: 'd', supplier_name: 'Kinguin', cost: 700 },
    { fulfilled: 20, failed: 0 });
  const safe = chooseBest([flaky, solid], { cfg: CFG });
  ok('a supplier failing 60% of orders loses to a dearer reliable one',
    safe.bestSupplierId === 'd', safe.reason);
  ok('…and it says one was set aside', /set aside below/.test(safe.reason));

  /* …unless it is the only one that can deliver at all. */
  const onlyFlaky = chooseBest([flaky], { cfg: CFG });
  ok('being the only option beats being reliable', onlyFlaky.bestSupplierId === 'c');

  const noCosts = chooseBest([offer({ supplier_id: 'e', cost: null }),
    offer({ supplier_id: 'f', cost: null })], { cfg: CFG });
  ok('with no cost prices it refuses to choose', noCosts.bestSupplierId === null);
  ok('…and says there is nothing to choose between',
    /none has a cost price/.test(noCosts.reason), noCosts.reason);

  const dead = chooseBest([{ ...offer({ supplier_id: 'g' }), supplierStatus: 'paused' }], { cfg: CFG });
  ok('with nobody able to deliver it says so', dead.bestSupplierId === null);
  ok('and with no suppliers at all it says that instead',
    /no supplier is mapped/.test(chooseBest([], { cfg: CFG }).reason));
}

console.log('\n— The gap between the best supplier and the one orders go to —');
{
  const best = offer({ supplier_id: 'a', supplier_name: 'Kinguin', cost: 650, priority: 50 });
  const routed = offer({ supplier_id: 'b', supplier_name: 'G2A', cost: 900, priority: 10 });
  const row = {
    productId: 'p1', name: '1,000 Robux', active: true, priceCents: 999,
    offers: [best, routed], bestSupplierId: 'a', routedSupplierId: 'b',
  };
  const w = intelligenceWarnings([row], { minimumMarginPercent: 0 });
  const gap = w.find((x) => x.code === 'ROUTED_NOT_BEST');
  ok('it is raised', !!gap);
  ok('…with the money on it', /€2\.50 per sale/.test(gap.detail), gap?.detail);
  ok('…and says how to fix it', /priority/.test(gap.detail));

  const agreed = intelligenceWarnings([{ ...row, routedSupplierId: 'a' }], { minimumMarginPercent: 0 });
  ok('and not raised when they agree',
    !agreed.some((x) => x.code === 'ROUTED_NOT_BEST'));
}

console.log('\n— The four alerts —');
{
  const base = { productId: 'p1', name: 'Test', active: true, priceCents: 999 };

  // margin below minimum, judged on the ROUTED supplier's cost
  const thin = offer({ supplier_id: 'r', supplier_name: 'G2A', cost: 980 });
  const marginW = intelligenceWarnings(
    [{ ...base, offers: [thin], routedSupplierId: 'r', bestSupplierId: 'r' }],
    { minimumMarginPercent: 20 });
  ok('a margin under the floor is flagged',
    marginW.some((x) => x.code === 'MARGIN_BELOW_MINIMUM'), JSON.stringify(marginW));

  const loss = offer({ supplier_id: 'r', supplier_name: 'G2A', cost: 1400 });
  const lossW = intelligenceWarnings(
    [{ ...base, offers: [loss], routedSupplierId: 'r', bestSupplierId: 'r' }],
    { minimumMarginPercent: 6 });
  const l = lossW.find((x) => x.code === 'MARGIN_BELOW_MINIMUM');
  ok('selling below cost is critical, not a warning', l?.severity === 'critical');
  ok('…and says so in words', /loses money/.test(l.detail));

  // supplier offline — errored, and gone quiet
  const errored = offer({ supplier_id: 'x', supplier_name: 'Kinguin', supplier_status_row: 'error' });
  const offW = intelligenceWarnings([{ ...base, offers: [errored], routedSupplierId: null }]);
  ok('an errored supplier is offline', offW.some((x) => x.code === 'SUPPLIER_OFFLINE'
    && x.severity === 'critical'));

  const stale = offer({ supplier_id: 'y', supplier_name: 'Eldorado',
    last_synced_at: new Date(Date.now() - 72 * 3600_000).toISOString() });
  const staleW = intelligenceWarnings([{ ...base, offers: [stale], routedSupplierId: null }],
    { staleSyncHours: 48 });
  const st = staleW.find((x) => x.code === 'SUPPLIER_OFFLINE');
  ok('a supplier that has gone quiet is flagged too', !!st, JSON.stringify(staleW));
  ok('…with how old its numbers are', /72h/.test(st.detail), st?.detail);

  const fresh = offer({ supplier_id: 'z', last_synced_at: new Date().toISOString() });
  ok('a supplier that synced an hour ago is not',
    !intelligenceWarnings([{ ...base, offers: [fresh], routedSupplierId: null }])
      .some((x) => x.code === 'SUPPLIER_OFFLINE'));

  // got more expensive
  const risen = { ...offer({ supplier_id: 'p', supplier_name: 'G2A' }),
    costChange: { fromCents: 700, toCents: 850, pct: 21.4, since: '2026-09-01T00:00:00.000Z' } };
  const upW = intelligenceWarnings([{ ...base, offers: [risen], routedSupplierId: 'p' }],
    { minimumMarginPercent: 0 });
  const up = upW.find((x) => x.code === 'SUPPLIER_PRICE_UP');
  ok('a supplier that got dearer is flagged', !!up);
  ok('…with both prices and the date', /€7\.00 to €8\.50/.test(up.detail) && /2026-09-01/.test(up.detail),
    up?.detail);

  const wobble = { ...offer({ supplier_id: 'q' }),
    costChange: { fromCents: 700, toCents: 715, pct: 2.1, since: '2026-09-01T00:00:00.000Z' } };
  ok('a two percent drift is not an alert',
    !intelligenceWarnings([{ ...base, offers: [wobble], routedSupplierId: 'q' }],
      { minimumMarginPercent: 0 }).some((x) => x.code === 'SUPPLIER_PRICE_UP'));
}

console.log('\n— An inactive product is not nagged about —');
{
  const o = offer({ supplier_id: 'a', cost: 1400 });
  ok('nothing is raised for a product that is not for sale',
    intelligenceWarnings([{ productId: 'p', name: 'Off', active: false, priceCents: 999,
      offers: [o], routedSupplierId: 'a', bestSupplierId: 'a' }]).length === 0);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} supplier-intelligence: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
