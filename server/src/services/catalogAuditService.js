/**
 * Can every product on the shelf actually be delivered?
 *
 * One implementation, two readers: `scripts/audit-catalog.mjs` prints it before
 * a launch, and the readiness dashboard shows the blockers to the owner. Two
 * copies of these rules would drift, and the drift would be silent — the
 * dashboard would go green on a catalogue the audit refuses.
 *
 * The rule is one sentence: the shop must never advertise a product as
 * available when fulfilling it is impossible. That has two halves:
 *
 *   FAIL  Money can be taken and the order cannot be completed by anyone — not
 *         by the code dispenser, not by a supplier, not by a person. Or the page
 *         states something about the product that is not true.
 *   WARN  It sells and it can be delivered, but something is dead, unset or
 *         about to surprise somebody.
 *
 * What it deliberately does NOT decide: whether the owner can actually source a
 * product they buy in by hand. Nothing in a database knows that. What it can
 * check is that the shop is not PROMISING more than the data supports — an
 * "instant" badge with no code behind it, a jackpot larger than the prize pool,
 * an availability claim that contradicts the one in the same page's head.
 */
import { all } from '../db/index.js';
import { iconFor } from '../db/demoSeed.js';
import { artStatus } from '../../../src/lib/shippedArt.js';
import { productPayload } from './productPayload.js';

