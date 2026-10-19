import { useI18n } from '../../lib/i18n.jsx';

/**
 * Cart lines the shop no longer sells — switched off or deleted since they went
 * into the cart — named, with a way to take them out.
 *
 * The quote refuses a cart with such a line (as the order must), and both
 * pages swallowed that refusal: the summary stayed dimmed at old prices until
 * "Pay" answered "Unknown product: prd_…". The refusal now carries the code
 * `product_unavailable` and the product, which the pages turn into this list.
 */
export default function UnavailableLines({ problems, items, remove, tone = 'light' }) {
  const { t } = useI18n();
  const gone = (problems || []).filter((p) => p.code === 'unavailable');
  if (!gone.length) return null;
  const nameOf = (p) => p.name || items.find((i) => i.id === p.productId)?.name || t('cart.aProduct', 'A product');
  const dark = tone === 'dark';
  return (
    <div role="alert" className={`rounded-xl border p-3 mb-4 ${dark ? 'border-amber-400/30 bg-amber-400/10' : 'border-amber-300 bg-amber-50'}`}>
      <p className={`text-[12.5px] font-semibold ${dark ? 'text-amber-200' : 'text-amber-800'}`}>
        {t('cart.unavailableTitle', 'No longer available — remove it to continue:')}
      </p>
      <ul className={`mt-1.5 space-y-1 text-[12.5px] ${dark ? 'text-slate-300' : 'text-slate-600'}`}>
        {gone.map((p) => (
          <li key={p.productId} className="flex items-center justify-between gap-3">
            <span className="min-w-0 break-words">{nameOf(p)}</span>
            <button type="button" onClick={() => remove(p.productId)}
              className={`shrink-0 underline ${dark ? 'text-slate-200' : 'text-slate-800'}`}>{t('cart.remove', 'Remove')}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
