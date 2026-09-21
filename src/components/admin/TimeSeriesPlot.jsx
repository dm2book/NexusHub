/**
 * One measure, over time, for several series — the shape both the supplier
 * price history and the ad report need.
 *
 * Extracted rather than copied. The second chart in this admin would otherwise
 * have been a second copy of the same hundred lines, and the two would have
 * drifted the way every duplicated table in this codebase has: one gets the
 * crosshair fix, the other keeps the bug.
 *
 * ── ONE MEASURE PER PLOT ──────────────────────────────────────────────────
 * Deliberately not capable of two y-scales. Two measures of different size on
 * one frame invent a crossing point — "spend overtook revenue" — that is an
 * artefact of whichever ranges happened to be picked, and readers take it for
 * an event. Two measures means two plots sharing an x-axis.
 *
 * ── IDENTITY IS NEVER COLOUR ALONE ────────────────────────────────────────
 * Every series is labelled at the end of its own line, and the caller renders a
 * legend beside it. The hues are the validated dark-mode categorical steps,
 * checked against this admin's own surface (#070710): lightness band, chroma
 * floor, colour-vision separation, normal-vision separation and contrast all
 * pass. Fixed order, so a series keeps its colour when another is filtered out.
 */
import { useMemo, useRef, useState } from 'react';

export const SERIES_COLOURS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];

const PAD = { top: 14, right: 104, bottom: 24, left: 56 };
const W = 720;
const H = 190;

/**
 * A round step that contains the data.
 *
 * 1, 2, 2.5 and 5 times a power of ten — the steps people actually read. Raw
 * padded extremes put "€8.84 / €7.80 / €6.76" down the axis: three numbers
 * nobody chose, that have to be decoded before the line can be read.
 */
export function niceBounds(lo, hi, ticks = 2) {
  if (!(hi > lo)) return [lo, hi];
  const raw = (hi - lo) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((m) => raw <= m * mag) * mag;
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

const day = (iso) => String(iso).slice(5, 10).replace('-', '/');

export default function TimeSeriesPlot({
  series, value, format, label, colours, zeroFloor = false, emptyNote,
}) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);

  const scales = useMemo(() => {
    const pts = series.flatMap((s) => s.points.filter((p) => value(p) != null));
    if (pts.length < 2) return null;
    const xs = pts.map((p) => Date.parse(p.at));
    const ys = pts.map(value);
    const x0 = Math.min(...xs); const x1 = Math.max(...xs);
    const lo = Math.min(...ys); const hi = Math.max(...ys);
    const padY = (hi - lo) * 0.15 || Math.max(1, Math.abs(hi) * 0.05);
    const [yLo, yHi] = niceBounds(zeroFloor ? 0 : Math.max(0, lo - padY), hi + padY);
    const sx = (t) => PAD.left + (x1 === x0 ? 0.5 : (t - x0) / (x1 - x0))
      * (W - PAD.left - PAD.right);
    const sy = (v) => PAD.top + (1 - (yHi === yLo ? 0.5 : (v - yLo) / (yHi - yLo)))
      * (H - PAD.top - PAD.bottom);
    return { sx, sy, x0, x1, yLo, yHi };
  }, [series, value, zeroFloor]);

  if (!scales) {
    return (
      <p className="text-[12.5px] text-slate-400 py-3">
        {emptyNote || `${label}: not enough points to draw a line yet.`}
      </p>
    );
  }
  const { sx, sy, x0, x1, yLo, yHi } = scales;

  /* Every x a point actually sits on, so the crosshair snaps to a date rather
     than asking the reader to aim at a 2px line. */
  const stops = [...new Set(series.flatMap((s) =>
    s.points.filter((p) => value(p) != null).map((p) => Date.parse(p.at))))].sort((a, b) => a - b);

  const onMove = (e) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    const t = x0 + ((px - PAD.left) / (W - PAD.left - PAD.right)) * (x1 - x0);
    setHover(stops.reduce((best, s) => (Math.abs(s - t) < Math.abs(best - t) ? s : best), stops[0]));
  };

  const readout = hover == null ? null : series.map((s, i) => {
    const p = s.points.find((q) => Date.parse(q.at) === hover && value(q) != null);
    return p ? { name: s.name, v: value(p), colour: colours[i] } : null;
  }).filter(Boolean);

  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto"
        role="img" aria-label={`${label} per series over time`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
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
          const pts = s.points.filter((p) => value(p) != null);
          if (!pts.length) return null;
          const d = pts.map((p, k) =>
            `${k ? 'L' : 'M'}${sx(Date.parse(p.at)).toFixed(1)},${sy(value(p)).toFixed(1)}`).join(' ');
          const last = pts[pts.length - 1];
          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={colours[i]} strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p) => (
                <circle key={p.at} cx={sx(Date.parse(p.at))} cy={sy(value(p))}
                  r={Date.parse(p.at) === hover ? 5 : 3.5}
                  fill={colours[i]} stroke="#070710" strokeWidth="2" />
              ))}
              <text x={sx(Date.parse(last.at)) + 10} y={sy(value(last)) + 4}
                fill={colours[i]} fontSize="11.5" fontWeight="600">{s.name}</text>
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
              <span className="text-slate-100 font-semibold tabular-nums">{format(r.v)}</span>
              <span className="text-slate-400">{r.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The legend the caller puts above a multi-series plot. Line, not box. */
export function SeriesLegend({ series, colours }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-4 text-[12px]">
      {series.map((s, i) => (
        <span key={s.name} className="inline-flex items-center gap-2 text-slate-300">
          <span style={{ background: colours[i] }} className="inline-block w-4 h-0.5 rounded" />
          {s.name}
        </span>
      ))}
    </div>
  );
}
