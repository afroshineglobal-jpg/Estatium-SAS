import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  LayoutDashboard, Users, UserCheck, Package, CalendarRange,
  CreditCard, Receipt, Car, Briefcase, Wrench, AlertTriangle,
  MessageSquare, BarChart3, Megaphone, Settings, LogOut,
  Shield, ChevronRight
} from 'lucide-react';

const allModules = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ['ADMIN', 'SECURITY_ADMIN', 'FINANCE_ADMIN', 'MAINTENANCE_MANAGER', 'RESIDENT', 'GUARD'] },
  { path: '/residents', icon: Users, label: 'Residents', roles: ['ADMIN', 'SECURITY_ADMIN', 'FINANCE_ADMIN'] },
  { path: '/visitors', icon: UserCheck, label: 'Visitors', roles: ['ADMIN', 'SECURITY_ADMIN', 'RESIDENT', 'GUARD'] },
  { path: '/parcels', icon: Package, label: 'Parcels', roles: ['ADMIN', 'SECURITY_ADMIN', 'RESIDENT', 'GUARD'] },
  { path: '/amenities', icon: CalendarRange, label: 'Amenities', roles: ['ADMIN', 'RESIDENT'] },
  { path: '/billing', icon: CreditCard, label: 'Billing', roles: ['ADMIN', 'FINANCE_ADMIN', 'RESIDENT'] },
  { path: '/vehicles', icon: Car, label: 'Vehicles', roles: ['ADMIN', 'SECURITY_ADMIN', 'RESIDENT', 'GUARD'] },
  { path: '/staff', icon: Briefcase, label: 'Staff', roles: ['ADMIN', 'SECURITY_ADMIN', 'MAINTENANCE_MANAGER'] },
  { path: '/maintenance', icon: Wrench, label: 'Maintenance', roles: ['ADMIN', 'MAINTENANCE_MANAGER', 'RESIDENT'] },
  { path: '/emergency', icon: AlertTriangle, label: 'Emergency', roles: ['ADMIN', 'SECURITY_ADMIN', 'RESIDENT', 'GUARD'] },
  { path: '/communication', icon: MessageSquare, label: 'Communication', roles: ['ADMIN', 'SECURITY_ADMIN', 'FINANCE_ADMIN', 'MAINTENANCE_MANAGER', 'RESIDENT', 'GUARD'] },
  { path: '/analytics', icon: BarChart3, label: 'Analytics', roles: ['ADMIN', 'FINANCE_ADMIN', 'SECURITY_ADMIN'] },
  { path: '/advertisements', icon: Megaphone, label: 'Ads & Banners', roles: ['ADMIN', 'FINANCE_ADMIN', 'RESIDENT'] },
  { path: '/subscription', icon: Receipt, label: 'Subscription', roles: ['ADMIN', 'FINANCE_ADMIN'] },
  { path: '/settings', icon: Settings, label: 'Settings', roles: ['ADMIN'] },
];

const roleColors = {
  ADMIN: 'text-purple-300 bg-purple-900/50 border-purple-700/40',
  SECURITY_ADMIN: 'text-blue-300 bg-blue-900/50 border-blue-700/40',
  FINANCE_ADMIN: 'text-amber-300 bg-amber-900/50 border-amber-700/40',
  MAINTENANCE_MANAGER: 'text-orange-300 bg-orange-900/50 border-orange-700/40',
  RESIDENT: 'text-estate-300 bg-estate-900/50 border-estate-700/40',
  GUARD: 'text-slate-300 bg-slate-800/50 border-slate-600/40',
  STAFF: 'text-slate-300 bg-slate-800/50 border-slate-600/40',
};

export default function Sidebar({ isOpen, onClose }) {
  const { user, logout, tenant } = useAuth();
  const location = useLocation();
  if (!user) return null;

  const navItems = allModules.filter(m => m.roles.includes(user.role));

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={onClose} />}
      <aside className={`fixed top-0 left-0 h-full bg-surface-950 border-r border-slate-800/60 z-40 flex flex-col transition-transform duration-300
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
        style={{ width: 'var(--sidebar-width)' }}>

        {/* Logo */}
        <div className="p-5 border-b border-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-estate-600 flex items-center justify-center">
              <Shield size={18} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-display font-semibold text-slate-100 leading-none">{tenant?.name || 'Estatium'}</p>
              <p className="text-xs text-slate-500 mt-0.5">Estate Management</p>
            </div>
          </div>
        </div>

        {/* User info */}
        <div className="px-3 py-4 border-b border-slate-800/60">
          <div className="flex items-center gap-3 px-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-estate-700 to-estate-900 flex items-center justify-center text-sm font-semibold text-white flex-shrink-0">
              {user.name?.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{user.name}</p>
              <span className={`badge text-xs border ${roleColors[user.role] || 'badge-gray'}`}>
                {user.role?.replace('_', ' ')}
              </span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {navItems.map(({ path, icon: Icon, label }) => {
            const active = location.pathname === path;
            return (
              <Link key={path} to={path} onClick={onClose}
                className={active ? 'nav-item-active' : 'nav-item'}>
                <Icon size={18} className={active ? 'text-estate-400' : ''} />
                <span className="flex-1">{label}</span>
                {active && <ChevronRight size={14} className="text-estate-500" />}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="p-3 border-t border-slate-800/60">
          <button onClick={logout} className="nav-item w-full text-red-400 hover:text-red-300 hover:bg-red-900/20">
            <LogOut size={18} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
