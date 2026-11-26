import { useState, useEffect } from 'react';
import { Save, Settings as SettingsIcon } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { logoToDataUri } from '../utils/logo';

const CATS = [['MAINTENANCE', 'Monthly maintenance charge'], ['AMENITY', 'Amenity bookings'], ['REPAIR', 'Repair & maintenance work'], ['OTHER', 'Other bills (utility, penalty, one-time)']];

function TaxEditor({ taxes, onChange }) {
  const set = (i, patch) => onChange(taxes.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <div className="space-y-2">
      {taxes.length === 0 && <p className="text-xs text-slate-500">No tax: invoices show the price only.</p>}
      {taxes.map((t, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input className="input flex-1" placeholder="Tax name, e.g. VAT" maxLength={40} value={t.name} onChange={(e) => set(i, { name: e.target.value })} />
          <input type="number" min="0" max="100" step="0.01" className="input w-24" placeholder="%" value={t.rate} onChange={(e) => set(i, { rate: e.target.value })} /><span className="text-slate-500 text-sm">%</span>
          <button type="button" className="btn-ghost text-xs text-red-400" onClick={() => onChange(taxes.filter((_, j) => j !== i))}>Remove</button>
        </div>))}
      {taxes.length < 5 && <button type="button" className="btn-ghost text-xs text-estate-400" onClick={() => onChange([...taxes, { name: '', rate: '' }])}>+ Add a tax</button>}
    </div>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/settings').then(setSettings).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const bc = settings.billing_config;
  const setBc = (patch) => setSettings((s) => ({ ...s, billing_config: { ...s.billing_config, ...patch } }));
  const pickLogo = async (e) => { const file = e.target.files?.[0]; if (!file) return; try { const uri = await logoToDataUri(file); setSettings((s) => ({ ...s, estate_logo: uri })); } catch (x) { toast.error(x.message); } };

  const save = async () => {
    setSaving(true);
    try {
      const { currency, currency_locked, maintenance_charge, ...rest } = settings;
      await api.put('/settings', { ...rest, estate_logo: settings.estate_logo || '' });
      toast.success('Settings saved');
    } catch {} finally { setSaving(false); }
  };

  const fields = [
    { key: 'estate_name', label: 'Estate Name', placeholder: 'GreenVille Estate' },
    { key: 'estate_address', label: 'Estate Address', placeholder: '12 Palm Avenue, Lagos' },
    { key: 'currency', label: 'Billing Currency (managed by the platform)', placeholder: '', locked: true },
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

      {bc && (
        <div className="card p-6 space-y-6">
          <div>
            <p className="text-sm font-semibold text-estate-400 uppercase tracking-wider">Billing &amp; invoices</p>
            <p className="text-xs text-slate-500 mt-1">Every bill is an invoice with a number. Residents and the admin can download it and see the history under Billing. Taxes are added on top of the price.</p>
          </div>
          <div>
            <label className="label">Estate logo (shown on invoices)</label>
            <div className="flex items-center gap-4">
              {settings.estate_logo ? <img src={settings.estate_logo} alt="logo" className="h-16 max-w-[160px] object-contain bg-white rounded p-1" /> : <div className="h-16 w-16 rounded border border-dashed border-slate-700 text-xs text-slate-500 flex items-center justify-center">No logo</div>}
              <div className="space-y-1">
                <input type="file" accept="image/png,image/jpeg" className="text-sm" onChange={pickLogo} />
                {settings.estate_logo && <button type="button" className="btn-ghost text-xs text-red-400" onClick={() => setSettings({ ...settings, estate_logo: '' })}>Remove logo</button>}
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-200">Monthly maintenance (recurring)</p>
            <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={bc.monthly.auto} onChange={(e) => setBc({ monthly: { ...bc.monthly, auto: e.target.checked } })} /> Create the maintenance invoice automatically every month for all residents</label>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">Amount per resident</label><input type="number" min="0" className="input" value={bc.monthly.amount} onChange={(e) => setBc({ monthly: { ...bc.monthly, amount: e.target.value } })} /></div>
              <div><label className="label">Invoice on day (1-28)</label><input type="number" min="1" max="28" className="input" value={bc.monthly.day} onChange={(e) => setBc({ monthly: { ...bc.monthly, day: e.target.value } })} /></div>
              <div><label className="label">Due after (days)</label><input type="number" min="1" max="60" className="input" value={bc.monthly.dueDays} onChange={(e) => setBc({ monthly: { ...bc.monthly, dueDays: e.target.value } })} /></div>
            </div>
          </div>
          <div className="space-y-4">
            <p className="text-sm font-medium text-slate-200">Taxes by category</p>
            {CATS.map(([k, label]) => (<div key={k}><p className="text-xs text-slate-400 mb-1">{label}</p><TaxEditor taxes={bc.taxes[k]} onChange={(t) => setBc({ taxes: { ...bc.taxes, [k]: t } })} /></div>))}
          </div>
          <div className="space-y-3">
            <div><label className="label">How to pay (bank details shown on the invoice)</label><textarea className="input resize-none h-16" maxLength={300} value={bc.invoice.payTo} onChange={(e) => setBc({ invoice: { ...bc.invoice, payTo: e.target.value } })} placeholder="Bank, account name, account number" /></div>
            <div><label className="label">Invoice footer note</label><input className="input" maxLength={300} value={bc.invoice.footer} onChange={(e) => setBc({ invoice: { ...bc.invoice, footer: e.target.value } })} placeholder="Thank you for living with us" /></div>
          </div>
          <p className="text-xs text-slate-500">Press <b>Save Changes</b> at the top to apply. New taxes affect invoices created from now on; invoices already issued do not change.</p>
        </div>
      )}

      <div className="card p-5">
        <p className="text-sm font-semibold text-slate-300 mb-2">Alert sounds &amp; notifications</p>
        <p className="text-slate-400 text-sm">Every person turns these on for their own phone or computer with the speaker icon at the top of the screen: <b>Turn on notifications</b>, then use the Test buttons to hear the visitor doorbell, the chat/notice pops and the emergency siren.</p>
      </div>

      <div className="card p-5">
        <p className="text-sm font-semibold text-slate-300 mb-3">System Information</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-slate-500">Version</p><p className="text-slate-300">Pilot</p></div>
          <div><p className="text-slate-500">Database</p><p className="text-slate-300">PostgreSQL</p></div>
          <div><p className="text-slate-500">Backend</p><p className="text-slate-300">Node.js + Express</p></div>
          <div><p className="text-slate-500">Frontend</p><p className="text-slate-300">React PWA (Vite)</p></div>
          <div><p className="text-slate-500">Real-time</p><p className="text-slate-300">Socket.io</p></div>
          <div><p className="text-slate-500">Notifications</p><p className="text-slate-300">Web Push</p></div>
        </div>
      </div>
    </div>
  );
}
