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

function hydrate(row) {
  if (!row) return row;
  return { ...row, config: parse(row.config) };
}

export function listSuppliers() {
  return all('SELECT * FROM suppliers ORDER BY created_at DESC').map(hydrate);
}

export function getSupplier(id) {
  return hydrate(get('SELECT * FROM suppliers WHERE id = @id', { id }));
}

export function createSupplier({ name, connectorKind, config = {}, credentialsRef } = {}) {
  if (!name) throw badRequest('Supplier name is required');
  if (!availableKinds().includes(connectorKind)) {
    throw badRequest(`connectorKind must be one of: ${availableKinds().join(', ')}`);
  }
  const id = newId('sup');
  const at = nowIso();
  run(`INSERT INTO suppliers (id, name, connector_kind, status, config, credentials_ref, created_at, updated_at)
       VALUES (@id, @name, @kind, 'active', @config, @cred, @at, @at)`,
      { id, name, kind: connectorKind, config: JSON.stringify(config),
        cred: credentialsRef || null, at });
  return getSupplier(id);
}

export function updateSupplier(id, patch = {}) {
  const s = getSupplier(id);
  if (!s) throw notFound('Supplier not found');
  const next = {
    name: patch.name ?? s.name,
    status: patch.status ?? s.status,
    config: JSON.stringify(patch.config ?? s.config),
    cred: patch.credentialsRef ?? s.credentials_ref,
  };
  run(`UPDATE suppliers SET name=@name, status=@status, config=@config,
        credentials_ref=@cred, updated_at=@at WHERE id=@id`,
      { ...next, at: nowIso(), id });
  return getSupplier(id);
}

export function deleteSupplier(id) {
  run('DELETE FROM suppliers WHERE id = @id', { id });
}

export async function testSupplier(id) {
  const s = getSupplier(id);
  if (!s) throw notFound('Supplier not found');
  return createConnector(s).testConnection();
}

/** Link a supplier catalog item to one of our products. */
export function mapSupplierProduct({ supplierId, productId, supplierSku, cost, priority = 100 } = {}) {
  if (!getSupplier(supplierId)) throw notFound('Supplier not found');
  const id = newId('sprd');
  run(`INSERT INTO supplier_products
        (id, supplier_id, product_id, supplier_sku, cost, priority, last_synced_at)
       VALUES (@id, @sup, @prod, @sku, @cost, @prio, @at)
       ON CONFLICT(supplier_id, supplier_sku)
       DO UPDATE SET product_id=@prod, cost=@cost, priority=@prio`,
      { id, sup: supplierId, prod: productId, sku: supplierSku,
        cost: cost ?? null, prio: priority, at: nowIso() });
  return get('SELECT * FROM supplier_products WHERE supplier_id=@s AND supplier_sku=@k',
             { s: supplierId, k: supplierSku });
}

/**
 * Run a sync against a supplier. `syncType` ∈ inventory | price | status | full.
 * Returns the recorded supplier_sync_runs row.
 */
export async function syncSupplier(id, syncType = 'full') {
  const supplier = getSupplier(id);
  if (!supplier) throw notFound('Supplier not found');
  const connector = createConnector(supplier);

  const runId = newId('sync');
  const startedAt = nowIso();
  run(`INSERT INTO supplier_sync_runs (id, supplier_id, sync_type, status, started_at)
       VALUES (@id, @sup, @type, 'running', @at)`,
      { id: runId, sup: id, type: syncType, at: startedAt });

  try {
    if (!connector.supportsSync) {
      finishRun(runId, 'success', 0, 0, 'Connector does not sync; manual catalog');
      markSupplier(id, 'success');
      return getSyncRun(runId);
    }

    const catalog = await connector.fetchCatalog();
    let changed = 0;

    tx(() => {
      for (const item of catalog) {
        const existing = get(
          `SELECT * FROM supplier_products WHERE supplier_id=@s AND supplier_sku=@k`,
          { s: id, k: item.supplierSku });

        const fields = {};
        if (syncType === 'inventory' || syncType === 'full') fields.available_stock = item.availableStock;
        if (syncType === 'price' || syncType === 'full') fields.cost = item.cost;
        if (syncType === 'status' || syncType === 'full') fields.supplier_status = item.status;

        if (!existing) {
          run(`INSERT INTO supplier_products
                (id, supplier_id, supplier_sku, cost, available_stock, supplier_status, last_synced_at)
               VALUES (@id, @s, @k, @cost, @stock, @st, @at)`,
              { id: newId('sprd'), s: id, k: item.supplierSku,
                cost: fields.cost ?? null, stock: fields.available_stock ?? null,
                st: fields.supplier_status ?? null, at: nowIso() });
          changed++;
        } else {
          const dirty = Object.entries(fields).some(([k, v]) => v != null && existing[k] !== v);
          run(`UPDATE supplier_products SET
                cost = COALESCE(@cost, cost),
                available_stock = COALESCE(@stock, available_stock),
                supplier_status = COALESCE(@st, supplier_status),
                last_synced_at = @at
               WHERE id = @id`,
              { cost: fields.cost ?? null, stock: fields.available_stock ?? null,
                st: fields.supplier_status ?? null, at: nowIso(), id: existing.id });
          // Propagate stock/price to the linked product when configured.
          if (existing.product_id) propagateToProduct(existing.product_id, item, syncType);
          if (dirty) changed++;
        }
      }
    })();

    finishRun(runId, 'success', catalog.length, changed,
      `Synced ${catalog.length} items (${changed} changed)`);
    markSupplier(id, 'success');
    return getSyncRun(runId);
  } catch (err) {
    finishRun(runId, 'error', 0, 0, err.message);
    markSupplier(id, 'error');
    return getSyncRun(runId);
  }
}

function propagateToProduct(productId, item, syncType) {
  if (syncType === 'inventory' || syncType === 'full') {
    if (item.availableStock != null) {
      run('UPDATE products SET stock=@s, updated_at=@at WHERE id=@id',
          { s: item.availableStock, at: nowIso(), id: productId });
    }
  }
}

function markSupplier(id, status) {
  run('UPDATE suppliers SET last_sync_at=@at, last_sync_status=@st, updated_at=@at WHERE id=@id',
      { at: nowIso(), st: status, id });
}
function finishRun(id, status, processed, changed, detail) {
  run(`UPDATE supplier_sync_runs SET status=@st, items_processed=@p, items_changed=@c,
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
 * Choose the best supplier able to fulfill a product, honouring priority and
 * stock/status. Returns { supplier, supplierProduct } or null (=> manual).
 */
export function resolveFulfillmentSupplier(productId) {
  const rows = all(
    `SELECT sp.*, s.status AS supplier_status_overall
       FROM supplier_products sp
       JOIN suppliers s ON s.id = sp.supplier_id
      WHERE sp.product_id = @p AND s.status = 'active'
      ORDER BY sp.priority ASC`, { p: productId });

  for (const sp of rows) {
    const okStatus = !sp.supplier_status || sp.supplier_status === 'in_stock';
    const okStock = sp.available_stock == null || sp.available_stock > 0;
    if (okStatus && okStock) {
      const supplier = getSupplier(sp.supplier_id);
      const connector = createConnector(supplier);
      if (connector.supportsFulfillment) return { supplier, supplierProduct: sp };
    }
  }
  return null;
}
