/**
 * ManualConnector — for suppliers a human operates by hand (e.g. a marketplace
 * with no API). It performs no network calls: catalog is maintained directly
 * via supplier_products, and fulfillment is routed to the manual workflow where
 * a Fulfillment Manager enters delivery details.
 */
import { SupplierConnector } from './SupplierConnector.js';

export class ManualConnector extends SupplierConnector {
  static kind = 'manual';
  get supportsSync() { return false; }
  get supportsFulfillment() { return false; }

  async testConnection() {
    return { ok: true, detail: 'Manual supplier — no external connection' };
  }

  async fetchCatalog() {
    // Manual catalogs are curated in-app; nothing to pull.
    return [];
  }
}
