// Run: node tests/test_stats.mjs   (compares stats.js with scipy reference values)
import { readFileSync } from "node:fs";
import * as S from "../web/js/stats.js";
const ref = JSON.parse(readFileSync(new URL("./reference.json", import.meta.url)));
let fails = 0, passes = 0;
const close = (name, a, b, tol = 1e-6) => {
  const ok = Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
  ok ? passes++ : (fails++, console.log(`FAIL ${name}: got ${a}, expected ${b}`));
};
ref.fn.tp.forEach(([t, df, p]) => close(`tPValue(${t},${df})`, S.tPValue(t, df), p));
ref.fn.tcrit.forEach(([df, t]) => close(`tCrit(${df})`, S.tCrit(0.05, df), t, 1e-6));
ref.fn.ninv.forEach(([p, z]) => close(`normInv(${p})`, S.normInv(p), z, 1e-7));
ref.fn.ncdf.forEach(([z, p]) => close(`normCdf(${z})`, S.normCdf(z), p, 1e-9));
ref.fn.ginc.forEach(([a, x, p]) => close(`gammainc(${a},${x})`, S.gammainc(a, x), p, 1e-9));
ref.cases.forEach((c, k) => {
  const lt = S.linearTrend(c.x, c.y, { adjustAutocorr: false });
  close(`case${k} slope`, lt.slope, c.slope); close(`case${k} intercept`, lt.intercept, c.intercept);
  close(`case${k} se`, lt.se, c.se); close(`case${k} p`, lt.p, c.p, 1e-6);
  close(`case${k} ci0`, lt.ci[0], c.ci[0]); close(`case${k} ci1`, lt.ci[1], c.ci[1]);
  const mk = S.mannKendall(c.x, c.y);
  close(`case${k} S`, mk.S, c.S, 0); close(`case${k} varS`, mk.varS, c.varS);
  close(`case${k} z`, mk.z, c.z); close(`case${k} mk p`, mk.p, c.mkp, 1e-7);
  close(`case${k} sen`, mk.senSlope, c.sen);
  close(`case${k} senCI0`, mk.senCI[0], c.senCI[0]); close(`case${k} senCI1`, mk.senCI[1], c.senCI[1]);
});
const times = S.parseTimes(ref.fn.spi.prec.map((_, i) => `${1981 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`));
const spi = S.spi(times, ref.fn.spi.prec, 12);
ref.fn.spi.spi.forEach((v, i) => { if (v === null) { if (Number.isFinite(spi[i])) { fails++; console.log(`FAIL spi[${i}] should be NaN`); } } else close(`spi[${i}]`, spi[i], v, 1e-6); });
// autocorrelation adjustment should widen the CI for red noise
const x = [], y = []; let e = 0;
for (let i = 0; i < 300; i++) { e = 0.8 * e + Math.sin(i * 12.9898) * 0.5; x.push(i / 12); y.push(e); }
const adj = S.linearTrend(x, y), raw = S.linearTrend(x, y, { adjustAutocorr: false });
(adj.se > raw.se && adj.nEff < raw.n) ? passes++ : (fails++, console.log("FAIL autocorr adjustment"));
console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
