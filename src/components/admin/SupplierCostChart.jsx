/**
 * What each supplier has been asking for one product, over time.
 *
 * Cost and stock are both in the history and are NOT drawn together: two
 * y-scales on one frame invent a crossing point that is an artefact of the
 * ranges, and readers take it for an event. Two plots, one x-axis.
 *
 * The plot itself lives in TimeSeriesPlot — the ad report needs the same shape,
 * and a second copy is how one of them ends up with the crosshair fix and the
 * other keeps the bug.
 */
import TimeSeriesPlot, { SeriesLegend, SERIES_COLOURS } from './TimeSeriesPlot.jsx';

const money = (cents) => `€${(cents / 100).toFixed(2)}`;

export default function SupplierCostChart({ history }) {
  if (!history) return <p className="text-[13px] text-slate-400">Loading…</p>;
  const raw = history.series || [];
  if (!raw.length) {
    return (
      <p className="text-[13px] text-slate-400">
        No price history for this product yet. A supplier sync writes a point only when
        something changed, so this fills in from the next change onward.
      </p>
    );
  }
  /* The plot speaks `name`; the history speaks `supplierName`. Renamed here
     rather than in the service, because the service's job is to describe
     suppliers and the plot's is to draw series. */
  const series = raw.map((s) => ({ ...s, name: s.supplierName }));
  const colours = series.map((_, i) => SERIES_COLOURS[i % SERIES_COLOURS.length]);

  return (
    <div className="space-y-4">
      <SeriesLegend series={series} colours={colours} />

      <div>
        <h4 className="text-[12.5px] font-semibold text-slate-300 mb-1">Buy price</h4>
        <TimeSeriesPlot series={series} colours={colours} label="Buy price"
          value={(p) => p.costCents} format={money}
          emptyNote="Buy price: not enough history to draw a line yet — it needs two syncs that changed something." />
      </div>
      <div>
        <h4 className="text-[12.5px] font-semibold text-slate-300 mb-1">Stock the supplier reported</h4>
        <TimeSeriesPlot series={series} colours={colours} label="Stock" zeroFloor
          value={(p) => p.stock} format={(v) => String(Math.round(v))}
          emptyNote="Stock: not enough history to draw a line yet." />
      </div>

      {/* Reachable without hovering, and without colour. */}
      <details className="text-[12px]">
        <summary className="cursor-pointer text-slate-400 hover:text-slate-200">Show the numbers</summary>
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
                <td className="text-slate-300">{s.name}</td>
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
