import { useState, useEffect } from 'react';
import { Save, Settings as SettingsIcon } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/settings').then(setSettings).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', settings);
      toast.success('Settings saved');
    } catch {} finally { setSaving(false); }
  };

  const fields = [
    { key: 'estate_name', label: 'Estate Name', placeholder: 'GreenVille Estate' },
    { key: 'estate_address', label: 'Estate Address', placeholder: '12 Palm Avenue, Lagos' },
    { key: 'currency', label: 'Billing Currency (managed by the platform)', placeholder: '', locked: true },
    { key: 'maintenance_charge', label: 'Monthly Maintenance Charge', placeholder: '15000', type: 'number' },
    { key: 'security_contact', label: 'Security Emergency Number', placeholder: '+2348001234567' },
    { key: 'admin_email', label: 'Admin Email', placeholder: 'admin@estate.com' },
    { key: 'visitor_auto_expire_hours', label: 'Visitor Code Expiry (hours)', placeholder: '24', type: 'number' },
    { key: 'max_family_members', label: 'Max Family Members per Unit', placeholder: '15', type: 'number' },
  ];

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-estate-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-5 animate-fade-in max-w-2xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="text-slate-500 text-sm">Estate configuration</p>
        </div>
        <button className="btn-primary" onClick={save} disabled={saving}>
          <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      <div className="card p-6 space-y-5">
        <p className="text-sm font-semibold text-estate-400 uppercase tracking-wider">General Settings</p>
        {fields.map(f => (
          <div key={f.key}>
            <label className="label">{f.label}</label>
            <input
              type={f.type || 'text'}
              className="input"
              disabled={f.locked}
              placeholder={f.placeholder}
              value={settings[f.key] || ''}
              onChange={e => setSettings({...settings, [f.key]: e.target.value})}
            />
          </div>
        ))}
      </div>

      <div className="card p-5 border-amber-900/30">
        <p className="text-sm font-semibold text-amber-400 mb-3">Firebase Configuration</p>
        <p className="text-slate-400 text-sm">To enable push notifications, add your Firebase credentials to the <code className="bg-surface-800 px-1.5 py-0.5 rounded text-estate-300 text-xs">.env</code> file on the server:</p>
        <div className="mt-3 bg-surface-900 rounded-xl p-4 font-mono text-xs text-slate-400 space-y-1">
          <p>FIREBASE_PROJECT_ID=your-project-id</p>
          <p>FIREBASE_PRIVATE_KEY=your-private-key</p>
          <p>FIREBASE_CLIENT_EMAIL=your-client-email</p>
        </div>
        <p className="text-slate-500 text-xs mt-3">Get these from Firebase Console → Project Settings → Service Accounts → Generate new private key</p>
      </div>

      <div className="card p-5">
        <p className="text-sm font-semibold text-slate-300 mb-3">System Information</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-slate-500">Version</p><p className="text-slate-300">1.0.0 POC</p></div>
          <div><p className="text-slate-500">Database</p><p className="text-slate-300">SQLite (Prisma)</p></div>
          <div><p className="text-slate-500">Backend</p><p className="text-slate-300">Node.js + Express</p></div>
          <div><p className="text-slate-500">Frontend</p><p className="text-slate-300">React PWA (Vite)</p></div>
          <div><p className="text-slate-500">Real-time</p><p className="text-slate-300">Socket.io</p></div>
          <div><p className="text-slate-500">Notifications</p><p className="text-slate-300">Firebase FCM</p></div>
        </div>
      </div>
    </div>
  );
}
