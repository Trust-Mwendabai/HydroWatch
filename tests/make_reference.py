"""Generate reference values with numpy/scipy for tests/test_stats.mjs."""
import json, os
import numpy as np
from scipy import stats

rng = np.random.default_rng(42)
cases = []
for n, slope, noise, ties in [(45, 0.03, 0.5, False), (30, -0.2, 2.0, False), (540, 0.002, 0.3, False), (25, 0.0, 1.0, True)]:
    x = np.arange(n, dtype=float) / (12 if n > 100 else 1) + 1981
    y = slope * (x - x[0]) + rng.normal(0, noise, n)
    if ties:
        y = np.round(y, 0)
    lr = stats.linregress(x, y)
    tc = stats.t.ppf(0.975, n - 2)
    # Mann-Kendall (independent implementation)
    S = sum(np.sign(y[j] - y[i]) for i in range(n - 1) for j in range(i + 1, n))
    _, cnt = np.unique(y, return_counts=True)
    var = (n * (n - 1) * (2 * n + 5) - sum(t * (t - 1) * (2 * t + 5) for t in cnt if t > 1)) / 18
    z = (S - np.sign(S)) / np.sqrt(var) if S != 0 else 0.0
    p = 2 * stats.norm.sf(abs(z))
    th = stats.theilslopes(y, x, 0.95, method="joint")
    cases.append(dict(x=x.tolist(), y=y.tolist(), slope=lr.slope, intercept=lr.intercept,
                      p=lr.pvalue, se=lr.stderr, ci=[lr.slope - tc * lr.stderr, lr.slope + tc * lr.stderr],
                      S=float(S), varS=float(var), z=float(z), mkp=float(p), sen=float(th.slope),
                      senCI=[float(th.low_slope), float(th.high_slope)]))
fn = dict(
    tp=[[t, df, float(2 * stats.t.sf(t, df))] for t, df in [(2.1, 10), (0.5, 3), (4.0, 100), (1.96, 1e4)]],
    tcrit=[[df, float(stats.t.ppf(0.975, df))] for df in [5, 20, 43, 500]],
    ninv=[[p, float(stats.norm.ppf(p))] for p in [1e-5, 0.01, 0.3, 0.5, 0.9, 0.999]],
    ncdf=[[z, float(stats.norm.cdf(z))] for z in [-3.2, -1, 0, 0.7, 2.5]],
    ginc=[[a, x, float(stats.gamma.cdf(x, a))] for a, x in [(0.5, 0.3), (2.0, 1.5), (7.3, 12.0), (30, 25)]],
)
# SPI reference with the same Thom estimator, scipy gamma CDF
prec = rng.gamma(2.0, 1.5, 12 * 40)
acc = np.convolve(prec, np.ones(12), "valid")  # index i -> months i..i+11
months = (np.arange(len(prec)) % 12) + 1
spi = np.full(len(prec), np.nan)
for m in range(1, 13):
    idx = [i + 11 for i in range(len(acc)) if months[i + 11] == m]
    v = np.array([acc[i - 11] for i in idx])
    A = np.log(v.mean()) - np.log(v).mean()
    a = (1 + np.sqrt(1 + 4 * A / 3)) / (4 * A)
    spi[idx] = stats.norm.ppf(stats.gamma.cdf(v, a, scale=v.mean() / a))
fn["spi"] = dict(prec=prec.tolist(), spi=[None if np.isnan(s) else float(s) for s in spi])
json.dump(dict(cases=cases, fn=fn), open(os.path.join(os.path.dirname(__file__), "reference.json"), "w"))
print("wrote reference.json")
