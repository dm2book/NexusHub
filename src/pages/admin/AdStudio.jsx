import { useEffect, useMemo, useRef, useState } from 'react';
import { Film, Play, Square, Download, Wand2, Info, Copy, Mic, Video, MessageSquareQuote } from 'lucide-react';
import { api, getAccessToken } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageLoader } from '../../components/ui.jsx';
import { loadAssets, layout, drawFrame, play } from '../../lib/adStudio/engine.js';
import { forVoice } from '../../lib/adStudio/speak.js';

/**
 * Growth → Ad Studio.
 *
 * Choose a product, what the ad is for, the platform, a length, a language and
 * a voice — get a finished video ad: kinetic type, a beat, sound effects on
 * every animation, the voice-over with word-by-word captions, the real price,
 * and an end card. Built in this browser by src/lib/adStudio/engine.js (a
 * serverless function has no browser and no minutes to render in) and recorded
 * to MP4 where the browser can, WebM otherwise.
 *
 * Every word on screen and spoken comes from the product and catalogue and has
 * passed the shop's claim gate on the server.
 *
 * Two ways in: a product ad (choose the product and what the ad is for), or
 * one of the fifty UGC scripts — four beats of 10–15 seconds, with today's
 * prices read from the catalogue, optionally over a clip you filmed yourself.
 *
 * Voices: free ones run IN this browser (Piper, open voices) — the engine and
 * the voice model are fetched from a CDN the first time, nothing is installed;
 * premium ones (ElevenLabs, OpenAI) use your own key from Keys and connections.
 */
const PIPER = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/+esm';

