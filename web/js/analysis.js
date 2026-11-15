// Analysis pipeline shared by the browser app and Node scripts.
import * as S from "./stats.js";
import { VARIABLES, buildCells } from "./catalog.js";

/**
 * Analyse one variable over one region.
 * grids: {PARAM: POWER grid json}; opts: {y0, y1, mode: "anomaly"|"annual", alpha}
 */
export function analyse(varId, grids, { y0 = 1981, y1 = 2025, mode = "anomaly", alpha = 0.05 } = {}) {
  const meta = VARIABLES[varId];
  const anyGrid = grids[(meta.needs || [varId])[0]];
  const allTimes = S.parseTimes(anyGrid.times);
  const keep = allTimes.map((t, i) => i).filter((i) => allTimes[i].year >= y0 && allTimes[i].year <= y1);
  const times = keep.map((i) => allTimes[i]);
  const cells = buildCells(varId, grids, allTimes).map((c) => ({ ...c, v: keep.map((i) => c.v[i]) }));
  const regional = S.regionalMean(cells);

  const res = runTrend(times, regional, meta, mode, alpha);
  const clim = S.climatology(times, regional);
  const spanYears = (y1 - y0 + 1);

  // Per-cell trends: "where is it changing?"
  const cellTrends = cells.map((c) => {
    const r = runTrend(times, c.v, meta, mode, alpha, true);
    return { lat: c.lat, lon: c.lon, ...r.summary };
  });

  // Field significance: with one test per cell, some cells pass by luck. Benjamini-Hochberg on the
  // Mann-Kendall p-values keeps only cells that stay significant after allowing for that.
  const fdrKeep = S.fdr(cellTrends.map((c) => c.mkp), alpha);
  cellTrends.forEach((c, i) => { c.fdr = fdrKeep[i]; });

  return {
    varId, meta, times, regional, clim, mode, alpha, y0, y1, spanYears,
    ...res, cellTrends,
    cellStats: {
      n: cellTrends.length,
      up: cellTrends.filter((c) => c.significant && c.perDecade > 0).length,
      down: cellTrends.filter((c) => c.significant && c.perDecade < 0).length,
      fdrUp: cellTrends.filter((c) => c.fdr && c.perDecade > 0).length,
      fdrDown: cellTrends.filter((c) => c.fdr && c.perDecade < 0).length,
    },
  };
}

function runTrend(times, values, meta, mode, alpha, light = false) {
  let x, y, unit;
  if (mode === "annual") {
    const a = S.annualize(times, values, meta.annual);
    x = a.years; y = a.values; unit = meta.annualUnit;
  } else {
    const anom = S.deseasonalize(times, values);
    x = times.map((t) => t.t); y = anom; unit = meta.unit;
  }
  const lin = S.linearTrend(x, y, { alpha });
  const mk = mode === "annual" ? S.mannKendall(x, y, alpha) : S.seasonalKendall(times.map((t) => t.t), values, times.map((t) => t.month), alpha);
  if (!lin || !mk) return { summary: { perDecade: NaN, significant: false, p: NaN }, x, y, unit };
  // Baseline level for "% change": mean of the raw annual series
  const ann = S.annualize(times, values, meta.annual);
  const level = ann.values.length ? S.mean(ann.values) : NaN;
  const levelUnit = meta.annualUnit;
  // For anomaly mode with summed variables, per-month slope * 12 = per-year total change
  const toAnnualScale = mode === "anomaly" && meta.annual === "sum" ? 12 : 1;
  const perDecade = lin.slope * 10;
  const pctPerDecade = !meta.noPct && Number.isFinite(level) && Math.abs(level) > 1e-9 ? (perDecade * toAnnualScale / Math.abs(level)) * 100 : NaN;
  const agree = lin.significant && mk.significant && Math.sign(lin.slope) === Math.sign(mk.senSlope);
  const summary = {
    perDecade, pctPerDecade, p: lin.p, mkp: mk.p,
    significant: lin.significant || mk.significant,
    robust: agree,
  };
  if (light) return { summary };
  // Abrupt shift in the yearly level (Pettitt). A steady trend line can hide a jump.
  const pt = S.pettitt(ann.values);
  const change = pt && ann.years[pt.index + 1] !== undefined
    ? { year: ann.years[pt.index + 1], p: pt.p, before: pt.before, after: pt.after, significant: pt.p < alpha } : null;
  return { summary, x, y, unit, lin, mk, level, levelUnit, toAnnualScale, change };
}

