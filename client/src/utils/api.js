import axios from 'axios';
import toast from 'react-hot-toast';

export const TOKEN_KEY = 'token';
export const PLATFORM_TOKEN_KEY = 'platform_token';

const make = (key, loginPath, baseURL) => {
  const inst = axios.create({ baseURL, timeout: 15000 });
  inst.interceptors.request.use((config) => {
    const t = localStorage.getItem(key);
    if (t) config.headers.Authorization = `Bearer ${t}`;
    return config;
  });
  inst.interceptors.response.use(
    (res) => res.data,
    (err) => {
      const status = err.response?.status;
      const data = err.response?.data || {};
      const msg = data.error || err.message || 'An error occurred';
      const isLogin = /\/auth\/login$/.test(err.config?.url || '');
      if (status === 401 && !isLogin) {
        localStorage.removeItem(key);
        if (!window.location.pathname.startsWith(loginPath)) window.location.href = loginPath;
      } else if (status === 402 || data.code === 'TENANT_EXPIRED') {
        window.dispatchEvent(new CustomEvent('tenant-status', { detail: { status: 'EXPIRED' } }));
      } else if (data.code === 'TENANT_SUSPENDED') {
        window.dispatchEvent(new CustomEvent('tenant-status', { detail: { status: 'SUSPENDED' } }));
        toast.error(msg);
      } else if (data.code === 'UNIT_CAP_EXCEEDED') {
        toast.error(msg, { duration: 8000 });
      } else {
        toast.error(msg);          // login failures now show "Invalid credentials" instead of silently reloading
      }
      return Promise.reject(err);
    }
  );
  return inst;
};

const api = make(TOKEN_KEY, '/login', '/api');
export const platformApi = make(PLATFORM_TOKEN_KEY, '/platform/login', '/api/platform');
export default api;
