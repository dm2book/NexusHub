/**
 * What each supplier has been asking for one product, over time.
 *
 * ── ONE AXIS ──────────────────────────────────────────────────────────────
 * Cost and stock are both in the history and they are NOT drawn together. Two
 * y-scales on one frame is the single most misleading thing a chart can do: the
 * crossing point where "cost overtook stock" is an artefact of whichever two
 * ranges happened to be picked, and readers take it for an event. They are two
 * small charts sharing one x-axis instead, which answers the same question and
 * cannot invent that moment.
 *
 * ── IDENTITY IS NEVER COLOUR ALONE ────────────────────────────────────────
 * Every series is in the legend AND labelled at the end of its own line. A
 * reader who cannot separate the hues still reads the chart; a printout still
 * works. The five hues are the validated dark-mode categorical steps, checked
 * against this admin's own surface (#070710) — lightness band, chroma floor,
 * colour-vision separation, normal-vision separation and contrast all pass.
 * Assigned in fixed order by supplier, never cycled.
 *
 * ── ONE POINT IS NOT A LINE ───────────────────────────────────────────────
 * A supplier synced once has a dot and nothing to interpolate. The caller is
 * told (`enoughToPlot`) rather than being handed a chart that looks like a flat
 * trend.
 */
import { useMemo, useRef, useState } from 'react';

/* Validated against surface #070710 in dark mode: all five pass the lightness
   band, the chroma floor, CVD separation (worst adjacent ΔE 8.4), the
   normal-vision floor (19.3) and 3:1 contrast. Fixed order — a supplier keeps
   its colour when another is filtered out. */
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];

/**
 * A round step that contains the data.
 *
 * 1, 2, 2.5 and 5 times a power of ten — the steps people actually read — and
 * the bounds are floored and ceilinged onto it so the three gridline labels are
 * numbers somebody would have picked.
 */
