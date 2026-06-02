/**
 * SupplierConnector — the abstraction every supplier integration implements.
 *
 * Suppliers are NOT hardcoded anywhere. A supplier row in the database carries
 * a `connector_kind` (api | csv | manual) and a JSON `config`; the registry
 * instantiates the matching connector class with that data. Adding a new
 * integration style means adding one subclass and registering it — no changes
 * to orders, fulfillment, or the rest of the platform.
 *
 * A normalized catalog item looks like:
 *   { supplierSku, name, cost, price, availableStock, status }
 * where status ∈ in_stock | out_of_stock | discontinued.
 *
 * A fulfillment result looks like:
 *   { status, externalRef, deliveries: [{ type, content, filename }], raw }
 * where status ∈ fulfilled | in_progress | failed.
 */
export class SupplierConnector {
  /** @param {object} supplier row from `suppliers` (config already parsed) */
  constructor(supplier) {
    this.supplier = supplier;
    this.config = supplier.config || {};
  }

  /** Stable identifier of the connector kind. Subclasses override. */
  static kind = 'base';

  /** Whether this connector can sync catalog data automatically. */
  get supportsSync() { return false; }

  /** Whether this connector can fulfill orders programmatically. */
  get supportsFulfillment() { return false; }

  /** Validate connectivity/config. @returns {Promise<{ok:boolean, detail?:string}>} */
  async testConnection() { return { ok: true, detail: 'No connectivity check for this connector' }; }

  /**
   * Return the supplier's full catalog as normalized items. Connectors that
   * cannot enumerate (e.g. manual) return []. Used by inventory/price/status sync.
   * @returns {Promise<Array>}
   */
  async fetchCatalog() { return []; }

  /**
   * Submit a fulfillment request to the supplier.
   * @param {object} req normalized fulfillment request
   * @returns {Promise<object>} fulfillment result (see header)
   */
  async createFulfillment(req) {
    throw new Error(`${this.constructor.kind} connector does not support fulfillment`);
  }

  /**
   * Poll the status of a previously submitted fulfillment.
   * @param {string} externalRef
   * @returns {Promise<object>} fulfillment result
   */
  async checkFulfillment(externalRef) {
    throw new Error(`${this.constructor.kind} connector does not support status polling`);
  }
}
