/**
 * Supplier management + sync orchestration.
 *
 * Handles supplier CRUD, supplier↔product mapping, and inventory/price/status
 * synchronization. Every sync is recorded in supplier_sync_runs; the connector
 * abstraction keeps this code supplier-agnostic.
 */
import { run, get, all, nowIso, tx } from '../../db/index.js';
import { newId } from '../../utils/ids.js';
import { notFound, badRequest } from '../../utils/errors.js';
import { createConnector, availableKinds } from './registry.js';

const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
const hydrate = (row) => (row ? { ...row, config: parse(row.config) } : row);

export async function listSuppliers() {
  return (await all('SELECT * FROM suppliers ORDER BY created_at DESC')).map(hydrate);
}

export async function getSupplier(id) {
  return hydrate(await get('SELECT * FROM suppliers WHERE id = @id', { id }));
}

export async function createSupplier({ name, connectorKind, config = {}, credentialsRef } = {}) {
  if (!name) throw badRequest('Supplier name is required');
  if (!availableKinds().includes(connectorKind)) {
    throw badRequest(`connectorKind must be one of: ${availableKinds().join(', ')}`);
  }
  const id = newId('sup');
  const at = nowIso();
  await run(`INSERT INTO suppliers (id, name, connector_kind, status, config, credentials_ref, created_at, updated_at)
       VALUES (@id, @name, @kind, 'active', @config, @cred, @at, @at)`,
      { id, name, kind: connectorKind, config: JSON.stringify(config),
        cred: credentialsRef || null, at });
  return getSupplier(id);
}

export async function updateSupplier(id, patch = {}) {
  const s = await getSupplier(id);
  if (!s) throw notFound('Supplier not found');
  await run(`UPDATE suppliers SET name=@name, status=@status, config=@config,
        credentials_ref=@cred, updated_at=@at WHERE id=@id`, {
    name: patch.name ?? s.name,
    status: patch.status ?? s.status,
    config: JSON.stringify(patch.config ?? s.config),
    cred: patch.credentialsRef ?? s.credentials_ref,
    at: nowIso(), id,
  });
  return getSupplier(id);
}

export async function deleteSupplier(id) {
  await run('DELETE FROM suppliers WHERE id = @id', { id });
}

export async function testSupplier(id) {
  const s = await getSupplier(id);
  if (!s) throw notFound('Supplier not found');
  return createConnector(s).testConnection();
}

/** Link a supplier catalog item to one of our products (with the exact listing
 *  URL to buy from, e.g. an Eldorado link). */
export async function mapSupplierProduct({ supplierId, productId, supplierSku, supplierUrl = null, cost, priority = 100 } = {}) {
  if (!(await getSupplier(supplierId))) throw notFound('Supplier not found');
  await run(`INSERT INTO supplier_products
        (id, supplier_id, product_id, supplier_sku, supplier_url, cost, priority, last_synced_at)
       VALUES (@id, @sup, @prod, @sku, @url, @cost, @prio, @at)
       ON CONFLICT(supplier_id, supplier_sku)
       DO UPDATE SET product_id=@prod, supplier_url=@url, cost=@cost, priority=@prio`,
      { id: newId('sprd'), sup: supplierId, prod: productId, sku: supplierSku,
        url: supplierUrl || null, cost: cost ?? null, prio: priority, at: nowIso() });
  return get('SELECT * FROM supplier_products WHERE supplier_id=@s AND supplier_sku=@k',
             { s: supplierId, k: supplierSku });
}

/**
 * One line in a supplier's price history.
 *
 * Best-effort on purpose: a sync that delivered fresh costs and then failed to
 * write its own diary entry has still delivered fresh costs, and losing the run
 * over the chart underneath it would be the wrong trade. Loud rather than
 * silent, because a history with holes is worse than one that says so.
 */
