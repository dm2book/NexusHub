import { useEffect, useState } from 'react';
import { Truck, Plus, RefreshCw, Plug, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { PageLoader, EmptyState, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const KIND_HINT = {
  api: 'config: { baseUrl, auth:{type,token}, endpoints:{catalog,fulfill,status}, fieldMap }',
  csv: 'config: { source:{type:"url"|"inline",url,content}, columns:{sku,name,price,stock,status} }',
  manual: 'No connection — catalog curated in-app, fulfillment routed to the manual queue.',
};

export default function Suppliers() {
  const toast = useToast();
  const [suppliers, setSuppliers] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', connectorKind: 'api', config: '{\n  \n}' });
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/api/admin/suppliers').then((r) => setSuppliers(r.suppliers)).catch(() => setSuppliers([]));
  useEffect(() => { load(); }, []);
  if (!suppliers) return <PageLoader />;

  const create = async () => {
    setBusy(true);
    try {
      let config = {};
      try { config = JSON.parse(form.config || '{}'); }
      catch { toast.error('Config must be valid JSON'); setBusy(false); return; }
      await api.post('/api/admin/suppliers', { name: form.name, connectorKind: form.connectorKind, config });
      toast.success('Supplier created.');
      setOpen(false); setForm({ name: '', connectorKind: 'api', config: '{\n  \n}' }); load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const sync = async (s) => {
    try { const { run } = await api.post(`/api/admin/suppliers/${s.id}/sync`, { type: 'full' });
      toast[run.status === 'success' ? 'success' : 'error'](`Sync ${run.status}: ${run.items_processed} items`); load(); }
    catch (err) { toast.error(err.message); }
  };
  const test = async (s) => {
    try { const r = await api.post(`/api/admin/suppliers/${s.id}/test`);
      toast[r.ok ? 'success' : 'error'](r.ok ? 'Connection OK' : `Failed: ${r.detail}`); }
    catch (err) { toast.error(err.message); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl text-white">Suppliers</h1>
        <button onClick={() => setOpen(true)} className="btn-primary text-sm"><Plus size={16} /> Add supplier</button>
      </div>
      <p className="text-slate-400 text-sm mb-6">
        Connector-based integration layer — API, CSV and manual suppliers. No suppliers are hardcoded.
      </p>

      {suppliers.length === 0 ? (
        <EmptyState icon={Truck} title="No suppliers configured"
          action={<button onClick={() => setOpen(true)} className="btn-primary">Add supplier</button>} />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {suppliers.map((s) => (
            <div key={s.id} className="card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-white">{s.name}</h3>
                  <span className="text-xs uppercase tracking-wider text-indigo-400 font-rajdhani">{s.connector_kind}</span>
                </div>
                <span className={`text-xs px-2 py-1 rounded-md ${s.status === 'active'
                  ? 'bg-emerald-500/15 text-emerald-300' : s.status === 'error'
                  ? 'bg-red-500/15 text-red-300' : 'bg-slate-500/15 text-slate-300'}`}>{s.status}</span>
              </div>
              <div className="text-slate-500 text-xs mt-3">
                Last sync: {s.last_sync_at ? `${date(s.last_sync_at)} (${s.last_sync_status})` : 'never'}
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => test(s)} className="btn-ghost text-xs"><Plug size={13} /> Test</button>
                {s.connector_kind !== 'manual' && (
                  <button onClick={() => sync(s)} className="btn-ghost text-xs"><RefreshCw size={13} /> Sync</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add supplier" size="lg"
        footer={<>
          <button onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
          <button onClick={create} disabled={busy || !form.name} className="btn-primary">Create</button>
        </>}>
        <div className="space-y-4">
          <div><label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">Connector kind</label>
            <select className="input" value={form.connectorKind}
              onChange={(e) => setForm({ ...form, connectorKind: e.target.value })}>
              <option value="api">API</option>
              <option value="csv">CSV</option>
              <option value="manual">Manual</option>
            </select>
            <p className="text-slate-500 text-xs mt-2 font-mono">{KIND_HINT[form.connectorKind]}</p>
          </div>
          {form.connectorKind !== 'manual' && (
            <div><label className="label">Config (JSON)</label>
              <textarea rows={8} className="input font-mono text-xs" value={form.config}
                onChange={(e) => setForm({ ...form, config: e.target.value })} /></div>
          )}
        </div>
      </Modal>
    </div>
  );
}
