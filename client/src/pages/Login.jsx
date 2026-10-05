import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Shield, Eye, EyeOff, Lock, Mail, Building2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';

// Estate ("tenant") can come from the URL: /login?estate=greenville  or a sub-domain handled by the server.
const fromUrl = () => new URLSearchParams(window.location.search).get('estate') || '';

export default function Login() {
  const { user, login, savedEstate } = useAuth();
  const [estate, setEstate] = useState(fromUrl() || savedEstate);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!estate || !email || !password) return setError('Please fill in all fields');
    setLoading(true);
    try {
      const u = await login(estate.trim().toLowerCase(), email.trim(), password);
      toast.success(`Welcome back, ${u.name}!`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not sign in. Check your details and try again.');   // inline feedback, no silent failure
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-900 flex flex-col items-center justify-center p-4"
      style={{ backgroundImage: 'radial-gradient(ellipse at 30% 40%, rgba(15, 76, 53, 0.2) 0%, transparent 60%), radial-gradient(ellipse at 70% 70%, rgba(15, 76, 53, 0.15) 0%, transparent 50%)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-estate-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-estate-900/50">
            <Shield size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-display font-bold text-slate-100">Estatium</h1>
          <p className="text-slate-400 text-sm mt-1">Sign in to your estate</p>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 space-y-4" noValidate>
          {error && <div role="alert" className="text-sm text-red-300 bg-red-900/40 border border-red-800/50 rounded-lg px-3 py-2">{error}</div>}
          <div>
            <label className="label">Estate</label>
            <div className="relative">
              <Building2 size={16} className="absolute left-3 top-3 text-slate-500" />
              <input value={estate} onChange={e => setEstate(e.target.value)} className="input pl-9" placeholder="your-estate" autoCapitalize="none" autoComplete="organization" />
            </div>
          </div>
          <div>
            <label className="label">Email Address</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-3 text-slate-500" />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input pl-9" placeholder="your@email.com" autoComplete="email" />
            </div>
          </div>
          <div>
            <label className="label">Password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-3 text-slate-500" />
              <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} className="input pl-9 pr-9" placeholder="••••••••" autoComplete="current-password" />
              <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300" aria-label="Toggle password visibility">
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5 text-base">
            {loading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