export async function recordOffer({
  supplierId, supplierProductId = null, productId = null, supplierSku,
  cost = null, availableStock = null, supplierStatus = null, observedAt = null,
} = {}) {
  try {
    await run(
      `INSERT INTO supplier_offer_history
         (id, supplier_id, supplier_product_id, product_id, supplier_sku,
          cost, available_stock, supplier_status, observed_at)
       VALUES (@id, @s, @sp, @p, @k, @c, @st, @status, @at)`,
      { id: newId('soh'), s: supplierId, sp: supplierProductId, p: productId,
        k: supplierSku, c: cost, st: availableStock, status: supplierStatus,
        at: observedAt || nowIso() });
    return true;
  } catch (e) {
    console.error('[supplier] offer history not written:', e.message);
    return false;
  }
}

/** All product mappings for a supplier, with our product name for the admin UI. */
export function listSupplierProducts(supplierId) {
  return all(
    `SELECT sp.*, p.name AS product_name, p.price AS product_price
       FROM supplier_products sp
       LEFT JOIN products p ON p.id = sp.product_id
      WHERE sp.supplier_id = @s ORDER BY sp.priority ASC, sp.last_synced_at DESC NULLS LAST`,
    { s: supplierId });
}

/**
 * Run a sync against a supplier. `syncType` ∈ inventory | price | status | full.
 * Returns the recorded supplier_sync_runs row.
 */
export async function syncSupplier(id, syncType = 'full') {
  const supplier = await getSupplier(id);
  if (!supplier) throw notFound('Supplier not found');
  const connector = createConnector(supplier);

  const runId = newId('sync');
  await run(`INSERT INTO supplier_sync_runs (id, supplier_id, sync_type, status, started_at)
       VALUES (@id, @sup, @type, 'running', @at)`,
      { id: runId, sup: id, type: syncType, at: nowIso() });

  try {
    if (!connector.supportsSync) {
      await finishRun(runId, 'success', 0, 0, 'Connector does not sync; manual catalog');
      await markSupplier(id, 'success');
      return getSyncRun(runId);
    }

    const catalog = await connector.fetchCatalog();
    let changed = 0;

    await tx(async () => {
      for (const item of catalog) {
        const existing = await get(
          `SELECT * FROM supplier_products WHERE supplier_id=@s AND supplier_sku=@k`,
          { s: id, k: item.supplierSku });

        const fields = {};
        if (syncType === 'inventory' || syncType === 'full') fields.available_stock = item.availableStock;
        if (syncType === 'price' || syncType === 'full') fields.cost = item.cost;
        if (syncType === 'status' || syncType === 'full') fields.supplier_status = item.status;

        if (!existing) {
          const sprdId = newId('sprd');
          const seenAt = nowIso();
          await run(`INSERT INTO supplier_products
                (id, supplier_id, supplier_sku, cost, available_stock, supplier_status, last_synced_at)
               VALUES (@id, @s, @k, @cost, @stock, @st, @at)`,
              { id: sprdId, s: id, k: item.supplierSku,
                cost: fields.cost ?? null, stock: fields.available_stock ?? null,
                st: fields.supplier_status ?? null, at: seenAt });
          await recordOffer({
            supplierId: id, supplierProductId: sprdId, productId: null,
            supplierSku: item.supplierSku, cost: fields.cost ?? null,
            availableStock: fields.available_stock ?? null,
            supplierStatus: fields.supplier_status ?? null, observedAt: seenAt,
          });
          changed++;
        } else {
          const dirty = Object.entries(fields).some(([k, v]) => v != null && existing[k] !== v);
          await run(`UPDATE supplier_products SET
                cost = COALESCE(@cost, cost),
                available_stock = COALESCE(@stock, available_stock),
                supplier_status = COALESCE(@st, supplier_status),
                last_synced_at = @at
               WHERE id = @id`,
              { cost: fields.cost ?? null, stock: fields.available_stock ?? null,
                st: fields.supplier_status ?? null, at: nowIso(), id: existing.id });
          if (existing.product_id) await propagateToProduct(existing.product_id, item, syncType);
          /* Only when something actually moved. A daily sync of forty unchanged
             SKUs is forty history rows that say nothing, and a chart drawn
             through them is a flat line drawn forty times. */
          if (dirty) {
            await recordOffer({
              supplierId: id, supplierProductId: existing.id, productId: existing.product_id,
              supplierSku: item.supplierSku,
              cost: fields.cost ?? existing.cost ?? null,
              availableStock: fields.available_stock ?? existing.available_stock ?? null,
              supplierStatus: fields.supplier_status ?? existing.supplier_status ?? null,
            });
            changed++;
          }
        }
      }
    });

    await finishRun(runId, 'success', catalog.length, changed,
      `Synced ${catalog.length} items (${changed} changed)`);
    await markSupplier(id, 'success');
    return getSyncRun(runId);
  } catch (err) {
    await finishRun(runId, 'error', 0, 0, err.message);
    await markSupplier(id, 'error');
    return getSyncRun(runId);
  }
}

