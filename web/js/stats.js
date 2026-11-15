// HydroWatch Global - statistics engine (pure functions, no DOM).
// Linear trend + t-test + confidence interval, Mann-Kendall + Sen's slope,
// Seasonal Kendall, deseasonalising, SPI (gamma-based drought index).

// ---------- special functions ----------
function gammaln(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

function betacf(a, b, x) {
  const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a,b). */
export function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}

/** Regularized lower incomplete gamma P(a,x). */
export function gammainc(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 500; n++) {
      ap += 1; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
}

/** Standard normal CDF (via incomplete gamma: erf(x) = P(1/2, x^2)). */
export function normCdf(z) {
  const e = gammainc(0.5, (z * z) / 2);
  return z >= 0 ? 0.5 * (1 + e) : 0.5 * (1 - e);
}

/** Inverse standard normal CDF (Acklam, refined with one Halley step). */
export function normInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q, r, x;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    q = p - 0.5; r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const e = normCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/** Two-sided p-value for Student t with df degrees of freedom. */
export function tPValue(t, df) {
  return betai(df / 2, 0.5, df / (df + t * t));
}

/** Two-sided critical t value, e.g. tCrit(0.05, df) ~ 1.96 for large df. */
export function tCrit(alpha, df) {
  let lo = 0, hi = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tPValue(mid, df) > alpha) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------- helpers ----------
