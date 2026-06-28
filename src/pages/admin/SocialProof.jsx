import { useEffect, useState, useCallback } from 'react';
import {
  Activity, Star, Eye, EyeOff, Pin, PinOff, Trash2, BadgeCheck, ShieldOff,
  CheckCircle2, Clock, Gauge, Users,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageLoader } from '../../components/ui.jsx';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const secs = (s) => (s == null ? '—' : s < 90 ? `${s}s` : `${Math.round(s / 60)}m`);
const ago = (iso) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

function StatCard({ icon: Icon, value, label }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <span className="w-10 h-10 rounded-xl grid place-items-center bg-primary/15 text-primary shrink-0"><Icon size={18} /></span>
      <div><div className="text-xl font-semibold text-white">{value}</div><div className="text-slate-500 text-xs">{label}</div></div>
    </div>
  );
}

export default function SocialProof() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('feed');

  const load = useCallback(() => {
    api.get('/api/admin/social').then(setData).catch((e) => toast.error(e.message));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <PageLoader />;
  const { events = [], reviews = [], stats = {} } = data;

  const eventAction = async (id, patch) => {
    try { await api.patch(`/api/admin/social/events/${id}`, patch); load(); }
    catch (e) { toast.error(e.message); }
  };
  const deleteEvent = async (id) => {
    if (!confirm('Remove this feed entry permanently?')) return;
    try { await api.del(`/api/admin/social/events/${id}`); toast.success('Removed'); load(); }
    catch (e) { toast.error(e.message); }
  };
  const reviewAction = async (id, patch) => {
    try { await api.patch(`/api/admin/social/reviews/${id}`, patch); load(); }
    catch (e) { toast.error(e.message); }
  };
  const deleteReview = async (id) => {
    if (!confirm('Delete this review permanently?')) return;
    try { await api.del(`/api/admin/social/reviews/${id}`); toast.success('Deleted'); load(); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-2 mb-1">
        <Activity className="text-primary" size={22} />
        <h1 className="text-2xl text-white">Social proof</h1>
      </div>
      <p className="text-slate-400 text-sm mb-6">Moderate the live purchases feed and customer reviews. All data is real — captured from delivered orders.</p>

      {/* Real trust stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard icon={CheckCircle2} value={fmt(stats.delivered)} label="Orders delivered" />
        <StatCard icon={Clock} value={secs(stats.avgDeliverySeconds)} label="Avg delivery" />
        <StatCard icon={Gauge} value={secs(stats.fastestDeliverySeconds)} label="Fastest delivery" />
        <StatCard icon={Users} value={fmt(stats.verifiedBuyers)} label="Verified reviews" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('feed')} className={`chip ${tab === 'feed' ? 'chip-active' : ''}`}>Live feed ({events.length})</button>
        <button onClick={() => setTab('reviews')} className={`chip ${tab === 'reviews' ? 'chip-active' : ''}`}>Reviews ({reviews.length})</button>
      </div>

      {tab === 'feed' && (
        events.length === 0
          ? <div className="card p-8 text-center text-slate-400">No feed activity yet. Entries appear automatically when orders are delivered.</div>
          : <div className="space-y-2">
              {events.map((e) => (
                <div key={e.id} className={`card p-4 flex flex-wrap items-center gap-3 ${e.status === 'hidden' ? 'opacity-50' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-white text-sm">
                      <span className="font-semibold text-primary">{e.city ? `${e.name || 'Someone'} from ${e.city}` : (e.name || 'Someone')}</span> got {e.item}
                      {e.pinned && <Pin size={12} className="inline ml-1.5 text-amber-400" />}
                    </div>
                    <div className="text-slate-500 text-xs mt-0.5">
                      {e.deliverySeconds ? `Delivered in ${secs(e.deliverySeconds)} · ` : ''}{ago(e.createdAt)}
                      {e.orderNumber ? ` · ${e.orderNumber}` : ''}
                      {e.status === 'hidden' ? ' · hidden' : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => eventAction(e.id, { pinned: !e.pinned })} title={e.pinned ? 'Unpin' : 'Pin'}
                      className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5">{e.pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>
                    <button onClick={() => eventAction(e.id, { status: e.status === 'hidden' ? 'visible' : 'hidden' })} title={e.status === 'hidden' ? 'Show' : 'Hide'}
                      className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5">{e.status === 'hidden' ? <Eye size={16} /> : <EyeOff size={16} />}</button>
                    <button onClick={() => deleteEvent(e.id)} title="Delete"
                      className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-white/5"><Trash2 size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
      )}

      {tab === 'reviews' && (
        reviews.length === 0
          ? <div className="card p-8 text-center text-slate-400">No reviews yet.</div>
          : <div className="space-y-2">
              {reviews.map((r) => (
                <div key={r.id} className={`card p-4 ${r.status === 'hidden' ? 'opacity-50' : ''}`}>
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="flex text-amber-400">{Array.from({ length: r.stars || 5 }).map((_, i) => <Star key={i} size={13} fill="currentColor" />)}</div>
                        <span className="text-white text-sm font-medium">{r.author}</span>
                        {r.verified ? <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400"><BadgeCheck size={12} /> Verified buyer</span> : null}
                        <span className="text-[11px] text-slate-500">· {r.source}{r.status === 'hidden' ? ' · hidden' : ''}</span>
                      </div>
                      <p className="text-slate-300 text-sm">"{r.body}"</p>
                      <div className="text-slate-500 text-xs mt-1">{r.product ? `${r.product} · ` : ''}{r.city ? `${r.city} · ` : ''}{ago(r.createdAt)}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => reviewAction(r.id, { verified: !r.verified })} title={r.verified ? 'Remove verified' : 'Mark verified'}
                        className="p-2 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-white/5">{r.verified ? <ShieldOff size={16} /> : <BadgeCheck size={16} />}</button>
                      <button onClick={() => reviewAction(r.id, { status: r.status === 'hidden' ? 'visible' : 'hidden' })} title={r.status === 'hidden' ? 'Show' : 'Hide'}
                        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5">{r.status === 'hidden' ? <Eye size={16} /> : <EyeOff size={16} />}</button>
                      <button onClick={() => deleteReview(r.id)} title="Delete"
                        className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-white/5"><Trash2 size={16} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
      )}
    </div>
  );
}
