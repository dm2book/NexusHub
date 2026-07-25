import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, MessageCircle, LifeBuoy, Send, Loader2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import InfoShell from '../../components/InfoShell.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { usePageMeta } from '../../lib/useMeta.js';
import { SUPPORT_EMAIL } from '../../lib/support.js';

export default function Contact() {
  usePageMeta('Contact & support', 'Get help with an order, a payment or a delivery. Reach us on Discord or by email — we answer every message.');
  const { user } = useAuth();
  const toast = useToast();
  const { t } = useI18n();
  const [form, setForm] = useState({ subject: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/account/tickets', { subject: form.subject, message: form.message, category: 'general' });
      setDone(true); toast.success(t('contact.sent', 'Message sent — we opened a ticket for you.'));
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  return (
    <InfoShell eyebrow="Contact" title={t('contact.title', 'Get in touch')} narrow={false}
      subtitle={t('contact.sub', 'The fastest way to reach us is a support ticket — track the reply right in your dashboard.')}>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="space-y-4">
          <ContactCard icon={LifeBuoy} title={t('contact.ticket', 'Support ticket')} text={t('contact.ticketSub', 'Best for order issues. Tracked in your dashboard.')} />
          <ContactCard icon={MessageCircle} title="Discord" text={t('contact.discordSub', 'Join the community for quick help and updates.')} cta={<Link to="/discord" className="text-indigo-400 text-sm">{t('contact.openDiscord', 'Open Discord →')}</Link>} />
          {/* Only shown once a real address exists — an email card with no email
              in it is worse than no card. */}
          {SUPPORT_EMAIL && (
            <ContactCard icon={Mail} title="E-mail" text={SUPPORT_EMAIL}
              cta={<a href={`mailto:${SUPPORT_EMAIL}`} className="text-indigo-400 text-sm">{t('contact.sendEmail', 'Send an email →')}</a>} />
          )}
        </div>

        <div className="lg:col-span-2 card p-7">
          {!user ? (
            <div className="text-center py-10">
              <p className="text-slate-300">{t('contact.signInFirst', 'Sign in to open a tracked support ticket.')}</p>
              {/* Someone deciding whether to buy has no account yet — give them a
                  route that does not require making one. */}
              <p className="text-slate-400 text-sm mt-2">{t('contact.noAccount', 'No account? Ask us on Discord — you get an answer from a real person.')}</p>
              <div className="flex flex-wrap items-center justify-center gap-2.5 mt-5">
                <Link to="/discord" className="btn-primary inline-flex"><MessageCircle size={16} /> {t('contact.openDiscordShort', 'Ask on Discord')}</Link>
                <Link to="/login" className="btn-ghost inline-flex">{t('nav.login', 'Sign in')}</Link>
              </div>
            </div>
          ) : done ? (
            <div className="text-center py-10">
              <p className="text-white text-lg">{t('contact.gotIt', 'Thanks — we’ve got it. 🎉')}</p>
              <p className="text-slate-400 mt-2">{t('contact.trackIt', 'Track the conversation in your support area.')}</p>
              <Link to="/account/tickets" className="btn-primary mt-5 inline-flex">{t('contact.viewTickets', 'View my tickets')}</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <h3 className="text-white text-lg">{t('contact.formTitle', 'Send us a message')}</h3>
              <div><label className="label">{t('contact.subject', 'Subject')}</label>
                <input required className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
              <div><label className="label">{t('contact.message', 'Message')}</label>
                <textarea required rows={5} className="input" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></div>
              <button disabled={busy} className="btn-primary">{busy ? <Loader2 size={18} className="animate-spin" /> : <><Send size={16} /> {t('contact.send', 'Send message')}</>}</button>
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
