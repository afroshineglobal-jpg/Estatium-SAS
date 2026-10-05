import { useState, useEffect } from 'react';
import { Bell, Menu, AlertTriangle, X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import api from '../../utils/api';

export default function Header({ onMenuToggle }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);

  const fetchNotifs = async () => {
    try {
      const data = await api.get('/auth/notifications');
      setNotifications(data.slice(0, 20));
    } catch {}
  };

  useEffect(() => {
    fetchNotifs();
    const i = setInterval(fetchNotifs, 30000);
    return () => clearInterval(i);
  }, []);

  const unread = notifications.filter(n => !n.isRead).length;

  const markRead = async () => {
    await api.put('/auth/notifications/read').catch(() => {});
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  return (
    <header className="fixed top-0 right-0 left-0 lg:left-[var(--sidebar-width)] bg-surface-950/95 backdrop-blur border-b border-slate-800/60 z-20 flex items-center px-4 gap-3"
      style={{ height: 'var(--header-height)' }}>

      <button onClick={onMenuToggle} className="lg:hidden btn-ghost p-2">
        <Menu size={20} />
      </button>

      <div className="flex-1" />

      {/* Notifications */}
      <div className="relative">
        <button onClick={() => { setShowNotifs(v => !v); if (!showNotifs) markRead(); }}
          className="btn-ghost p-2 relative">
          <Bell size={20} />
          {unread > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center font-bold">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {showNotifs && (
          <div className="absolute right-0 top-full mt-2 w-80 card border-slate-700 shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <span className="text-sm font-semibold text-slate-200">Notifications</span>
              <button onClick={() => setShowNotifs(false)}><X size={16} className="text-slate-400" /></button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="text-center text-slate-500 py-8 text-sm">No notifications</p>
              ) : notifications.map(n => (
                <div key={n.id} className={`px-4 py-3 border-b border-slate-800/50 ${!n.isRead ? 'bg-estate-950/40' : ''}`}>
                  <div className="flex items-start gap-2">
                    {n.type === 'EMERGENCY' && <AlertTriangle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />}
                    <div>
                      <p className="text-sm font-medium text-slate-200">{n.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{n.body}</p>
                      <p className="text-xs text-slate-600 mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-estate-700 to-estate-900 flex items-center justify-center text-sm font-semibold text-white">
        {user?.name?.charAt(0).toUpperCase()}
      </div>
    </header>
  );
}