async function browserVoice(text, voiceId, onProgress) {
  const tts = await import(/* @vite-ignore */ PIPER);
  return tts.predict({ text, voiceId }, (p) => onProgress?.(p));
}
async function premiumVoice(text, provider, lang) {
  const r = await fetch('/api/admin/analytics/ad-studio/voice', {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${getAccessToken()}` },
    body: JSON.stringify({ text, provider, lang }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.message || `Voice ${r.status}`);
  return r.blob();
}

const sel = 'rounded-xl bg-white/5 border border-white/10 text-slate-200 text-sm h-10 px-3 w-full';

export default function AdStudio() {
  const toast = useToast();
  const [opts, setOpts] = useState(null);
  const [mode, setMode] = useState('ugc');                          // ugc | product
  const [ugc, setUgc] = useState(null);
  const [u, setU] = useState({ scriptId: 'ugc-01', theme: '', footage: null, footageName: '', footageAudio: false });
  const [f, setF] = useState({ productId: '', angles: [], platform: 'tiktok', length: 30, lang: 'nl', voice: 'nl_BE-rdh-medium', captions: true, music: true });
  const [board, setBoard] = useState(null);
  const [state, setState] = useState({ phase: 'idle', note: '' });   // idle | building | ready | playing | recording
  const [t, setT] = useState(0);
  const canvas = useRef(null);
  const media = useRef({ assets: null, voices: {}, timeline: null, player: null });

  useEffect(() => {
    api.get('/api/admin/analytics/ad-studio/options').then((o) => {
      setOpts(o);
      const first = o.products.find((p) => /robux/i.test(p.name)) || o.products[0];
      if (first) setF((x) => ({ ...x, productId: first.id, angles: first.angles.slice(0, 3) }));
    }).catch(() => setOpts(false));
    api.get('/api/admin/analytics/ad-studio/ugc').then(setUgc).catch(() => setUgc(false));
  }, []);
  /* A picked clip lives only in this browser (an object URL); nothing is uploaded. */
  useEffect(() => () => { if (u.footage) URL.revokeObjectURL(u.footage); }, [u.footage]);
  const script = ugc?.scripts?.find((x) => x.id === u.scriptId);
  const scripts = (ugc?.scripts || []).filter((x) => !u.theme || x.theme === u.theme);

  const product = opts?.products?.find((p) => p.id === f.productId);
  const voices = useMemo(() => {
    if (!opts) return [];
    const list = [{ id: 'none', label: 'Geen stem' }];
    for (const v of opts.voices.browser.filter((x) => x.lang === (mode === 'ugc' ? 'nl' : f.lang))) list.push({ id: v.id, label: v.label });
    if (opts.voices.premium.elevenlabs) list.push({ id: 'elevenlabs', label: 'ElevenLabs (premium, je eigen sleutel)' });
    if (opts.voices.premium.openai) list.push({ id: 'openai', label: 'OpenAI (premium, je eigen sleutel)' });
    return list;
  }, [opts, f.lang, mode]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const toggleAngle = (a) => setF((x) => ({ ...x, angles: x.angles.includes(a) ? x.angles.filter((y) => y !== a) : [...x.angles, a] }));

  /* Product changed: keep only angles it supports. Language changed: a voice in it. */
  useEffect(() => { if (product) setF((x) => ({ ...x, angles: x.angles.filter((a) => product.angles.includes(a)) })); }, [f.productId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (voices.length && !voices.some((v) => v.id === f.voice)) setF((x) => ({ ...x, voice: voices[1]?.id || 'none' })); }, [voices]); // eslint-disable-line react-hooks/exhaustive-deps

  const draw = (time) => {
    const m = media.current;
    if (!m.timeline || !canvas.current) return;
    /* Scrubbing over your own clip: seek it, then draw once the frame is there. */
    const clip = m.assets?.footage;
    if (clip && clip.paused && clip.duration) {
      const want = time % clip.duration;
      if (Math.abs(clip.currentTime - want) > 0.04) {
        clip.onseeked = () => { clip.onseeked = null; drawFrame(canvas.current.getContext('2d'), m.timeline, m.assets, Math.min(time, m.timeline.total - 1e-3), { captions: f.captions }); };
        clip.currentTime = want;
      }
    }
    drawFrame(canvas.current.getContext('2d'), m.timeline, m.assets, Math.min(time, m.timeline.total - 1e-3), { captions: f.captions });
  };

  const build = async () => {
    media.current.player?.stop();
    setState({ phase: 'building', note: 'Storyboard…' });
    try {
      const b = mode === 'ugc'
        ? await api.post('/api/admin/analytics/ad-studio/ugc/storyboard', { scriptId: u.scriptId, platform: f.platform })
        : await api.post('/api/admin/analytics/ad-studio/storyboard',
          { productId: f.productId, angles: f.angles, platform: f.platform, length: Number(f.length), lang: f.lang });
      setBoard(b);
      canvas.current.width = b.platform.w; canvas.current.height = b.platform.h;
      setState({ phase: 'building', note: 'Fonts en beelden…' });
      const assets = await loadAssets(b);
      if (mode === 'ugc' && u.footage) {
        setState({ phase: 'building', note: 'Je eigen video…' });
        const v = document.createElement('video');
        v.src = u.footage; v.muted = true; v.playsInline = true; v.preload = 'auto';
        await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = () => no(new Error('Kon je video niet openen')); });
        assets.footage = v;
      }
      const decode = new (window.AudioContext || window.webkitAudioContext)();
      const vbuf = {}, durs = {};
      if (f.voice !== 'none') {
        for (const [i, s] of b.scenes.entries()) {
          if (!s.voice) continue;
          setState({ phase: 'building', note: `Stem ${i + 1}/${b.scenes.length}${['elevenlabs', 'openai'].includes(f.voice) ? '' : ' (de eerste keer laadt je browser het stemmodel, ±60 MB)'}…` });
          const blob = ['elevenlabs', 'openai'].includes(f.voice)
            ? await premiumVoice(s.voice, f.voice, b.lang)
            /* English brand words respelt so a Dutch voice says them in English
               ("ForgeMarket", "V-Bucks", "Link in bio"); the caption keeps the spelling. */
            : await browserVoice(forVoice(s.voice, b.lang, 'respell'), f.voice);
          const buf = await decode.decodeAudioData(await blob.arrayBuffer());
          vbuf[s.id] = buf; durs[s.id] = buf.duration;
        }
      }
      decode.close().catch(() => {});
      media.current = { assets, voices: vbuf, timeline: layout(b, durs), player: null };
      setT(0); draw(0.6);
      setState({ phase: 'ready', note: '' });
    } catch (e) {
      setState({ phase: 'idle', note: '' });
      toast.error(e.message || 'Kon de ad niet maken');
    }
  };

  const run = async (record) => {
    const m = media.current;
    if (!m.timeline) return;
    setState({ phase: record ? 'recording' : 'playing', note: record ? 'Opnemen in echte tijd — laat dit tabblad open…' : '' });
    const p = play(canvas.current, m.timeline, m.assets, m.voices, { record, music: f.music, captions: f.captions, footageAudio: mode === 'ugc' && u.footageAudio, onTime: setT });
    m.player = p;
    const blob = await p.done;
    m.player = null;
    setState({ phase: 'ready', note: '' });
    if (record && blob) {
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const name = board.kind === 'ugc'
        ? `forgemarket-${board.script.id}-${board.platform.id}-${Math.round(m.timeline.total)}s.${ext}`
        : `forgemarket-${(board.product.name || 'ad').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${board.platform.id}-${Math.round(m.timeline.total)}s.${ext}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      toast.success(ext === 'mp4' ? 'MP4 gedownload.' : 'WebM gedownload — deze browser neemt geen MP4 op. TikTok accepteert WebM; voor Instagram: open de studio in Chrome.');
    }
  };

  if (opts === null) return <PageLoader />;
  if (opts === false) return <p className="text-slate-400">Kon Ad Studio niet laden.</p>;
  const total = media.current.timeline?.total || 0;
  const busy = ['building', 'recording'].includes(state.phase);
  const portrait = board ? board.platform.h > board.platform.w : true;

  return (
    <div>
      <h1 className="text-2xl text-white flex items-center gap-2 mb-2"><Film size={22} className="text-violet-300" /> Ad Studio</h1>
      <p className="text-slate-400 text-sm mb-5 max-w-3xl">
        Kies een product, waar de ad voor is, het platform en de lengte. Je krijgt een complete video: bewegende tekst, beat,
        geluidseffecten, stem met ondertiteling en de echte prijs. Alleen wat de shop kan bewijzen komt erin.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2" role="tablist">
            {[['ugc', 'UGC-scripts', MessageSquareQuote], ['product', 'Product-ad', Film]].map(([k, l, Icon]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} data-testid={`mode-${k}`}
                className={`rounded-xl border px-3 py-2 text-sm inline-flex items-center justify-center gap-2 transition
                  ${mode === k ? 'bg-violet-500/15 border-violet-500/40 text-violet-200' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}>
                <Icon size={14} /> {l}{k === 'ugc' && ugc ? ` (${ugc.scripts.length})` : ''}
              </button>
            ))}
          </div>

          {mode === 'ugc' && (ugc === false ? <p className="text-sm text-amber-300/90">Kon de UGC-scripts niet laden.</p> : ugc && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-slate-400">Thema
                  <select value={u.theme} onChange={(e) => setU((x) => ({ ...x, theme: e.target.value }))} className={`${sel} mt-1`} name="theme">
                    <option value="">Alle thema's</option>
                    {Object.entries(ugc.themes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="text-xs text-slate-400">Script
                  <select value={u.scriptId} onChange={(e) => setU((x) => ({ ...x, scriptId: e.target.value }))} className={`${sel} mt-1`} name="script">
                    {scripts.map((x) => <option key={x.id} value={x.id} disabled={!x.available}>{x.id.slice(4)}. {x.title}{x.available ? '' : ' — niet beschikbaar'}</option>)}
                  </select>
                </label>
              </div>
              {script && (script.available ? (
                <ol className="rounded-xl border border-white/10 divide-y divide-white/5 text-[13px]" data-testid="ugc-lines">
                  {[['hook', 'Hook', '0–2s'], ['problem', 'Probleem', '2–5s'], ['solution', 'Oplossing', '5–10s'], ['cta', 'CTA', '10–15s']].map(([k, l, w]) => (
                    <li key={k} className="px-3 py-2 flex gap-3">
                      <span className="text-slate-500 w-24 shrink-0">{l} <span className="tabular-nums">{w}</span></span>
                      <span className="text-slate-200">{script.lines[k]}</span>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm text-amber-300/90 flex gap-2"><Info size={13} className="shrink-0 mt-0.5" />{script.reason}</p>)}
              <label className="block text-xs text-slate-400"><span className="inline-flex items-center gap-1"><Video size={12} /> Eigen video eronder (optioneel)</span>
                <input type="file" accept="video/*" name="footage" className="block mt-1 text-sm text-slate-300"
                  onChange={(e) => { const file = e.target.files?.[0]; setU((x) => ({ ...x, footage: file ? URL.createObjectURL(file) : null, footageName: file?.name || '' })); }} />
              </label>
              {u.footage && (
                <div className="flex items-center gap-4 text-sm text-slate-300">
                  <span className="truncate text-slate-400">{u.footageName}</span>
                  <label className="inline-flex items-center gap-2 shrink-0"><input type="checkbox" checked={u.footageAudio} onChange={(e) => setU((x) => ({ ...x, footageAudio: e.target.checked }))} /> Geluid van mijn video</label>
                  <button type="button" className="btn-ghost text-xs shrink-0" onClick={() => setU((x) => ({ ...x, footage: null, footageName: '', footageAudio: false }))}>Weg</button>
                </div>
              )}
            </div>
          ))}

          {mode === 'product' && (<>
          <label className="block text-xs text-slate-400">Product
            <select value={f.productId} onChange={set('productId')} className={`${sel} mt-1`} name="product">
              {opts.products.map((p) => <option key={p.id} value={p.id}>{p.name} — €{(p.price / 100).toFixed(2).replace('.', ',')}</option>)}
            </select>
          </label>

          <div>
            <div className="text-xs text-slate-400 mb-2">Waar is de ad voor? <span className="text-slate-500">(in deze volgorde)</span></div>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(opts.angles).map(([k, v]) => {
                const ok = product?.angles.includes(k);
                const n = f.angles.indexOf(k);
                return (
                  <button key={k} type="button" disabled={!ok} onClick={() => toggleAngle(k)} data-testid={`angle-${k}`}
                    title={ok ? '' : 'Dit product kan deze invalshoek niet eerlijk dragen'}
                    className={`text-left rounded-xl border px-3 py-2 text-[13px] transition disabled:opacity-40
                      ${n >= 0 ? 'bg-violet-500/15 border-violet-500/40 text-violet-200' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}>
                    {n >= 0 && <b className="mr-1">{n + 1}.</b>}{v[f.lang] || v.nl}
                  </button>
                );
              })}
            </div>
          </div>

          </>)}

          <div className={`grid gap-3 ${mode === 'product' ? 'sm:grid-cols-3' : ''}`}>
            <label className="text-xs text-slate-400">Platform
              <select value={f.platform} onChange={set('platform')} className={`${sel} mt-1`} name="platform">
                {Object.entries(opts.platforms).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
            {mode === 'product' && <>
            <label className="text-xs text-slate-400">Lengte
              <select value={f.length} onChange={set('length')} className={`${sel} mt-1`} name="length">
                {opts.lengths.map((l) => <option key={l} value={l}>tot {l} sec</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400">Taal
              <select value={f.lang} onChange={set('lang')} className={`${sel} mt-1`} name="lang">
                <option value="nl">Nederlands</option><option value="en">English</option>
              </select>
            </label>
            </>}
          </div>

          <label className="block text-xs text-slate-400"><span className="inline-flex items-center gap-1"><Mic size={12} /> Stem</span>
            <select value={f.voice} onChange={set('voice')} className={`${sel} mt-1`} name="voice">
              {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </label>
          <div className="flex gap-5 text-sm text-slate-300">
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.captions} onChange={set('captions')} /> Ondertiteling</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.music} onChange={set('music')} /> Beat</label>
          </div>

          <button onClick={build} disabled={busy || (mode === 'product' ? !f.productId : !script?.available)} className="btn-primary w-full disabled:opacity-40" data-testid="build">
            <Wand2 size={16} /> {state.phase === 'building' ? state.note : 'Maak de ad'}
          </button>

          {board && (
            <div className="text-[12.5px] space-y-2">
              {board.kind === 'ugc' && <p className="text-slate-400">Script {board.script.id.slice(4)} · {board.product.name} · {Math.round(media.current.timeline?.total || board.estimatedSeconds)} sec</p>}
              {board.angles.skipped.map((s) => (
                <p key={s.angle} className="text-amber-300/90 flex gap-2"><Info size={13} className="shrink-0 mt-0.5" />{opts.angles[s.angle]?.[f.lang]}: {s.reason}</p>
              ))}
              {board.refused.map((r) => (
                <p key={r.scene} className="text-amber-300/90">Scène {r.scene} weggelaten: {r.lines.map((l) => `"${l.text}" (${l.why.join('; ')})`).join(', ')}</p>
              ))}
              <div className="rounded-xl border border-white/10 divide-y divide-white/5">
                {(media.current.timeline?.scenes || board.scenes).map((s) => (
                  <button key={s.id} type="button" onClick={() => { const st = s.start ?? 0; setT(st + 0.8); draw(st + 0.8); }}
                    className="w-full text-left px-3 py-2 hover:bg-white/5" data-testid="scene">
                    <span className="text-slate-500 tabular-nums mr-2">{s.start != null ? `${s.start.toFixed(1)}s` : ''}</span>
                    <span className="text-slate-200">{s.voice}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <span className="truncate">{board.link}</span>
                <button onClick={() => { navigator.clipboard?.writeText(board.link); toast.success('Link gekopieerd.'); }} className="btn-ghost text-xs shrink-0"><Copy size={12} /> Link</button>
              </div>
            </div>
          )}
        </div>

        <div className="card p-5 flex flex-col items-center">
          <canvas ref={canvas} width={1080} height={1920} data-testid="stage"
            className="rounded-2xl border border-white/10 bg-black"
            style={{ width: portrait ? 300 : 420, maxWidth: '100%', aspectRatio: board ? `${board.platform.w}/${board.platform.h}` : '9/16' }} />
          {total > 0 && (
            <>
              <input type="range" min={0} max={total} step={0.05} value={t} name="seek" disabled={busy || state.phase === 'playing'}
                onChange={(e) => { const v = Number(e.target.value); setT(v); draw(v); }} className="w-full mt-4" />
              <div className="text-xs text-slate-500 tabular-nums">{t.toFixed(1)} / {total.toFixed(1)} s</div>
              <div className="flex gap-2 mt-3">
                {state.phase === 'playing' || state.phase === 'recording'
                  ? <button onClick={() => media.current.player?.stop()} className="btn-ghost text-sm"><Square size={14} /> Stop</button>
                  : <button onClick={() => run(false)} className="btn-ghost text-sm" data-testid="play"><Play size={14} /> Afspelen</button>}
                <button onClick={() => run(true)} disabled={busy || state.phase === 'playing'} className="btn-primary text-sm disabled:opacity-40" data-testid="export">
                  <Download size={14} /> {state.phase === 'recording' ? `Opnemen… ${Math.round((t / total) * 100)}%` : 'Download video'}
                </button>
              </div>
              {state.note && state.phase === 'recording' && <p className="text-xs text-slate-500 mt-2">{state.note}</p>}
            </>
          )}
          {!total && <p className="text-xs text-slate-500 mt-3">Klik op "Maak de ad" voor een preview.</p>}
        </div>
      </div>

      <p className="text-xs text-slate-500 mt-4 flex gap-2 max-w-3xl"><Info size={13} className="shrink-0 mt-0.5" />
        De gratis stemmen draaien in je eigen browser; de eerste keer downloadt die het stemmodel (±60 MB) en onthoudt het daarna.
        Een natuurlijkere stem: zet een ElevenLabs- of OpenAI-sleutel onder Analytics → Keys and connections → Ad Studio.
        Opnemen gebeurt in echte tijd: een ad van 40 seconden duurt 40 seconden — laat het tabblad zichtbaar.</p>
    </div>
  );
}