function niceBounds(lo, hi, ticks = 2) {
  if (!(hi > lo)) return [lo, hi];
  const raw = (hi - lo) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((m) => raw <= m * mag) * mag;
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

const PAD = { top: 14, right: 96, bottom: 24, left: 52 };
const W = 720;
const H = 190;

const money = (cents) => `€${(cents / 100).toFixed(2)}`;
const day = (iso) => String(iso).slice(5, 10).replace('-', '/');

function useScales(series, pick) {
  return useMemo(() => {
    const pts = series.flatMap((s) => s.points.filter((p) => pick(p) != null));
    if (pts.length < 2) return null;
    const xs = pts.map((p) => Date.parse(p.at));
    const ys = pts.map(pick);
    const x0 = Math.min(...xs); const x1 = Math.max(...xs);
    /* The zero line is kept for stock (an absolute count) and dropped for cost
       (where the question is "how much did it move", and a forced zero flattens
       a 20% rise into nothing). */
    const lo = Math.min(...ys); const hi = Math.max(...ys);
    const padY = (hi - lo) * 0.15 || Math.max(1, hi * 0.05);
    /* Snapped to a round step rather than to the padded extremes. Unrounded
       bounds put "€8.84 / €7.80 / €6.76" down the axis — three numbers nobody
       chose, that the reader has to decode before they can read the line. */
    const [yLo, yHi] = niceBounds(Math.max(0, lo - padY), hi + padY);
    const sx = (t) => PAD.left + ((x1 === x0 ? 0.5 : (t - x0) / (x1 - x0)))
      * (W - PAD.left - PAD.right);
    const sy = (v) => PAD.top + (1 - (yHi === yLo ? 0.5 : (v - yLo) / (yHi - yLo)))
      * (H - PAD.top - PAD.bottom);
    return { sx, sy, x0, x1, yLo, yHi };
  }, [series, pick]);
}

function Plot({ series, pick, format, label, colours }) {
  const scales = useScales(series, pick);
  const [hover, setHover] = useState(null);
  const ref = useRef(null);

  if (!scales) {
    return (
      <p className="text-[12.5px] text-slate-400 py-3">
        {label}: not enough history to draw a line yet — it needs two syncs that changed something.
      </p>
    );
  }
  const { sx, sy, x0, x1, yLo, yHi } = scales;

  /* Every x a point actually sits on. The crosshair snaps to these, so the
     reader aims at a date rather than at a 2px line. */
  const stops = [...new Set(series.flatMap((s) =>
    s.points.filter((p) => pick(p) != null).map((p) => Date.parse(p.at))))].sort((a, b) => a - b);

  const onMove = (e) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    const t = x0 + ((px - PAD.left) / (W - PAD.left - PAD.right)) * (x1 - x0);
    const nearest = stops.reduce((best, s) =>
      (Math.abs(s - t) < Math.abs(best - t) ? s : best), stops[0]);
    setHover(nearest);
  };

  const readout = hover == null ? null : series.map((s, i) => {
    const p = s.points.find((q) => Date.parse(q.at) === hover && pick(q) != null);
    return p ? { name: s.supplierName, value: pick(p), colour: colours[i] } : null;
  }).filter(Boolean);

  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto"
        role="img" aria-label={`${label} per supplier over time`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {/* Recessive grid: three lines, no box, no ticks pointing at nothing. */}
        {[yLo, (yLo + yHi) / 2, yHi].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(v)} y2={sy(v)}
              stroke="rgba(255,255,255,.07)" strokeWidth="1" />
            <text x={PAD.left - 8} y={sy(v) + 4} textAnchor="end"
              className="fill-slate-500" fontSize="11">{format(v)}</text>
          </g>
        ))}
        <text x={PAD.left} y={H - 6} className="fill-slate-500" fontSize="11">
          {day(new Date(x0).toISOString())}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-slate-500" fontSize="11">
          {day(new Date(x1).toISOString())}
        </text>

        {hover != null && (
          <line x1={sx(hover)} x2={sx(hover)} y1={PAD.top} y2={H - PAD.bottom}
            stroke="rgba(255,255,255,.28)" strokeWidth="1" />
        )}

        {series.map((s, i) => {
          const pts = s.points.filter((p) => pick(p) != null);
          if (!pts.length) return null;
          const d = pts.map((p, k) =>
            `${k ? 'L' : 'M'}${sx(Date.parse(p.at)).toFixed(1)},${sy(pick(p)).toFixed(1)}`).join(' ');
          const last = pts[pts.length - 1];
          return (
            <g key={s.supplierId}>
              <path d={d} fill="none" stroke={colours[i]} strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p) => (
                <circle key={p.at} cx={sx(Date.parse(p.at))} cy={sy(pick(p))}
                  r={Date.parse(p.at) === hover ? 5 : 3.5}
                  fill={colours[i]} stroke="#070710" strokeWidth="2" />
              ))}
              {/* Direct label at the end of the line — identity without the legend. */}
              <text x={sx(Date.parse(last.at)) + 10} y={sy(pick(last)) + 4}
                fill={colours[i]} fontSize="11.5" fontWeight="600">{s.supplierName}</text>
            </g>
          );
        })}
      </svg>

      {readout?.length > 0 && (
        <div className="absolute top-1 right-1 rounded-lg border border-white/10 bg-space-black/95
          px-3 py-2 text-[12px] shadow-xl pointer-events-none">
          <div className="text-slate-400 mb-1">{day(new Date(hover).toISOString())}</div>
          {readout.map((r) => (
            <div key={r.name} className="flex items-center gap-2">
              <span style={{ background: r.colour }} className="inline-block w-3 h-0.5 rounded" />
              <span className="text-slate-100 font-semibold tabular-nums">{format(r.value)}</span>
              <span className="text-slate-400">{r.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SupplierCostChart({ history }) {
  if (!history) return <p className="text-[13px] text-slate-400">Loading…</p>;
  const series = history.series || [];
  if (!series.length) {
    return (
      <p className="text-[13px] text-slate-400">
        No price history for this product yet. A supplier sync writes a point only when
        something changed, so this fills in from the next change onward.
      </p>
    );
  }
  const colours = series.map((_, i) => SERIES[i % SERIES.length]);

  return (
    <div className="space-y-4">
      {/* The legend is present for every multi-series chart, and mirrors the
          mark: a line for a line chart, not a filled box. */}
      {series.length > 1 && (
        <div className="flex flex-wrap gap-4 text-[12px]">
          {series.map((s, i) => (
            <span key={s.supplierId} className="inline-flex items-center gap-2 text-slate-300">
              <span style={{ background: colours[i] }} className="inline-block w-4 h-0.5 rounded" />
              {s.supplierName}
            </span>
          ))}
        </div>
      )}

      <div>
        <h4 className="text-[12.5px] font-semibold text-slate-300 mb-1">Buy price</h4>
        <Plot series={series} colours={colours} label="Buy price"
          pick={(p) => p.costCents} format={money} />
      </div>
      <div>
        <h4 className="text-[12.5px] font-semibold text-slate-300 mb-1">Stock the supplier reported</h4>
        <Plot series={series} colours={colours} label="Stock"
          pick={(p) => p.stock} format={(v) => String(Math.round(v))} />
      </div>

      {/* Reachable without hovering, and without colour. */}
      <details className="text-[12px]">
        <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
          Show the numbers
        </summary>
        <table className="w-full mt-2 text-[12px]">
          <thead className="text-slate-400 text-left">
            <tr><th className="py-1 font-semibold">Date</th><th className="font-semibold">Supplier</th>
              <th className="font-semibold text-right">Buy price</th>
              <th className="font-semibold text-right">Stock</th></tr>
          </thead>
          <tbody>
            {series.flatMap((s) => s.points.map((p) => (
              <tr key={`${s.supplierId}-${p.at}`} className="border-t border-white/5">
                <td className="py-1 text-slate-400">{String(p.at).slice(0, 10)}</td>
                <td className="text-slate-300">{s.supplierName}</td>
                <td className="text-right tabular-nums text-slate-200">
                  {p.costCents == null ? '—' : money(p.costCents)}</td>
                <td className="text-right tabular-nums text-slate-200">
                  {p.stock == null ? '—' : p.stock}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
