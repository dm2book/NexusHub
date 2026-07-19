import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setAccessToken, getAccessToken } from '../lib/api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    try {
      const { user } = await api.get('/api/auth/me');
      setUser(user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      // Silent sign-in ladder — a returning customer never sees a login screen:
      //  1. access token in this tab (fast path)
      //  2. refresh-session cookie (30 days, sliding)
      //  3. trusted-device cookie (60 days, sliding) → brand-new session
      if (!getAccessToken()) await api.refresh().catch(() => {});
      if (!getAccessToken()) {
        try {
          const { accessToken } = await api.post('/api/auth/device-login');
          if (accessToken) setAccessToken(accessToken);
        } catch { /* no trusted device — stay guest */ }
      }
      if (getAccessToken()) {
        try {
          const { user } = await api.get('/api/auth/me');
          setUser(user);
        } catch {
          // Stale/expired token in storage: clear it and retry the ladder
          // (refresh cookie, then trusted device) instead of rendering the
          // returning customer as a guest on every reload.
          setAccessToken(null);
          await api.refresh().catch(() => {});
          if (!getAccessToken()) {
            try {
              const { accessToken } = await api.post('/api/auth/device-login');
              if (accessToken) setAccessToken(accessToken);
            } catch { /* stay guest */ }
          }
          if (getAccessToken()) await loadMe();
        }
      }
      setLoading(false);
    })();
  }, [loadMe]);

  const login = useCallback(async (token) => {
    setAccessToken(token);
    await loadMe();
  }, [loadMe]);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => {});
    setAccessToken(null);
    setUser(null);
  }, []);

  const hasPermission = useCallback((perm) => {
    if (!user) return false;
    if (user.roles?.includes('owner')) return true;
    return user.permissions?.includes(perm);
  }, [user]);

  const isStaff = !!user && user.roles?.some((r) => r !== 'customer');

  return (
    <AuthContext.Provider value={{
      user, loading, login, logout, reload: loadMe, hasPermission, isStaff,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
