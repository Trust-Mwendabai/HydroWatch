// Run: node tests/test_fdr_pettitt.mjs
import * as S from "../web/js/stats.js";
let passes = 0, fails = 0;
const ok = (name, cond, extra = "") => (cond ? passes++ : (fails++, console.log(`FAIL ${name} ${extra}`)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- Benjamini-Hochberg false discovery rate ----
// sorted p = .005 .01 .03 .04 vs thresholds q*k/m = .0125 .025 .0375 .05 -> all four pass
ok("BH keeps all when every p is under its line", same(S.fdr([0.01, 0.04, 0.03, 0.005], 0.05), [true, true, true, true]));
// sorted .001 .02 .2 .9 vs .0125 .025 .0375 .05 -> only the first two pass
ok("BH drops large p-values", same(S.fdr([0.9, 0.001, 0.2, 0.02], 0.05), [false, true, false, true]));
// step-up rule: the LARGEST rank under its line decides, so .049 <= .05 at k=4 lets all four through
ok("BH step-up rescues earlier p-values", same(S.fdr([0.011, 0.012, 0.0125, 0.049], 0.05), [true, true, true, true]));
ok("BH with nothing significant keeps nothing", same(S.fdr([0.4, 0.6, 0.8], 0.05), [false, false, false]));
ok("BH ignores NaN and keeps positions", same(S.fdr([NaN, 0.001, NaN, 0.9], 0.05), [false, true, false, false]));
ok("BH on empty input", same(S.fdr([], 0.05), []));
// Why it matters: 10 marginal p=0.04 among 20 tests all pass an uncorrected 5% test, but none survive FDR
const marginal = [...Array(10).fill(0.04), ...Array(10).fill(0.9)];
ok("uncorrected 5% would flag the 10 marginal cells", marginal.filter((p) => p < 0.05).length === 10);
ok("FDR flags none of them", S.fdr(marginal, 0.05).filter(Boolean).length === 0);
// but a genuine field of strong signals survives
ok("FDR keeps a field of strong signals", S.fdr([...Array(10).fill(0.001), ...Array(10).fill(0.9)], 0.05).filter(Boolean).length === 10);

// ---- Pettitt change-point test ----
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5);
const step = [...Array(20)].map(() => rnd()).concat([...Array(20)].map(() => 5 + rnd()));
const pt = S.pettitt(step);
ok("Pettitt finds the break after index 19", pt.index === 19, `got ${pt.index}`);
ok("Pettitt p is tiny for a clear step", pt.p < 0.001, `p=${pt.p}`);
ok("Pettitt reports regime means", Math.abs(pt.before) < 0.5 && Math.abs(pt.after - 5) < 0.5, `${pt.before} ${pt.after}`);
const flat = [...Array(40)].map(() => rnd());
ok("Pettitt p is large for noise", S.pettitt(flat).p > 0.1, `p=${S.pettitt(flat).p}`);
const ramp = [...Array(40)].map((_, i) => i);
ok("Pettitt flags a monotonic ramp (it is a shift detector)", S.pettitt(ramp).p < 0.01);
ok("Pettitt needs enough data", S.pettitt([1, 2, 3]) === null);
ok("Pettitt skips NaN", S.pettitt([...step.slice(0, 20), NaN, ...step.slice(20)]).index === 19);
// scale / shift invariance (rank-based test)
const scaled = step.map((v) => v * 100 + 7);
ok("Pettitt is invariant to scale and shift", S.pettitt(scaled).index === pt.index && Math.abs(S.pettitt(scaled).p - pt.p) < 1e-12);

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