export async function auditCatalog() {
  /* ── findings ───────────────────────────────────────────────────────────── */
  /* Every finding carries a stable `code`. Without it the report printed the same
     sentence once per product: 72 active products, none with codes loaded yet, and
     72 identical paragraphs telling the owner so. A report nobody reads to the end
     is a report that does not gate anything, so identical findings collapse into
     one line with the names underneath. */
  const findings = [];
  const add = (level, code, check, subject, detail, fix) =>
    findings.push({ level, code, check, subject, detail, fix });
  const fail = (...a) => add('FAIL', ...a);
  const warn = (...a) => add('WARN', ...a);

  const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

  /* ── the catalogue, and everything that decides whether it can ship ─────── */
  const rows = await all(`SELECT * FROM products ORDER BY category, name`);
  const active = rows.filter((r) => r.active);
  const inactive = rows.length - active.length;

  // One query each rather than one per product: a catalogue of a few hundred
  // products would otherwise be a few hundred round trips to a managed database.
  const codeCounts = new Map((await all(
    `SELECT product_id, COUNT(*)::int AS n FROM product_codes
      WHERE status = 'available' GROUP BY product_id`)).map((r) => [r.product_id, Number(r.n)]));

  const supplierLinks = new Map();
  for (const r of await all(
    `SELECT sp.product_id, sp.supplier_sku, s.id AS supplier_id, s.name, s.status
       FROM supplier_products sp JOIN suppliers s ON s.id = sp.supplier_id
      WHERE sp.product_id IS NOT NULL`)) {
    if (!supplierLinks.has(r.product_id)) supplierLinks.set(r.product_id, []);
    supplierLinks.get(r.product_id).push(r);
  }

  const mysteryRewards = new Map();
  for (const r of await all(`SELECT box_id, label, credit_cents, weight FROM mystery_box_rewards`)) {
    if (!mysteryRewards.has(r.box_id)) mysteryRewards.set(r.box_id, []);
    mysteryRewards.get(r.box_id).push(r);
  }

  /* ── per product ────────────────────────────────────────────────────────── */
  if (!active.length) {
    fail('catalog:empty', 'catalog', '(catalogue)', 'No active products — there is nothing to sell.',
      'Activate products in Admin → Products.');
  }

  const seenName = new Map();

  for (const r of active) {
    const meta = parse(r.metadata);
    const where = `${r.name}${r.sku ? ` (${r.sku})` : ''}`;
    const codes = codeCounts.get(r.id) || 0;
    const links = supplierLinks.get(r.id) || [];
    const payload = productPayload({ ...r, metadata: meta, active: true,
      deliveryMode: meta.deliveryMode === 'manual' ? 'manual' : 'auto' }, codes);

    /* ── 1. Fulfilment: can this order ever be completed? ─────────────────── */

    // A mystery box pays out as store credit rolled from a pool. No pool, no
    // payout: settleMysteryForOrder() skips the item, the money is taken, and
    // nothing reaches the buyer — including in the manual queue, which has no
    // prize to hand out either.
    if (r.kind === 'mystery') {
      const pool = mysteryRewards.get(r.id) || [];
      if (!pool.length) {
        fail('mystery:empty', 'fulfilment', where,
          'Mystery box with an empty reward pool — a paid order pays out nothing at all.',
          'Add rewards in Admin → Products → Mystery box, or deactivate the product.');
      } else {
        const worthless = pool.filter((p) => Number(p.credit_cents) <= 0);
        if (worthless.length) {
          fail('mystery:zero-prize', 'honesty', where,
            `${worthless.length} of ${pool.length} rewards are worth €0 — "every box wins a real prize" is not true.`,
            `Give every reward a credit above zero: ${worthless.map((p) => p.label).join(', ')}`);
        }
        if (!pool.some((p) => Number(p.weight) > 0)) {
          fail('mystery:no-weight', 'fulfilment', where, 'Every reward has weight 0 — nothing can ever be rolled.',
            'Give at least one reward a positive weight.');
        }
        /* The description names a top prize. If the pool cannot produce it, the
           page is advertising something that cannot happen. */
        const claimed = [...String(r.description || '').matchAll(/€\s?([\d.]+)/g)]
          .map((m) => Math.round(parseFloat(m[1]) * 100)).filter(Number.isFinite);
        const best = Math.max(...pool.map((p) => Number(p.credit_cents) || 0));
        const impossible = claimed.filter((c) => c > best);
        if (impossible.length) {
          fail('mystery:overclaim', 'honesty', where,
            `The description promises up to €${(Math.max(...impossible) / 100).toFixed(2)}, `
            + `but the best prize in the pool is €${(best / 100).toFixed(2)}.`,
            'Raise the top reward or correct the description.');
        }
      }
    }

    // Auto delivery with nothing to deliver from. Not a failure — the shop buys
    // in by hand and the product page says so — but "auto" is doing nothing here,
    // and the owner probably thinks it is.
    const activeLinks = links.filter((l) => l.status === 'active');
    /* A mystery box is not delivered from code stock at all — it settles as store
       credit the moment the payment lands — so "no codes loaded" says nothing
       about it. */
    if (r.kind !== 'mystery' && payload.deliveryMode === 'auto' && !codes && !activeLinks.length) {
      warn('delivery:no-source', 'delivery', where,
        'Set to auto-deliver, but there are no codes in stock and no active supplier — every order goes to the manual queue.',
        'Load codes (Admin → Products → Codes), connect a supplier, or set delivery to manual so the setting matches reality.');
    }
    if (links.length && !activeLinks.length) {
      warn('supplier:inactive', 'supplier', where,
        `Mapped to ${links.length} supplier(s), none of them active: ${links.map((l) => `${l.name} (${l.status})`).join(', ')}.`,
        'Re-enable the supplier or remove the mapping — the auto path will fail and fall back to manual.');
    }

    // The buyer has to tell us WHERE it goes, and nothing asks them.
    if (meta.deliveryChoice === true && !String(meta.deliveryField || '').trim()) {
      warn('delivery:no-field', 'delivery', where,
        'deliveryChoice is on but there is no deliveryField label, so the checkout cannot offer the choice and silently ignores the setting.',
        'Set deliveryField (e.g. "Roblox username") or turn deliveryChoice off.');
    }

    /* ── 2. Honesty: does the page state anything untrue? ─────────────────── */

    if (!(Number(r.price) > 0)) {
      fail('price:zero', 'price', where, `Price is ${r.price} — the order charges nothing and still has to be delivered.`,
        'Set a price above zero, or deactivate the product.');
    }
    const currency = String(r.currency || 'EUR').toUpperCase();
    if (currency !== 'EUR') {
      fail('price:currency', 'price', where, `Priced in ${currency}, but the checkout charges in EUR.`,
        'Reprice in EUR — iDEAL and the manual payment methods are euro-only.');
    }
    const compareAt = Number(meta.compareAt) || 0;
    if (compareAt && compareAt <= Number(r.price)) {
      warn('price:dead-compare', 'price', where,
        `compareAt (€${(compareAt / 100).toFixed(2)}) is not above the price (€${(r.price / 100).toFixed(2)}), so no "was" price is shown.`,
        'Remove compareAt, or set it to the real previous price.');
    }

    /* products.stock is a free integer nobody enforces: no order checks it,
       nothing decrements it, and the storefront reads code stock instead. It used
       to drive an availability claim to Google that contradicted the one in the
       same page's head. Anything written there now is a note to self. */
    if (r.stock !== null && r.stock !== undefined) {
      warn('stock:unused', 'stock', where,
        `stock is set to ${r.stock}, but nothing reads it — the shop sells from loaded codes (${codes} available).`,
        'Leave it empty and manage real stock through product codes.');
    }

    /* ── 3. Presentation: it sells, but does it look like a real shop? ────── */

    const src = meta.image || iconFor(r.category);
    const art = artStatus(src);
    if (art === 'none') {
      fail('art:none', 'art', where, `No image, and no built-in icon for category "${r.category}".`,
        'Set an image, or file the product under a category that has one.');
    } else if (art === 'missing') {
      fail('art:missing', 'art', where, `Image points at ${src}, which this build does not ship.`,
        'Fix the path or upload the image. Run scripts/audit-product-art.mjs for the full picture.');
    }

    const desc = String(r.description || '').trim();
    if (!desc) {
      warn('copy:none', 'copy', where, 'No description — the product page, the card and the link preview all have nothing to say.',
        'Write one sentence about what the buyer receives.');
    } else if (desc.length < 20) {
      warn('copy:short', 'copy', where, `Description is ${desc.length} characters: "${desc}"`,
        'Say what it is and what arrives.');
    }

    if (!String(r.category || '').trim()) {
      warn('category:none', 'category', where, 'No category — it is missing from every category page and gets no icon.',
        'File it under a category.');
    } else if (!iconFor(r.category) && !meta.image) {
      warn('category:no-icon', 'category', where, `Category "${r.category}" has no built-in icon and the product has no image of its own.`,
        'Give the product an image, or use a category from the icon set.');
    }

    const key = r.name.trim().toLowerCase();
    if (seenName.has(key)) {
      warn('duplicate:name', 'duplicate', where, `Same name as ${seenName.get(key)} — two products a shopper cannot tell apart.`,
        'Rename one, or deactivate the duplicate.');
    } else seenName.set(key, where);
  }

  /* ── bundles: every part must be buyable ────────────────────────────────── */
  const bundles = await all(`SELECT * FROM bundles WHERE active = 1`).catch(() => []);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const b of bundles) {
    let ids = []; try { ids = JSON.parse(b.product_ids || '[]'); } catch { /* below */ }
    if (!Array.isArray(ids) || ids.length < 2) {
      warn('bundle:too-small', 'bundle', b.name, `Has ${ids.length || 0} product(s) — a bundle needs at least two to discount.`,
        'Add products or deactivate the bundle.');
      continue;
    }
    const gone = ids.filter((id) => !byId.has(id));
    const off = ids.filter((id) => byId.has(id) && !byId.get(id).active);
    if (gone.length) {
      fail('bundle:missing-product', 'bundle', b.name, `${gone.length} product(s) in this bundle no longer exist: ${gone.join(', ')}.`,
        'Remove them from the bundle, or deactivate it.');
    }
    if (off.length) {
      fail('bundle:inactive-product', 'bundle', b.name,
        `${off.length} product(s) in this bundle are inactive: ${off.map((id) => byId.get(id).name).join(', ')}. `
        + 'The bundle is offered and the checkout refuses the order.',
        'Reactivate those products, drop them from the bundle, or deactivate the bundle.');
    }
    if (!(Number(b.discount_percent) > 0)) {
      warn('bundle:no-discount', 'bundle', b.name, `Discount is ${b.discount_percent}% — it is advertised as "save" and saves nothing.`,
        'Set a discount above zero, or deactivate the bundle.');
    }
  }

  /* ── drops: a countdown to something that exists ────────────────────────── */
  const drops = await all(`SELECT * FROM drops WHERE starts_at > @now`, { now: new Date().toISOString() })
    .catch(() => []);
  const activeCats = new Set(active.map((r) => r.category));
  for (const d of drops) {
    if (d.category && !activeCats.has(d.category)) {
      warn('drop:empty-category', 'drop', d.title, `Counts down to category "${d.category}", which has no active products.`,
        'Activate something in that category before the drop lands, or remove the drop.');
    }
  }


  const fails = findings.filter((f) => f.level === 'FAIL');
  const warns = findings.filter((f) => f.level === 'WARN');
  return {
    ok: fails.length === 0,
    checked: { active: active.length, inactive, bundles: bundles.length, drops: drops.length },
    fail: fails.length, warn: warns.length, findings,
  };
}

/** The checks this audit runs, so a clean run can say what it checked. */
export const CATALOG_CHECKS = ['fulfilment', 'honesty', 'delivery', 'supplier', 'price',
  'stock', 'art', 'copy', 'category', 'duplicate', 'bundle', 'drop'];
