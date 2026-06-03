'use client';

import useSWR from 'swr';
import { useState } from 'react';
import { Settings, Lock, Bell, Wallet, Shield } from 'lucide-react';
import { Card, SectionTitle, Skeleton, Pill } from '@/components/ui';
import { PROFIT_LOCK_OPTIONS } from '@memeforge/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { clsx } from '@/lib/clsx';

export default function SettingsPage() {
  const role = useAuth((s) => s.user?.role);
  const isOwner = role === 'OWNER';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold flex items-center gap-2"><Settings className="h-7 w-7 text-brand-300" /> Owner Control Center</h1>
        <p className="text-sm text-slate-400">Manage automation, notifications, wallets and access.</p>
      </div>

      {!isOwner && (
        <Card><div className="flex items-center gap-2 text-sm text-accent-gold"><Shield className="h-4 w-4" /> Only the Owner can modify automation and access settings.</div></Card>
      )}

      <NotificationPrefs />
      <ProfitLock disabled={!isOwner} />
      <Wallets disabled={!isOwner} />
      {isOwner && <AccessControl />}
    </div>
  );
}

function NotificationPrefs() {
  const { data, mutate } = useSWR<Record<string, boolean>>('/notifications/prefs');
  const channels = [
    { key: 'inApp', label: 'In-App' },
    { key: 'email', label: 'Email' },
    { key: 'discord', label: 'Discord' },
    { key: 'telegram', label: 'Telegram' },
    { key: 'push', label: 'Push' },
  ];
  async function toggle(key: string) {
    if (!data) return;
    await api.put('/notifications/prefs', { [key]: !data[key] });
    mutate();
  }
  return (
    <Card>
      <SectionTitle title="Notification channels" />
      {!data ? <Skeleton className="h-12" /> : (
        <div className="flex flex-wrap gap-2">
          {channels.map((c) => (
            <button key={c.key} onClick={() => toggle(c.key)} className={clsx('pill', data[c.key] ? 'bg-up/15 text-up' : 'bg-white/5 text-slate-500')}>
              <Bell className="h-3 w-3" /> {c.label} {data[c.key] ? 'on' : 'off'}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function ProfitLock({ disabled }: { disabled: boolean }) {
  const { data, mutate } = useSWR<{ enabled: boolean; sweepPct: number }>('/automation/profit-lock');
  async function setPct(pct: number) {
    await api.put('/automation/profit-lock', { sweepPct: pct, enabled: true });
    mutate();
  }
  async function toggle() {
    if (!data) return;
    await api.put('/automation/profit-lock', { enabled: !data.enabled });
    mutate();
  }
  return (
    <Card>
      <SectionTitle title="Profit lock" action={data && (
        <button disabled={disabled} onClick={toggle} className={clsx('pill', data.enabled ? 'bg-up/15 text-up' : 'bg-white/5 text-slate-500')}>
          <Lock className="h-3 w-3" /> {data.enabled ? 'Enabled' : 'Disabled'}
        </button>
      )} />
      <p className="text-xs text-slate-500">At end of day, move a percentage of realized profit into your reserve. Withdrawals always stay manual.</p>
      {!data ? <Skeleton className="mt-3 h-10" /> : (
        <div className="mt-3 flex gap-2">
          {PROFIT_LOCK_OPTIONS.map((p) => (
            <button key={p} disabled={disabled} onClick={() => setPct(p)} className={clsx('btn flex-1', data.sweepPct === p ? 'btn-primary' : 'btn-ghost')}>{p}%</button>
          ))}
        </div>
      )}
    </Card>
  );
}

function Wallets({ disabled }: { disabled: boolean }) {
  const { data, mutate } = useSWR<Array<{ id: string; label: string; address: string }>>('/portfolio/wallets');
  const [form, setForm] = useState({ label: '', address: '' });
  async function add() {
    await api.post('/portfolio/wallets', form);
    setForm({ label: '', address: '' });
    mutate();
  }
  return (
    <Card>
      <SectionTitle title="Wallets" />
      {!data ? <Skeleton className="h-12" /> : (
        <div className="space-y-2">
          {data.map((w) => (
            <div key={w.id} className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2">
              <Wallet className="h-4 w-4 text-brand-300" />
              <span className="font-semibold">{w.label}</span>
              <span className="truncate font-mono text-xs text-slate-500">{w.address}</span>
            </div>
          ))}
        </div>
      )}
      {!disabled && (
        <div className="mt-3 flex gap-2">
          <input className="input" placeholder="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <input className="input" placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <button className="btn-primary" onClick={add} disabled={!form.label || !form.address}>Add</button>
        </div>
      )}
    </Card>
  );
}

function AccessControl() {
  const { data, mutate } = useSWR<Array<{ id: string; email: string; role: string }>>('/admin/users');
  const { data: status } = useSWR<{ users: number; openPositions: number; activeAlerts: number; trackedTokens: number; realtimeConnections: number }>('/admin/status');
  async function setRole(id: string, roleVal: string) {
    await api.patch(`/admin/users/${id}/role`, { role: roleVal });
    mutate();
  }
  return (
    <Card>
      <SectionTitle title="Access control" />
      {status && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[['Users', status.users], ['Open pos', status.openPositions], ['Alerts', status.activeAlerts], ['Tokens', status.trackedTokens], ['Live conns', status.realtimeConnections]].map(([l, v]) => (
            <div key={l as string} className="rounded-lg bg-white/[0.03] p-3 text-center"><div className="stat-label">{l}</div><div className="font-display font-bold">{v as number}</div></div>
          ))}
        </div>
      )}
      {!data ? <Skeleton className="h-16" /> : (
        <div className="space-y-2">
          {data.map((u) => (
            <div key={u.id} className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2">
              <span className="flex-1 truncate text-sm">{u.email}</span>
              {u.role === 'OWNER' ? <Pill kind="up">OWNER</Pill> : (
                <select className="rounded-lg bg-ink-800 border border-white/10 px-2 py-1 text-xs" value={u.role} onChange={(e) => setRole(u.id, e.target.value)}>
                  <option value="VIEWER">VIEWER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
