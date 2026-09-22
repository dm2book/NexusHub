/**
 * The weekly copies, and the one thing nobody else can do about them.
 *
 * ── WHY THE DOWNLOAD IS THE POINT ─────────────────────────────────────────
 * A snapshot living in the database it copies protects against MISTAKES — a
 * bulk edit that wiped forty descriptions, a product deleted by the wrong
 * click. It does not protect against losing the database, because it goes with
 * it. The only copy that survives that is the one on the owner's own disk, and
 * no scheduled job can put it there.
 *
 * So this screen leads with when a copy was last taken AWAY, not with how many
 * exist. A list of four snapshots nobody has ever downloaded reads as safety
 * and is not.
 */
import { useCallback, useEffect, useState } from 'react';
import { HardDrive, Download, AlertTriangle, Check } from 'lucide-react';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';

const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

export default function BackupsCard() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    api.get('/api/admin/backups').then(setData).catch(() => setData(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data) return null;
  const { status, backups } = data;

  const takeNow = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/admin/backups', {});
      toast.success(`Snapshot taken — ${kb(r.backup.bytes)}.`);
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  /* Streamed straight to a file. The payload is megabytes and the browser is
     better at saving it than React is at holding it. */
  const download = async (id) => {
    try {
      const res = await api.raw(`/api/admin/backups/${id}/download`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `forgemarket-backup-${id}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      load();
    } catch (e) { toast.error(e.message); }
  };

  const neverTaken = status.hasBackup && status.offsiteDaysAgo == null;
  const tone = !status.hasBackup || status.status === 'warn' || neverTaken ? 'amber' : 'emerald';
  const frame = {
    emerald: 'border-emerald-500/30 bg-emerald-500/10',
    amber: 'border-amber-500/30 bg-amber-500/10',
  }[tone];

  return (
    <div className={`rounded-2xl border ${frame} mb-8`}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 p-5 text-left">
        <span className={`w-11 h-11 rounded-xl grid place-items-center shrink-0 ${
          tone === 'emerald' ? 'bg-emerald-500/20' : 'bg-amber-500/20'}`}>
          {tone === 'emerald'
            ? <Check size={20} className="text-emerald-400" />
            : <AlertTriangle size={20} className="text-amber-400" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-white font-semibold flex items-center gap-2">
            <HardDrive size={15} className="text-slate-400" /> Backups
          </div>
          <div className="text-slate-400 text-sm">{status.detail}</div>
        </div>
        <span className="text-slate-400 text-xs">{open ? 'Close' : 'Open'}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">
          <p className="text-slate-400 text-xs">
            Taken automatically once a week by the maintenance sweep. A snapshot holds the
            catalogue with its cost prices, unused codes, orders, customers and your settings —
            never your API keys, and supplier credentials are blanked. A downloaded file contains
            customer email addresses, so treat it as personal data.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={takeNow} disabled={busy} className="btn-primary text-xs disabled:opacity-40">
              {busy ? 'Taking…' : 'Take one now'}
            </button>
            {neverTaken && (
              <span className="text-amber-300 text-xs">
                Nothing has ever been downloaded — every copy is still inside the same database.
              </span>
            )}
          </div>

          {backups.length === 0 ? (
            <p className="text-slate-400 text-sm">No snapshots yet.</p>
          ) : (
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <table className="w-full text-[12.5px]">
                <thead className="text-slate-400 text-[11px]">
                  <tr className="border-b border-white/5">
                    <th className="text-left px-3 py-1.5 font-normal">Taken</th>
                    <th className="text-left px-3 py-1.5 font-normal">What</th>
                    <th className="text-right px-3 py-1.5 font-normal">Rows</th>
                    <th className="text-right px-3 py-1.5 font-normal">Size</th>
                    <th className="text-left px-3 py-1.5 font-normal">Downloaded</th>
                    <th className="px-3 py-1.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {backups.map((b) => (
                    <tr key={b.id} className="hover:bg-white/5">
                      <td className="px-3 py-1.5 text-slate-300">{date(b.createdAt)}</td>
                      <td className="px-3 py-1.5 text-slate-400">
                        {b.kind === 'discord' ? 'Discord server shape' : 'Shop data'}
                      </td>
                      <td className="px-3 py-1.5 text-right text-slate-400">{b.rows.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right text-slate-400">{kb(b.bytes)}</td>
                      <td className="px-3 py-1.5 text-slate-500">
                        {b.downloadedAt ? date(b.downloadedAt) : <span className="text-amber-300/80">never</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <button onClick={() => download(b.id)}
                          className="text-slate-400 hover:text-white inline-flex items-center gap-1">
                          <Download size={13} /> Save
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* The Discord half only exists once the bot has sent one, which it
              does an hour after it starts. Saying so beats an empty row. */}
          {!backups.some((b) => b.kind === 'discord') && (
            <p className="text-slate-500 text-[11px]">
              No copy of the Discord server's channels and roles yet — the bot sends one shortly
              after it starts, then weekly.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