/** Hydro-drought monitor: SPI-3/SPI-12 from rainfall + soil moisture z-score. */
export function droughtMonitor(grids, { y0 = 1981, y1 = 2025 } = {}) {
  if (!grids.PRECTOTCORR) return null;
  const allTimes = S.parseTimes(grids.PRECTOTCORR.times);
  const precip = S.regionalMean(buildCells("PRECTOTCORR", grids, allTimes));
  const spi12 = S.spi(allTimes, precip, 12);
  const spi3 = S.spi(allTimes, precip, 3);
  let soil = null;
  if (grids.GWETROOT) {
    const sm = S.regionalMean(buildCells("GWETROOT", grids, allTimes));
    soil = S.standardizeByMonth(allTimes, S.rollingMean(sm, 3));
  }
  // Hydro Stress Index: weighted blend, rescaled to unit variance-ish range.
  const hsi = spi12.map((v, i) => {
    const parts = [[v, 0.6], [spi3[i], 0.2], [soil ? soil[i] : NaN, 0.2]].filter(([z]) => Number.isFinite(z));
    if (!parts.length || !Number.isFinite(v)) return NaN;
    const w = parts.reduce((s, [, wt]) => s + wt, 0);
    return parts.reduce((s, [z, wt]) => s + z * wt, 0) / w;
  });
  const idx = allTimes.map((t, i) => i).filter((i) => allTimes[i].year >= y0 && allTimes[i].year <= y1);
  const pick = (a) => idx.map((i) => a[i]);
  const times = idx.map((i) => allTimes[i]);
  const H = pick(hsi);
  let last = H.length - 1;
  while (last >= 0 && !Number.isFinite(H[last])) last--;
  // Worst episodes
  const episodes = [];
  let cur = null;
  H.forEach((v, i) => {
    if (Number.isFinite(v) && v <= -1) {
      if (!cur) cur = { start: i, end: i, min: v, minAt: i };
      cur.end = i; if (v < cur.min) { cur.min = v; cur.minAt = i; }
    } else if (cur) { episodes.push(cur); cur = null; }
  });
  if (cur) episodes.push(cur);
  episodes.sort((a, b) => a.min - b.min);
  const lbl = (i) => `${times[i].year}-${String(times[i].month).padStart(2, "0")}`;
  return {
    times, spi12: pick(spi12), spi3: pick(spi3), soil: soil ? pick(soil) : null, hsi: H,
    latest: last >= 0 ? { label: lbl(last), value: H[last], spi12: pick(spi12)[last], cls: S.droughtClass(H[last]) } : null,
    episodes: episodes.slice(0, 5).map((e) => ({ from: lbl(e.start), to: lbl(e.end), peak: e.min, peakAt: lbl(e.minAt), months: e.end - e.start + 1 })),
    hsiTrend: S.linearTrend(times.map((t) => t.t), H),
  };
}

/** Plain-language verdict: what / where / how much / significant? */
export function narrate(r, siteName) {
  const m = r.meta, lin = r.lin, mk = r.mk;
  if (!lin) return "Not enough data to estimate a trend.";
  const dir = lin.slope > 0 ? "increased" : "decreased";
  const fmt = (v, d = m.decimals) => (Math.abs(v) < 10 ** -d && v !== 0 ? v.toExponential(1) : v.toFixed(d));
  const unit = r.mode === "annual" ? m.annualUnit : m.unit;
  const total = lin.slope * (r.y1 - r.y0);
  const pTxt = (p) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);
  const sig = lin.significant && mk.significant ? "strong" : lin.significant || mk.significant ? "mixed" : "none";
  let s = `<b>What:</b> ${m.name} over <b>${siteName}</b> has ${dir} by about <b>${fmt(Math.abs(lin.slope) * 10)} ${unit} per decade</b>`;
  if (Number.isFinite(r.summary.pctPerDecade)) s += ` (${r.summary.pctPerDecade > 0 ? "+" : ""}${r.summary.pctPerDecade.toFixed(1)}% of the average per decade)`;
  s += r.mode === "annual"
    ? `. Along the trend line that is about <b>${fmt(Math.abs(total))} ${unit} ${lin.slope > 0 ? "more" : "less"}</b> in ${r.y1} than in ${r.y0}.<br>`
    : `. Along the trend line, a typical month in ${r.y1} has about ${fmt(Math.abs(total))} ${unit} ${lin.slope > 0 ? "more" : "less"} than in ${r.y0}.<br>`;
  s += `<b>How sure?</b> 95% confidence interval: ${fmt(lin.ci[0] * 10)} to ${fmt(lin.ci[1] * 10)} ${unit}/decade. `;
  s += `t-test ${pTxt(lin.p)}; ${r.mode === "annual" ? "Mann-Kendall" : "Seasonal Kendall"} ${pTxt(mk.p)}. `;
  if (sig === "strong") s += `<span class="tag sig">Significant</span> Both tests agree: a trend this steady would be very unlikely (&lt;5% chance) from random year-to-year variation alone.`;
  else if (sig === "mixed") s += `<span class="tag mixed">Borderline</span> Only one test passes the 5% threshold, so treat this trend with caution.`;
  else {
    s += `<span class="tag ns">Not significant</span> The change is small compared with natural ups and downs. `;
    if ((lin.ci[0] < 0) !== (lin.ci[1] < 0)) s += "The confidence interval includes zero, so the true trend could even be in the other direction. A longer record might make it clear.";
  }
  if (r.change && r.change.significant) {
    s += `<br><b>Step change:</b> a rank-based test (Pettitt) finds an abrupt shift around <b>${r.change.year}</b> (${pTxt(r.change.p)}): the yearly level was about ${fmt(r.change.before)} ${m.annualUnit} before and ${fmt(r.change.after)} after. A straight trend line can hide a jump like this.`;
  }
  const cs = r.cellStats;
  s += `<br><b>Where:</b> ${cs.up} of ${cs.n} grid cells show a significant increase and ${cs.down} a significant decrease.`;
  if (cs.up + cs.down > 0) s += ` Allowing for ${cs.n} cells tested at once (false discovery rate), <b>${cs.fdrUp} rising and ${cs.fdrDown} falling</b> remain significant.`;
  if (cs.up && cs.down) s += " <b>The trend runs in opposite directions in different parts of this region</b> - check the map!";
  return s;
}
