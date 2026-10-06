import { useEffect, useState } from 'react';
import { Target } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Community milestones the shop has really passed — completed orders, buyers,
 * verified reviews and so on, counted on the server. A milestone appears only
 * once it is reached, and the block draws nothing until there is one: an
 * empty or "3 of 10" bar in public would read as an empty shop, and nothing
 * is padded to avoid that.
 */
const LABEL = {
  orders: ['milestone.orders', 'completed orders'], buyers: ['milestone.buyers', 'different buyers'],
  items: ['milestone.items', 'codes and top-ups delivered'], reviews: ['milestone.reviews', 'verified reviews'],
  referrals: ['milestone.referrals', 'friends who ordered through a friend'], checkins: ['milestone.checkins', 'daily check-ins'],
};

export default function CommunityMilestones() {
  const { t } = useI18n();
  const [list, setList] = useState([]);
  useEffect(() => {
    let live = true;
    api.get('/api/community/milestones').then((r) => { if (live) setList(r.milestones || []); }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!list.length) return null;
  return (
    <section className="section py-10" data-testid="community-milestones">
      <h2 className="text-2xl text-white flex items-center gap-2 mb-4"><Target size={20} className="text-emerald-400" /> {t('milestone.title', 'Community milestones')}</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map((m) => (
          <div key={m.id} className="card p-4">
            <div className="text-2xl text-white font-extrabold tabular-nums">{m.reached.toLocaleString('nl-NL')}+</div>
            <div className="text-slate-400 text-sm">{t(...LABEL[m.id])}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
