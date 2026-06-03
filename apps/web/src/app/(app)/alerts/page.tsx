'use client';

import useSWR from 'swr';
import { Bell, BellRing, Check } from 'lucide-react';
import { Card, SectionTitle, Skeleton, Pill, Empty } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { api } from '@/lib/api';
import { useNotifications } from '@/lib/useNotifications';
import { useEffect } from 'react';

interface Notification {
  id: string;
  title: string;
  body: string;
  emoji?: string;
  readAt?: string | null;
  createdAt: string;
}

interface Alert {
  id: string;
  type: string;
  threshold?: number;
  enabled: boolean;
  token?: { symbol: string };
}

export default function AlertsPage() {
  const { data: notifData, mutate } = useSWR<{ items: Notification[]; unread: number }>('/notifications');
  const { data: alerts, mutate: mutateAlerts } = useSWR<Alert[]>('/alerts');
  const setItems = useNotifications((s) => s.setItems);

  useEffect(() => {
    if (notifData) setItems(notifData.items);
  }, [notifData, setItems]);

  async function markAll() {
    await api.post('/notifications/read', { all: true });
    mutate();
  }
  async function toggle(a: Alert) {
    await api.patch(`/alerts/${a.id}`, { enabled: !a.enabled });
    mutateAlerts();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold flex items-center gap-2"><Bell className="h-7 w-7 text-brand-300" /> Alerts & Notifications</h1>
          <p className="text-sm text-slate-400">Price, volume, whale and risk alerts across all channels.</p>
        </div>
        <button className="btn-ghost" onClick={markAll}><Check className="h-4 w-4" /> Mark all read</button>
      </div>

      <Card>
        <SectionTitle title="Active alert rules" />
        {!alerts ? <Skeleton className="h-20" /> : alerts.length === 0 ? (
          <p className="text-sm text-slate-500">No alert rules configured.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {alerts.map((a) => (
              <button key={a.id} onClick={() => toggle(a)} className={`pill ${a.enabled ? 'bg-brand/20 text-brand-300' : 'bg-white/5 text-slate-500'}`}>
                <BellRing className="h-3 w-3" /> {a.token?.symbol ?? 'any'} {a.type} {a.threshold ?? ''}
              </button>
            ))}
          </div>
        )}
      </Card>

      <SectionTitle title="Recent notifications" />
      {!notifData ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : notifData.items.length === 0 ? (
        <Empty title="No notifications yet" hint="Alerts will appear here in realtime." />
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="divide-y divide-white/5">
            {notifData.items.map((n) => (
              <div key={n.id} className={`flex items-start gap-3 px-4 py-3 ${!n.readAt ? 'bg-brand/[0.04]' : ''}`}>
                <span className="text-xl">{n.emoji ?? '🔔'}</span>
                <div className="flex-1">
                  <div className="font-display font-semibold">{n.title}</div>
                  <div className="text-sm text-slate-400">{n.body}</div>
                </div>
                <div className="flex items-center gap-2">
                  {!n.readAt && <Pill kind="up">new</Pill>}
                  <span className="text-xs text-slate-500">{timeAgo(n.createdAt)} ago</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
