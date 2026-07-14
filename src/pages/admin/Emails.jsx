import { useEffect, useState } from 'react';
import { Mail, Eye, Send, Save, Megaphone } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageLoader } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

export default function Emails() {
  const toast = useToast();
  const [tab, setTab] = useState('templates');
  const [templates, setTemplates] = useState(null);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState('');

  const load = () => api.get('/api/admin/emails').then((r) => { setTemplates(r.templates); }).catch(() => setTemplates([]));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (templates && !selected) setSelected(templates[0]); }, [templates]);
  if (!templates) return <PageLoader />;

  const save = async () => {
    try {
      await api.put(`/api/admin/emails/${selected.id}`, {
        subject: selected.subject, bodyHtml: selected.body_html, enabled: !!selected.enabled,
      });
      toast.success('Template saved.'); load();
    } catch (err) { toast.error(err.message); }
  };
  const doPreview = async () => {
    try { const r = await api.post(`/api/admin/emails/${selected.id}/preview`); setPreview(r.html); }
    catch (err) { toast.error(err.message); }
  };
  const sendTest = async () => {
    try { const r = await api.post(`/api/admin/emails/${selected.id}/test`); toast.success(`Test sent to ${r.sentTo}`); }
    catch (err) { toast.error(err.message); }
  };

  return (
    <div>
      <h1 className="text-2xl text-white mb-2">Emails</h1>
      <p className="text-slate-400 text-sm mb-5">Branded transactional templates, plus a broadcast to message all your customers.</p>

      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab('templates')}
          className={`text-sm px-3.5 py-2 rounded-lg inline-flex items-center gap-2 ${tab === 'templates' ? 'bg-primary/15 text-white' : 'text-slate-400 hover:bg-white/5'}`}>
          <Mail size={15} /> Templates
        </button>
        <button onClick={() => setTab('broadcast')}
          className={`text-sm px-3.5 py-2 rounded-lg inline-flex items-center gap-2 ${tab === 'broadcast' ? 'bg-primary/15 text-white' : 'text-slate-400 hover:bg-white/5'}`}>
          <Megaphone size={15} /> Broadcast
        </button>
      </div>

      {tab === 'broadcast' && <Broadcast toast={toast} />}

      {tab === 'templates' && (
      <div className="grid lg:grid-cols-[220px_1fr] gap-6">
        <div className="card p-2 h-fit">
          {templates.map((t) => (
            <button key={t.id} onClick={() => { setSelected(t); setPreview(''); }}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2 ${selected?.id === t.id
                ? 'bg-primary/15 text-white' : 'text-slate-400 hover:bg-white/5'}`}>
              <Mail size={15} /> {t.name}
            </button>
          ))}
        </div>

        {selected && (
          <div className="space-y-4">
            <div className="card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-slate-500">{selected.id}</span>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={!!selected.enabled}
                    onChange={(e) => setSelected({ ...selected, enabled: e.target.checked ? 1 : 0 })} /> Enabled
                </label>
              </div>
              <div><label className="label">Subject</label>
                <input className="input" value={selected.subject}
                  onChange={(e) => setSelected({ ...selected, subject: e.target.value })} /></div>
              <div><label className="label">Body (HTML, supports {'{{tokens}}'})</label>
                <textarea rows={10} className="input font-mono text-xs" value={selected.body_html}
                  onChange={(e) => setSelected({ ...selected, body_html: e.target.value })} /></div>
              <div className="flex gap-2">
                <button onClick={save} className="btn-primary text-sm"><Save size={15} /> Save</button>
                <button onClick={doPreview} className="btn-ghost text-sm"><Eye size={15} /> Preview</button>
                <button onClick={sendTest} className="btn-ghost text-sm"><Send size={15} /> Send test</button>
              </div>
            </div>

            {preview && (
              <div className="card p-2">
                <iframe title="preview" srcDoc={preview} className="w-full h-[480px] rounded-xl bg-white" />
              </div>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// ── Customer broadcast (newsletter / announcement) ──────────────────────────
function Broadcast({ toast }) {
  const [info, setInfo] = useState(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const load = () => api.get('/api/admin/emails/broadcast/audience').then(setInfo).catch(() => setInfo({ audience: 0, recent: [] }));
  useEffect(() => { load(); }, []);

  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/admin/emails/broadcast', { subject, message });
      toast.success(`Sent to ${r.sent} customer(s)${r.failed ? ` · ${r.failed} failed` : ''}${r.skipped ? ` · ${r.skipped} queued for next run` : ''}.`);
      setSubject(''); setMessage(''); setConfirm(false); load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const ready = subject.trim().length >= 2 && message.trim().length >= 2;
  return (
    <div className="max-w-2xl space-y-5">
      <div className="card p-5">
        <div className="flex items-center gap-2 text-sm text-slate-300 mb-4">
          <Megaphone size={16} className="text-primary" />
          Reaches <strong className="text-white">{info?.audience ?? '…'}</strong> customer(s) who haven’t opted out of marketing.
        </div>
        <div className="space-y-3">
          <div><label className="label">Subject</label>
            <input className="input" value={subject} maxLength={200}
              onChange={(e) => setSubject(e.target.value)} placeholder="e.g. 🔥 Weekend sale — 20% off all Robux" /></div>
          <div><label className="label">Message</label>
            <textarea rows={7} className="input" value={message} maxLength={20000}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={'Hi {{user.name}},\n\nThis weekend only…\n\nUse code WEEKEND20 at checkout!'} />
            <p className="text-xs text-slate-500 mt-1">Plain text — line breaks are kept. Use <code className="text-slate-300">{'{{user.name}}'}</code> to greet each customer. It’s wrapped in your branded layout automatically.</p></div>
        </div>
        {!confirm ? (
          <button disabled={!ready} onClick={() => setConfirm(true)} className="btn-primary mt-4"><Send size={15} /> Send broadcast…</button>
        ) : (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="text-sm text-amber-100 mb-3">Send “<strong>{subject}</strong>” to <strong>{info?.audience ?? 0}</strong> customer(s)? This can’t be undone.</p>
            <div className="flex gap-2">
              <button disabled={busy} onClick={send} className="btn-primary">{busy ? 'Sending…' : 'Yes, send now'}</button>
              <button disabled={busy} onClick={() => setConfirm(false)} className="btn-ghost">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {info?.recent?.length > 0 && (
        <div className="card p-5">
          <h3 className="text-white text-sm font-semibold mb-3">Recent broadcasts</h3>
          <div className="space-y-2">
            {info.recent.map((b, i) => (
              <div key={i} className="flex items-center justify-between text-sm bg-space-black rounded-lg px-4 py-2.5">
                <span className="text-slate-200 truncate mr-3">{b.subject}</span>
                <span className="text-slate-500 shrink-0">{b.recipients} sent{Number(b.failed) ? ` · ${b.failed} failed` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
