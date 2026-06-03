'use client';

import { create } from 'zustand';
import { API_URL } from './config';

interface User {
  id: string;
  email: string;
  name?: string;
  role: 'OWNER' | 'ADMIN' | 'VIEWER';
  avatarUrl?: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  loading: boolean;
  setTokens: (access: string, refresh: string) => void;
  loadFromStorage: () => void;
  fetchMe: () => Promise<void>;
  logout: () => void;
}

const ACCESS_KEY = 'mf_access';
const REFRESH_KEY = 'mf_refresh';

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  loading: true,

  setTokens: (access, refresh) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(ACCESS_KEY, access);
      localStorage.setItem(REFRESH_KEY, refresh);
    }
    set({ accessToken: access, refreshToken: refresh });
  },

  loadFromStorage: () => {
    if (typeof window === 'undefined') return;
    const access = localStorage.getItem(ACCESS_KEY);
    const refresh = localStorage.getItem(REFRESH_KEY);
    set({ accessToken: access, refreshToken: refresh });
    if (access) void get().fetchMe();
    else set({ loading: false });
  },

  fetchMe: async () => {
    const token = get().accessToken;
    if (!token) return set({ loading: false });
    try {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const json = await res.json();
        set({ user: json.data, loading: false });
      } else if (res.status === 401) {
        await tryRefresh(set, get);
      } else {
        set({ loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
    }
    set({ user: null, accessToken: null, refreshToken: null });
  },
}));

async function tryRefresh(
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState,
) {
  const refresh = get().refreshToken;
  if (!refresh) return set({ loading: false, user: null });
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (res.ok) {
      const json = await res.json();
      get().setTokens(json.data.accessToken, json.data.refreshToken);
      await get().fetchMe();
    } else {
      get().logout();
      set({ loading: false });
    }
  } catch {
    set({ loading: false });
  }
}
