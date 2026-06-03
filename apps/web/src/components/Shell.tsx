'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Compass,
  Fish,
  Brain,
  Star,
  BookOpen,
  BarChart3,
  Bell,
  Settings,
  Sparkles,
  Menu,
  X,
  LogOut,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { clsx } from '@/lib/clsx';
import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/lib/useRealtime';
import { useNotifications } from '@/lib/useNotifications';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/discovery', label: 'Discovery', icon: Compass },
  { href: '/whales', label: 'Whales & Smart Money', icon: Fish },
  { href: '/intelligence', label: 'AI Brain', icon: Brain },
  { href: '/watchlist', label: 'Watchlist', icon: Star },
  { href: '/journal', label: 'Journal', icon: BookOpen },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/settings', label: 'Control Center', icon: Settings },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, accessToken, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { unread, push } = useNotifications();
  const { connected } = useRealtime({
    notifications: (p) => push(p),
  });

  useEffect(() => {
    if (!loading && !accessToken) router.replace('/login');
  }, [loading, accessToken, router]);

  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-pulse-glow rounded-2xl bg-brand-gradient px-6 py-4 font-display font-bold">
          MemeForge
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 w-64 transform border-r border-white/5 bg-ink-800/80 backdrop-blur-xl transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center gap-2 px-5">
          <Sparkles className="h-6 w-6 text-brand-300" />
          <span className="font-display text-xl font-extrabold tracking-tight">
            Meme<span className="text-brand-300">Forge</span>
          </span>
        </div>
        <nav className="mt-2 space-y-1 px-3">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={clsx(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                  active
                    ? 'bg-brand/15 text-white shadow-glow'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200',
                )}
              >
                <item.icon className="h-[18px] w-[18px]" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t border-white/5 p-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-200">{user.email}</div>
              <div className="text-[11px] uppercase tracking-wider text-brand-300">{user.role}</div>
            </div>
            <button onClick={logout} className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-down" title="Log out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex-1 lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/5 bg-ink-900/70 px-4 backdrop-blur-xl lg:px-8">
          <button className="lg:hidden" onClick={() => setOpen((o) => !o)}>
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
          <div className="hidden font-display text-sm text-slate-400 lg:block">
            {NAV.find((n) => pathname.startsWith(n.href))?.label ?? 'Terminal'}
          </div>
          <div className="flex items-center gap-3">
            <span
              className={clsx(
                'pill',
                connected ? 'bg-up/10 text-up' : 'bg-down/10 text-down',
              )}
            >
              {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {connected ? 'Live' : 'Offline'}
            </span>
            <Link href="/alerts" className="relative rounded-lg p-2 hover:bg-white/5">
              <Bell className="h-5 w-5 text-slate-300" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-down px-1 text-[10px] font-bold">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
