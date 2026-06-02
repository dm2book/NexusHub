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
      // Try existing access token, else attempt a refresh from the cookie.
      if (!getAccessToken()) await api.refresh().catch(() => {});
      if (getAccessToken()) await loadMe();
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
