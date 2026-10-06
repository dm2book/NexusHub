import { useEffect, useState } from 'react';
import { CreditCard, Plus, Trash2, Star } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageLoader, EmptyState, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useI18n } from '../../lib/i18n.jsx';

const EMPTY = { label: '', fullName: '', email: '', line1: '', line2: '',
  city: '', postalCode: '', country: '', vatNumber: '', isDefault: false };

export default function Billing() {
  const toast = useToast();
  const { t } = useI18n();
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const load = () => api.get('/api/account/billing').then((r) => setItems(r.billing)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  if (!items) return <PageLoader />;

  const save = async () => {
    try { await api.post('/api/account/billing', form); toast.success(t('acc.billing.saved', 'Billing details saved.'));
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
        <h1 className="text-2xl text-white">{t('acc.billing.title', 'Billing details')}</h1>
        <button onClick={() => setOpen(true)} className="btn-primary text-sm"><Plus size={16} /> {t('acc.billing.add', 'Add')}</button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={CreditCard} title={t('acc.billing.empty', 'No saved billing details')}
          action={<button onClick={() => setOpen(true)} className="btn-primary">{t('acc.billing.addDetails', 'Add details')}</button>} />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {items.map((b) => (
            <div key={b.id} className="card p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-medium">{b.label}</span>
                {b.is_default ? <span className="text-amber-300 text-xs flex items-center gap-1"><Star size={12} /> {t('acc.billing.default', 'Default')}</span> : null}
              </div>
              <p className="text-slate-400 text-sm leading-relaxed">
                {b.full_name}<br />{b.line1} {b.line2}<br />
                {b.city} {b.postal_code}<br />{b.country}
                {b.vat_number && <><br />{t('acc.billing.vat', 'VAT: {vat}', { vat: b.vat_number })}</>}
              </p>
              <button onClick={() => remove(b.id)} className="btn-danger text-xs mt-4"><Trash2 size={12} /> {t('acc.billing.remove', 'Remove')}</button>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t('acc.billing.modalTitle', 'Add billing details')} size="lg"
        footer={<>
          <button onClick={() => setOpen(false)} className="btn-ghost">{t('acc.billing.cancel', 'Cancel')}</button>
          <button onClick={save} className="btn-primary">{t('acc.billing.save', 'Save')}</button>
        </>}>
        <div className="grid sm:grid-cols-2 gap-4">
          {field('label', t('acc.billing.label', 'Label'))}
          {field('fullName', t('acc.billing.fullName', 'Full name'))}
          {field('email', t('acc.billing.email', 'Email'))}
          {field('vatNumber', t('acc.billing.vatNumber', 'VAT number'))}
          {field('line1', t('acc.billing.line1', 'Address line 1'))}
          {field('line2', t('acc.billing.line2', 'Address line 2'))}
          {field('city', t('acc.billing.city', 'City'))}
          {field('postalCode', t('acc.billing.postalCode', 'Postal code'))}
          {field('country', t('acc.billing.country', 'Country'))}
          <label className="flex items-center gap-2 text-sm text-slate-300 mt-6">
            <input type="checkbox" checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
            {t('acc.billing.setDefault', 'Set as default')}
          </label>
        </div>
      </Modal>
    </div>
  );
}
