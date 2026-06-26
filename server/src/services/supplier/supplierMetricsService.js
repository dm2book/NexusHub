/**
 * Per-supplier performance metrics for the admin supplier dashboard:
 *   - margin   : average (price − cost) / price across mapped products,
 *   - reliability : % of fulfillment requests that succeeded,
 *   - speed    : average seconds from request → fulfilled,
 *   - volume   : fulfilled / failed counts, mapped product count.
 *
 * All computed from live data (supplier_products, fulfillment_requests). A
 * supplier with no activity yet reports nulls (shown as "—"), never fake numbers.
 */
import { all } from '../../db/index.js';
import { listSuppliers } from './supplierService.js';

export async function supplierMetrics() {
  const suppliers = await listSuppliers();
  if (!suppliers.length) return [];

  // Margin + mapped product count per supplier.
  const margins = await all(`
    SELECT sp.supplier_id AS sid,
           COUNT(*) AS products,
           AVG(sp.cost) AS avg_cost,
           AVG(CASE WHEN p.price > 0 AND sp.cost IS NOT NULL
                    THEN (p.price - sp.cost)::float / p.price ELSE NULL END) AS avg_margin
      FROM supplier_products sp
      LEFT JOIN products p ON p.id = sp.product_id
     GROUP BY sp.supplier_id`);

  // Fulfillment reliability + speed per supplier.
  const fulfil = await all(`
    SELECT supplier_id AS sid,
           COUNT(*) FILTER (WHERE status = 'fulfilled') AS fulfilled,
           COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
           COUNT(*) FILTER (WHERE status IN ('pending','in_progress')) AS open,
           AVG(EXTRACT(EPOCH FROM (updated_at::timestamptz - created_at::timestamptz)))
             FILTER (WHERE status = 'fulfilled') AS avg_secs
      FROM fulfillment_requests
     WHERE supplier_id IS NOT NULL
     GROUP BY supplier_id`);

  const mById = Object.fromEntries(margins.map((m) => [m.sid, m]));
  const fById = Object.fromEntries(fulfil.map((f) => [f.sid, f]));

  return suppliers.map((s) => {
    const m = mById[s.id] || {};
    const f = fById[s.id] || {};
    const fulfilled = Number(f.fulfilled || 0);
    const failed = Number(f.failed || 0);
    const total = fulfilled + failed;
    return {
      id: s.id,
      name: s.name,
      kind: s.connector_kind,
      status: s.status,
      lastSyncAt: s.last_sync_at,
      lastSyncStatus: s.last_sync_status,
      products: Number(m.products || 0),
      avgMargin: m.avg_margin != null ? Math.round(Number(m.avg_margin) * 1000) / 10 : null, // %
      avgCost: m.avg_cost != null ? Math.round(Number(m.avg_cost)) : null,                   // cents
      fulfilled,
      failed,
      open: Number(f.open || 0),
      reliability: total ? Math.round((fulfilled / total) * 100) : null,                     // %
      avgFulfillSeconds: f.avg_secs != null ? Math.round(Number(f.avg_secs)) : null,
    };
  });
}
