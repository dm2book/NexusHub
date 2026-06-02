import { useEffect, useState } from 'react';
import { Mail, Eye, Send, Save } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageLoader } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

export default function Emails() {
  const toast = useToast();
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
      <h1 className="text-2xl text-white mb-2">Email templates</h1>
      <p className="text-slate-400 text-sm mb-6">Branded transactional emails — edit subject & body, preview, and send tests.</p>

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
    </div>
  );
}