async function propagateToProduct(productId, item, syncType) {
  if ((syncType === 'inventory' || syncType === 'full') && item.availableStock != null) {
    await run('UPDATE products SET stock=@s, updated_at=@at WHERE id=@id',
        { s: item.availableStock, at: nowIso(), id: productId });
  }
}

async function markSupplier(id, status) {
  await run('UPDATE suppliers SET last_sync_at=@at, last_sync_status=@st, updated_at=@at WHERE id=@id',
      { at: nowIso(), st: status, id });
}
async function finishRun(id, status, processed, changed, detail) {
  await run(`UPDATE supplier_sync_runs SET status=@st, items_processed=@p, items_changed=@c,
        detail=@d, finished_at=@at WHERE id=@id`,
      { st: status, p: processed, c: changed, d: detail, at: nowIso(), id });
}
export function getSyncRun(id) {
  return get('SELECT * FROM supplier_sync_runs WHERE id=@id', { id });
}
export function listSyncRuns(supplierId, limit = 25) {
  return all(`SELECT * FROM supplier_sync_runs WHERE supplier_id=@s
              ORDER BY started_at DESC LIMIT @l`, { s: supplierId, l: limit });
}

/**
 * The supplier the next order for this product goes to, or null (=> manual).
 *
 * It walked the mappings in `priority` order and skipped one with no stock;
 * it now asks supplierFailoverService first, which moves the product to the
 * best usable supplier when the current one is offline, failing, out of stock
 * or too dear — and logs the move. Then, as before, the first usable mapping
 * whose connector can actually place an order wins.
 *
 * `exclude` is the supplier(s) that just failed this delivery: the failover in
 * fulfillmentService passes it, so a failed order is never handed straight back.
 */
export async function resolveFulfillmentSupplier(productId, { orderId = null, exclude = [] } = {}) {
  const { evaluateProduct, mappingsFor, rankCandidates } = await import('./supplierFailoverService.js');
  const out = await evaluateProduct(productId, {
    trigger: exclude.length ? 'failure' : 'order', orderId, exclude,
  });
  if (!out.route) return null;

  const product = await get('SELECT price FROM products WHERE id=@p', { p: productId });
  const others = (await mappingsFor(productId))
    .filter((m) => m.id !== out.route.id && !exclude.includes(m.supplier_id));
  const order = [out.route, ...rankCandidates(others, { priceCents: product ? Number(product.price) : null })];

  for (const m of order) {
    if (exclude.includes(m.supplier_id)) continue;
    const supplier = await getSupplier(m.supplier_id);
    // A supplier row with an unknown/removed connector kind must not abort the
    // whole queue for every order — skip it and try the next mapping.
    let connector;
    try { connector = createConnector(supplier); }
    catch (e) { console.error('[supplier] unusable connector', supplier?.connector_kind, e.message); continue; }
    if (connector.supportsFulfillment) {
      const supplierProduct = await get('SELECT * FROM supplier_products WHERE id=@id', { id: m.id });
      return { supplier, supplierProduct };
    }
  }
  return null;
}
