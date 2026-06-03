import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, MessageCircle, LifeBuoy, Send, Loader2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import InfoShell from '../../components/InfoShell.jsx';

export default function Contact() {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ subject: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/account/tickets', { subject: form.subject, message: form.message, category: 'general' });
      setDone(true); toast.success('Message sent — we opened a ticket for you.');
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  return (
    <InfoShell eyebrow="Contact" title="Get in touch" narrow={false}
      subtitle="The fastest way to reach us is a support ticket — track the reply right in your dashboard.">
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="space-y-4">
          <ContactCard icon={LifeBuoy} title="Support ticket" text="Best for order issues. Tracked in your dashboard." />
          <ContactCard icon={MessageCircle} title="Discord" text="Join the community for quick help and updates." cta={<Link to="/discord" className="text-indigo-400 text-sm">Open Discord →</Link>} />
          <ContactCard icon={Mail} title="Email" text="Prefer email? Reach the team anytime." />
        </div>

        <div className="lg:col-span-2 card p-7">
          {!user ? (
            <div className="text-center py-10">
              <p className="text-slate-300">Sign in to open a tracked support ticket.</p>
              <Link to="/login" className="btn-primary mt-5 inline-flex">Sign in</Link>
            </div>
          ) : done ? (
            <div className="text-center py-10">
              <p className="text-white text-lg">Thanks — we’ve got it. 🎉</p>
              <p className="text-slate-400 mt-2">Track the conversation in your support area.</p>
              <Link to="/account/tickets" className="btn-primary mt-5 inline-flex">View my tickets</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <h3 className="text-white text-lg">Send us a message</h3>
              <div><label className="label">Subject</label>
                <input required className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
              <div><label className="label">Message</label>
                <textarea required rows={5} className="input" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></div>
              <button disabled={busy} className="btn-primary">{busy ? <Loader2 size={18} className="animate-spin" /> : <><Send size={16} /> Send message</>}</button>
            </form>
          )}
        </div>
      </div>
    </InfoShell>
  );
}

function ContactCard({ icon: Icon, title, text, cta }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center"><Icon size={17} className="text-primary" /></div>
        <h3 className="text-white">{title}</h3>
      </div>
      <p className="text-slate-400 text-sm">{text}</p>
      {cta && <div className="mt-2">{cta}</div>}
    </div>
  );
}
