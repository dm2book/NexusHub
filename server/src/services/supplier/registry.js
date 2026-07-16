/**
 * Connector registry — maps a `connector_kind` string to a connector class.
 *
 * This is the single extension point for new integration styles. Suppliers
 * themselves live in the database; this registry only knows about *kinds*.
 */
import { ApiConnector } from './ApiConnector.js';
import { CsvConnector } from './CsvConnector.js';
import { ManualConnector } from './ManualConnector.js';
import { EldoradoConnector } from './EldoradoConnector.js';
import { KinguinConnector } from './KinguinConnector.js';
import { G2AConnector } from './G2AConnector.js';

const REGISTRY = new Map();

export function registerConnector(ConnectorClass) {
  REGISTRY.set(ConnectorClass.kind, ConnectorClass);
}

// Built-in kinds. Third parties can registerConnector(...) at startup.
registerConnector(ApiConnector);
registerConnector(CsvConnector);
registerConnector(ManualConnector);
registerConnector(EldoradoConnector);
registerConnector(KinguinConnector);
registerConnector(G2AConnector);

export function availableKinds() {
  return [...REGISTRY.keys()];
}

/** Instantiate the connector for a supplier row (config parsed if needed). */
export function createConnector(supplier) {
  const Connector = REGISTRY.get(supplier.connector_kind);
  if (!Connector) {
    throw new Error(`Unknown connector kind: ${supplier.connector_kind}`);
  }
  const config = typeof supplier.config === 'string'
    ? safeParse(supplier.config) : (supplier.config || {});
  return new Connector({ ...supplier, config });
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
