'use client';

import { create } from 'zustand';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  emoji?: string;
  readAt?: string | null;
  createdAt: string;
}

interface NotifState {
  items: NotificationItem[];
  unread: number;
  setItems: (items: NotificationItem[]) => void;
  push: (payload: unknown) => void;
}

export const useNotifications = create<NotifState>((set) => ({
  items: [],
  unread: 0,
  setItems: (items) => set({ items, unread: items.filter((i) => !i.readAt).length }),
  push: (payload) => {
    const data = payload as { kind?: string; notification?: NotificationItem };
    if (data?.kind === 'new' && data.notification) {
      const n = data.notification;
      set((s) => ({ items: [n, ...s.items].slice(0, 100), unread: s.unread + 1 }));
      // Best-effort browser notification.
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(`${n.emoji ?? ''} ${n.title}`, { body: n.body });
      }
    }
  },
}));
