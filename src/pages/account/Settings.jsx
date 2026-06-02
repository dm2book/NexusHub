import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

export default function Settings() {
  const { user, reload } = useAuth();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const prefs = user?.preferences || {};
  const [emailOrderUpdates, setOrderUpdates] = useState(prefs.emailOrderUpdates !== false);
  const [emailMarketing, setMarketing] = useState(!!prefs.emailMarketing);

  const saveProfile = async () => {
    try { await api.patch('/api/account/profile', { displayName }); await reload(); toast.success('Profile updated.'); }
    catch (err) { toast.error(err.message); }
  };
  const savePrefs = async () => {
    try { await api.patch('/api/account/preferences', { emailOrderUpdates, emailMarketing });
      await reload(); toast.success('Preferences saved.'); }
    catch (err) { toast.error(err.message); }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl text-white">Profile settings</h1>

      <div className="card p-6">
        <h3 className="text-white mb-4">Profile</h3>
        <div className="space-y-4">
          <div><label className="label">Email</label>
            <input className="input opacity-60" value={user?.email} disabled /></div>
          <div><label className="label">Display name</label>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
          <button onClick={saveProfile} className="btn-primary">Save profile</button>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-white mb-4">Notifications</h3>
        <div className="space-y-3">
          <Toggle label="Order status emails" checked={emailOrderUpdates} onChange={setOrderUpdates} />
          <Toggle label="Product news & offers" checked={emailMarketing} onChange={setMarketing} />
          <button onClick={savePrefs} className="btn-primary mt-2">Save preferences</button>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-white mb-1">Roles</h3>
        <p className="text-slate-400 text-sm">{user?.roles?.join(', ') || 'customer'}</p>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-slate-300 text-sm">{label}</span>
      <button type="button" onClick={() => onChange(!checked)}
        className={`w-11 h-6 rounded-full transition relative ${checked ? 'bg-primary' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${checked ? 'left-5' : 'left-0.5'}`} />
      </button>
    </label>
  );
}
