import { useEffect, useState } from 'react';
import { CreditCard, Plus, Trash2, Star } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageLoader, EmptyState, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const EMPTY = { label: '', fullName: '', email: '', line1: '', line2: '',
  city: '', postalCode: '', country: '', vatNumber: '', isDefault: false };

export default function Billing() {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const load = () => api.get('/api/account/billing').then((r) => setItems(r.billing)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  if (!items) return <PageLoader />;

  const save = async () => {
    try { await api.post('/api/account/billing', form); toast.success('Billing details saved.');
      setOpen(false); setForm(EMPTY); load(); }
    catch (err) { toast.error(err.message); }
  };
  const remove = async (id) => { await api.del(`/api/account/billing/${id}`); load(); };

  const field = (key, label) => (
    <div><label className="label">{label}</label>
      <input className="input" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl text-white">Billing details</h1>
        <button onClick={() => setOpen(true)} className="btn-primary text-sm"><Plus size={16} /> Add</button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={CreditCard} title="No saved billing details"
          action={<button onClick={() => setOpen(true)} className="btn-primary">Add details</button>} />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {items.map((b) => (
            <div key={b.id} className="card p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-medium">{b.label}</span>
                {b.is_default ? <span className="text-amber-300 text-xs flex items-center gap-1"><Star size={12} /> Default</span> : null}
              </div>
              <p className="text-slate-400 text-sm leading-relaxed">
                {b.full_name}<br />{b.line1} {b.line2}<br />
                {b.city} {b.postal_code}<br />{b.country}
                {b.vat_number && <><br />VAT: {b.vat_number}</>}
              </p>
              <button onClick={() => remove(b.id)} className="btn-danger text-xs mt-4"><Trash2 size={12} /> Remove</button>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add billing details" size="lg"
        footer={<>
          <button onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
          <button onClick={save} className="btn-primary">Save</button>
        </>}>
        <div className="grid sm:grid-cols-2 gap-4">
          {field('label', 'Label')}
          {field('fullName', 'Full name')}
          {field('email', 'Email')}
          {field('vatNumber', 'VAT number')}
          {field('line1', 'Address line 1')}
          {field('line2', 'Address line 2')}
          {field('city', 'City')}
          {field('postalCode', 'Postal code')}
          {field('country', 'Country')}
          <label className="flex items-center gap-2 text-sm text-slate-300 mt-6">
            <input type="checkbox" checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
            Set as default
          </label>
        </div>
      </Modal>
    </div>
  );
}