export const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
export function median(a) {
  const s = [...a].sort((x, y) => x - y), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
export function std(a) {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}
const pairs = (x, y) => x.map((xi, i) => [xi, y[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));

/** Lag-1 autocorrelation of a series. */
export function lag1(a) {
  const m = mean(a);
  let num = 0, den = 0;
  for (let i = 0; i < a.length; i++) {
    den += (a[i] - m) ** 2;
    if (i > 0) num += (a[i] - m) * (a[i - 1] - m);
  }
  return den === 0 ? 0 : num / den;
}

// ---------- linear trend ----------
/**
 * Ordinary least squares trend with a t-test on the slope.
 * If adjustAutocorr, uses the effective sample size
 * n_eff = n (1 - r1) / (1 + r1) of the residuals (Santer et al., 2000),
 * which matters for monthly anomalies that are serially correlated.
 */
export function linearTrend(x, y, { alpha = 0.05, adjustAutocorr = true } = {}) {
  const p = pairs(x, y);
  const n = p.length;
  if (n < 4) return null;
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  const slope = sxy / sxx, intercept = my - slope * mx;
  const resid = ys.map((v, i) => v - (intercept + slope * xs[i]));
  const sse = resid.reduce((s, r) => s + r * r, 0);
  const sst = ys.reduce((s, v) => s + (v - my) ** 2, 0);
  const r1 = lag1(resid);
  let nEff = n;
  if (adjustAutocorr && r1 > 0) nEff = Math.max(3, (n * (1 - r1)) / (1 + r1));
  const df = nEff - 2;
  const se = Math.sqrt(sse / (n - 2) / sxx) * Math.sqrt((n - 2) / df);
  const t = slope / se;
  const pval = tPValue(Math.abs(t), df);
  const tc = tCrit(alpha, df);
  return {
    n, nEff, df, r1, slope, intercept, se, t, p: pval,
    ci: [slope - tc * se, slope + tc * se],
    r2: sst === 0 ? 0 : 1 - sse / sst,
    significant: pval < alpha,
  };
}

// ---------- Mann-Kendall ----------
function tieGroups(a) {
  const counts = new Map();
  for (const v of a) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.values()].filter((c) => c > 1);
}
function mkS(y) {
  let s = 0;
  for (let i = 0; i < y.length - 1; i++)
    for (let j = i + 1; j < y.length; j++) s += Math.sign(y[j] - y[i]);
  return s;
}
function mkVar(y) {
  const n = y.length;
  let v = n * (n - 1) * (2 * n + 5);
  for (const t of tieGroups(y)) v -= t * (t - 1) * (2 * t + 5);
  return v / 18;
}
function zFromS(s, v) {
  if (v <= 0) return 0;
  return s > 0 ? (s - 1) / Math.sqrt(v) : s < 0 ? (s + 1) / Math.sqrt(v) : 0;
}

/** Sen's slope (median of pairwise slopes) with Gilbert (1987) CI. */
export function senSlope(x, y, alpha = 0.05) {
  const p = pairs(x, y);
  const slopes = [];
  for (let i = 0; i < p.length - 1; i++)
    for (let j = i + 1; j < p.length; j++)
      if (p[j][0] !== p[i][0]) slopes.push((p[j][1] - p[i][1]) / (p[j][0] - p[i][0]));
  if (!slopes.length) return null;
  slopes.sort((a, b) => a - b);
  const slope = median(slopes);
  const ys = p.map((q) => q[1]);
  const c = normInv(1 - alpha / 2) * Math.sqrt(mkVar(ys));
  const N = slopes.length;
  const lo = Math.round((N - c) / 2), hi = Math.round((N + c) / 2) + 1;
  const ci = [slopes[Math.max(0, Math.min(N - 1, lo - 1))], slopes[Math.max(0, Math.min(N - 1, hi - 1))]];
  const intercept = median(p.map((q) => q[1] - slope * q[0]));
  return { slope, intercept, ci };
}

/** Mann-Kendall trend test (tie-corrected) plus Sen's slope. */
export function mannKendall(x, y, alpha = 0.05) {
  const p = pairs(x, y);
  const n = p.length;
  if (n < 4) return null;
  const ys = p.map((q) => q[1]);
  const s = mkS(ys), v = mkVar(ys);
  const z = zFromS(s, v);
  const pval = 2 * (1 - normCdf(Math.abs(z)));
  const sen = senSlope(p.map((q) => q[0]), ys, alpha);
  return {
    n, S: s, varS: v, z, p: pval,
    tau: s / (0.5 * n * (n - 1)),
    significant: pval < alpha,
    trend: pval < alpha ? (z > 0 ? "increasing" : "decreasing") : "no significant trend",
    senSlope: sen.slope, senIntercept: sen.intercept, senCI: sen.ci,
  };
}

/**
 * Seasonal Kendall test (Hirsch et al., 1982): Mann-Kendall run separately for
 * each calendar month and summed, so the seasonal cycle cannot fake a trend.
 * x = decimal years, y = values, month = 1..12.
 */
export function seasonalKendall(x, y, month, alpha = 0.05) {
  let S = 0, V = 0, n = 0;
  const slopes = [];
  for (let m = 1; m <= 12; m++) {
    const p = pairs(x.filter((_, i) => month[i] === m), y.filter((_, i) => month[i] === m));
    if (p.length < 3) continue;
    const ys = p.map((q) => q[1]);
    S += mkS(ys); V += mkVar(ys); n += p.length;
    for (let i = 0; i < p.length - 1; i++)
      for (let j = i + 1; j < p.length; j++)
        if (p[j][0] !== p[i][0]) slopes.push((p[j][1] - p[i][1]) / (p[j][0] - p[i][0]));
  }
  if (!n) return null;
  const z = zFromS(S, V);
  const pval = 2 * (1 - normCdf(Math.abs(z)));
  return { n, S, varS: V, z, p: pval, senSlope: slopes.length ? median(slopes) : NaN, significant: pval < alpha };
}

// ---------- time-series shaping ----------
/** Parse "YYYY-MM" strings into {year, month, t(decimal year)}. */
export function parseTimes(times) {
  return times.map((s) => {
    const year = +s.slice(0, 4), month = +s.slice(5, 7);
    return { year, month, t: year + (month - 0.5) / 12 };
  });
}

/** Monthly climatology (mean per calendar month) over [y0, y1]. */
export function climatology(times, values, y0 = -Infinity, y1 = Infinity) {
  const sum = Array(13).fill(0), cnt = Array(13).fill(0);
  times.forEach((tm, i) => {
    const v = values[i];
    if (Number.isFinite(v) && tm.year >= y0 && tm.year <= y1) { sum[tm.month] += v; cnt[tm.month]++; }
  });
  return sum.map((s, m) => (cnt[m] ? s / cnt[m] : NaN));
}

/** Anomalies = value minus that calendar month's long-term mean. */
export function deseasonalize(times, values, y0, y1) {
  const clim = climatology(times, values, y0, y1);
  return values.map((v, i) => (Number.isFinite(v) ? v - clim[times[i].month] : NaN));
}

/** Annual aggregation; requires >= minMonths valid months per year. */
export function annualize(times, values, how = "mean", minMonths = 12) {
  const by = new Map();
  times.forEach((tm, i) => {
    if (!Number.isFinite(values[i])) return;
    if (!by.has(tm.year)) by.set(tm.year, []);
    by.get(tm.year).push(values[i]);
  });
  const years = [], vals = [];
  for (const [yr, vs] of [...by.entries()].sort((a, b) => a[0] - b[0])) {
    if (vs.length < minMonths) continue;
    years.push(yr);
    vals.push(how === "sum" ? vs.reduce((s, v) => s + v, 0) : mean(vs));
  }
  return { years, values: vals };
}

/** Area-weighted (cos latitude) regional mean of grid cells, per time step. */
export function regionalMean(cells) {
  const T = cells[0].v.length;
  const out = new Array(T).fill(NaN);
  for (let k = 0; k < T; k++) {
    let s = 0, w = 0;
    for (const c of cells) {
      const v = c.v[k];
      if (v === null || !Number.isFinite(v)) continue;
      const wt = Math.cos((c.lat * Math.PI) / 180);
      s += v * wt; w += wt;
    }
    if (w > 0) out[k] = s / w;
  }
  return out;
}

/** Rolling sum over `win` months (NaN until the window is full). */
export function rollingSum(values, win) {
  return values.map((_, i) => {
    if (i < win - 1) return NaN;
    let s = 0;
    for (let k = i - win + 1; k <= i; k++) { if (!Number.isFinite(values[k])) return NaN; s += values[k]; }
    return s;
  });
}

/**
 * Standardized Precipitation Index (McKee et al., 1993).
 * Fits a gamma distribution (Thom MLE) per calendar month to the `scale`-month
 * accumulation, handles zeros with a mixed distribution, maps to N(0,1).
 */
export function spi(times, precip, scale = 12) {
  const acc = rollingSum(precip, scale);
  const out = new Array(acc.length).fill(NaN);
  for (let m = 1; m <= 12; m++) {
    const idx = acc.map((v, i) => i).filter((i) => times[i].month === m && Number.isFinite(acc[i]));
    const vals = idx.map((i) => acc[i]);
    const pos = vals.filter((v) => v > 0);
    if (pos.length < 10) continue;
    const q = (vals.length - pos.length) / vals.length;
    const mu = mean(pos);
    const A = Math.log(mu) - mean(pos.map(Math.log));
    let shape, scl;
    if (A <= 1e-12) { // nearly constant -> fall back to normal standardisation
      const sd = std(vals) || 1;
      idx.forEach((i) => { out[i] = (acc[i] - mean(vals)) / sd; });
      continue;
    }
    shape = (1 + Math.sqrt(1 + (4 * A) / 3)) / (4 * A);
    scl = mu / shape;
    idx.forEach((i) => {
      const H = q + (1 - q) * (acc[i] > 0 ? gammainc(shape, acc[i] / scl) : 0);
      out[i] = normInv(Math.min(Math.max(H, 1e-6), 1 - 1e-6));
    });
  }
  return out;
}

/** Standardize each value against its calendar month (z-score). */
export function standardizeByMonth(times, values) {
  const out = new Array(values.length).fill(NaN);
  for (let m = 1; m <= 12; m++) {
    const idx = values.map((v, i) => i).filter((i) => times[i].month === m && Number.isFinite(values[i]));
    if (idx.length < 3) continue;
    const vs = idx.map((i) => values[i]);
    const mu = mean(vs), sd = std(vs) || 1;
    idx.forEach((i) => { out[i] = (values[i] - mu) / sd; });
  }
  return out;
}

export function rollingMean(values, win) {
  return rollingSum(values, win).map((v) => v / win);
}

/** Drought class from an SPI-like z value. */
export function droughtClass(z) {
  if (!Number.isFinite(z)) return { level: "n/a", key: "na" };
  if (z <= -2) return { level: "Extreme drought", key: "extreme" };
  if (z <= -1.5) return { level: "Severe drought", key: "severe" };
  if (z <= -1) return { level: "Moderate drought", key: "moderate" };
  if (z <= -0.5) return { level: "Abnormally dry", key: "watch" };
  if (z >= 1) return { level: "Wet", key: "wet" };
  return { level: "Near normal", key: "normal" };
}

/**
 * Benjamini-Hochberg false discovery rate. Returns boolean[] (same order as `pvals`): true where the
 * result stays significant after allowing for many simultaneous tests (e.g. one per map cell).
 * With m tests at level q, about q*m cells would pass by luck alone if there were no real trend.
 */
export function fdr(pvals, q = 0.05) {
  const ranked = pvals.map((p, i) => [p, i]).filter(([p]) => Number.isFinite(p)).sort((a, b) => a[0] - b[0]);
  const m = ranked.length;
  let cut = -1;
  ranked.forEach(([p], j) => { if (p <= (q * (j + 1)) / m) cut = j; }); // largest rank under its line
  const keep = new Array(pvals.length).fill(false);
  for (let j = 0; j <= cut; j++) keep[ranked[j][1]] = true;
  return keep;
}

/**
 * Pettitt (1979) change-point test: is there one abrupt shift in the level of a series?
 * Rank-based, so it does not assume a straight line or normal noise. Use on yearly values.
 * Returns {index, K, p, before, after}: the shift happens AFTER position `index` (0-based, among
 * the finite values); p uses Pettitt's approximation (conservative for short series).
 */
export function pettitt(y) {
  const v = y.filter(Number.isFinite), n = v.length;
  if (n < 8) return null;
  let U = 0, K = 0, index = 0;
  // U_t = U_{t-1} + sum_j sign(x_t - x_j)   (Pettitt's identity)
  for (let t = 0; t < n - 1; t++) {
    for (let j = 0; j < n; j++) U += Math.sign(v[t] - v[j]);
    if (Math.abs(U) > K) { K = Math.abs(U); index = t; }
  }
  const p = Math.min(1, 2 * Math.exp((-6 * K * K) / (n ** 3 + n ** 2)));
  return { index, K, p, before: mean(v.slice(0, index + 1)), after: mean(v.slice(index + 1)) };
}
