import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { TOKEN_KEY } from '../utils/api';
import { setCurrency } from '../utils/money';

const AuthContext = createContext(null);
const TENANT_KEY = 'estate_slug';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((u, t) => { setUser(u); setTenant(t || null); if (t) setCurrency(t.currency); }, []);

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) { setLoading(false); return; }
    api.get('/auth/me')
      .then(({ tenant: t, ...u }) => apply(u, t))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, [apply]);

  // SUSPENDED / EXPIRED are discovered on any API call (see utils/api.js) — reflect them in the UI immediately.
  useEffect(() => {
    const h = (e) => setTenant((t) => (t ? { ...t, status: e.detail.status, readOnly: e.detail.status === 'SUSPENDED' } : t));
    window.addEventListener('tenant-status', h);
    return () => window.removeEventListener('tenant-status', h);
  }, []);

  const login = async (estate, email, password) => {
    const data = await api.post('/auth/login', { tenant: estate, email, password });
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(TENANT_KEY, estate);
    apply({ ...data.user, mustChangePassword: data.mustChangePassword }, data.tenant);
    return data.user;
  };

  const changePassword = async (currentPassword, newPassword) => {
    const r = await api.put('/auth/password', { currentPassword, newPassword });
    localStorage.setItem(TOKEN_KEY, r.token);
    setUser((u) => ({ ...u, mustChangePassword: false }));
  };

  const logout = () => { localStorage.removeItem(TOKEN_KEY); setUser(null); setTenant(null); };

  const can = (...roles) => user && roles.includes(user.role);
  const isAdmin = () => can('ADMIN', 'SECURITY_ADMIN', 'FINANCE_ADMIN', 'MAINTENANCE_MANAGER');
  const isGuard = () => can('GUARD');
  const isResident = () => can('RESIDENT');

  return (
    <AuthContext.Provider value={{ user, tenant, loading, login, logout, changePassword, can, isAdmin, isGuard, isResident, savedEstate: localStorage.getItem(TENANT_KEY) || '' }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
