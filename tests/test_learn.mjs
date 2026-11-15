// Run: node tests/test_learn.mjs
// The "How it works" page teaches by experiment. These tests check that each experiment really demonstrates
// what the page says it does, across many random seeds (not just one lucky draw).
import { rng, makeSeries, analyseSeries, fdrDemo, blend } from "../web/js/learn.js";
import * as S from "../web/js/stats.js";
let passes = 0, fails = 0;
const ok = (name, cond, extra = "") => (cond ? passes++ : (fails++, console.log(`FAIL ${name} ${extra}`)));
const share = (arr, f) => arr.filter(f).length / arr.length;
const seeds = Array.from({ length: 300 }, (_, i) => i * 37 + 5);

// determinism: the same settings must always give the same picture
ok("rng is deterministic", rng(5)() === rng(5)() && rng(5)() !== rng(6)());
const a = makeSeries({ seed: 3 }), b = makeSeries({ seed: 3 }), c = makeSeries({ seed: 4 });
ok("series is deterministic", JSON.stringify(a.y) === JSON.stringify(b.y));
ok("a new seed gives new years", JSON.stringify(a.y) !== JSON.stringify(c.y));
ok("45 years, 1981-2025", a.x.length === 45 && a.x[0] === 1981 && a.x.at(-1) === 2025);

// lesson 1: honest verdicts
const PRE = {
  drift: { slope: -40, noise: 120, step: 0, spikes: false },
  none: { slope: 0, noise: 140, step: 0, spikes: false },
  extreme: { slope: -40, noise: 60, step: 0, spikes: true },
  strong: { slope: -90, noise: 60, step: 0, spikes: false },
  step: { slope: 0, noise: 100, step: 200, spikes: false },
};
const run = (p) => seeds.map((seed) => analyseSeries(...Object.values(makeSeries({ seed, ...p }))));
const ext = run(PRE.extreme), none = run(PRE.none), strong = run(PRE.strong), drift = run(PRE.drift), stp = run(PRE.step);
ok("'nothing real' rarely passes both tests (false positives stay near 5%)", share(none, (r) => r.n === 2) < 0.12, share(none, (r) => r.n === 2));
ok("a strong change almost always passes both tests", share(strong, (r) => r.n === 2) > 0.95, share(strong, (r) => r.n === 2));
ok("a steady drift is detected more often than nothing", share(drift, (r) => r.n >= 1) > share(none, (r) => r.n >= 1) + 0.2);
ok("verdict count is always 0, 1 or 2", drift.every((r) => [0, 1, 2].includes(r.n)));

ok("a few extreme wet years fool the t-test but not Mann-Kendall (>80% of seeds)", share(ext, (r) => !r.lin.significant && r.mk.significant) > 0.8, share(ext, (r) => !r.lin.significant && r.mk.significant));

// lesson 2: a sudden step is found, with the right year and sensible before/after levels
ok("the step test finds a 200 mm drop in >90% of seeds", share(stp, (r) => r.change.significant) > 0.9, share(stp, (r) => r.change.significant));
const yrs = stp.filter((r) => r.change.significant).map((r) => r.change.year);
ok("the step is located near 1994", yrs.filter((y) => Math.abs(y - 1994) <= 2).length / yrs.length > 0.8);
ok("before is higher than after for a drop", stp.every((r) => r.change.before > r.change.after));
ok("no step is claimed in pure noise most of the time", share(none, (r) => r.change.significant) < 0.15, share(none, (r) => r.change.significant));

// lesson 3: false discoveries and the correction
let worse = 0, fewerFalse = 0, keptReal = [];
for (const seed of seeds) {
  const off = fdrDemo({ seed, real: 0, correct: false }), on = fdrDemo({ seed, real: 0, correct: true });
  if (on.falseAlarms > off.falseAlarms) worse++;
  if (on.falseAlarms <= 1) fewerFalse++;
  const m = fdrDemo({ seed, real: 30, correct: true }); keptReal.push(m.truePos / 30);
}
const offAvg = seeds.reduce((s, seed) => s + fdrDemo({ seed, real: 0, correct: false }).falseAlarms, 0) / seeds.length;
ok("with no real trends, ~6 of 120 cells flag by luck (5%)", Math.abs(offAvg - 6) < 1, offAvg);
ok("the correction never adds false alarms", worse === 0);
ok("with the correction on, almost always at most 1 false alarm", fewerFalse / seeds.length > 0.9, fewerFalse / seeds.length);
ok("the correction keeps most strong real trends", keptReal.reduce((s, v) => s + v, 0) / keptReal.length > 0.7);
const d = fdrDemo({ seed: 9, real: 20, correct: false });
ok("counts add up", d.flagged === d.truePos + d.falseAlarms && d.cells.length === 120 && d.cols * d.rows === 120 && d.cells.filter((c) => c.real).length === 20);
ok("missed = real cells not flagged", d.missed === d.cells.filter((c) => c.real && !c.flag).length);
ok("moving the slider only adds real cells (smooth)", fdrDemo({ seed: 9, real: 21 }).cells.filter((c) => c.real).length === 21);

// lesson 4: the thermometer
ok("blend weights are 60/20/20", Math.abs(blend(1, 0, 0) - 0.6) < 1e-12 && Math.abs(blend(0, 1, 0) - 0.2) < 1e-12 && Math.abs(blend(0, 0, 1) - 0.2) < 1e-12);
ok("'Severe drought' example reads about -2.08 (extreme)", Math.abs(blend(-2.3, -1.8, -1.7) + 2.08) < 0.005 && S.droughtClass(blend(-2.3, -1.8, -1.7)).key === "extreme");
ok("'Slightly dry' example is 'watch'", S.droughtClass(blend(-0.7, -0.6, -0.5)).key === "watch");
ok("'Normal' example is near normal", S.droughtClass(blend(0, 0, 0)).key === "normal");
ok("'Wet spell' example is wet", S.droughtClass(blend(1.6, 1.3, 1.0)).key === "wet");

// what a visitor sees first (the page's default seed is 1): each preset must tell the story its label promises
const first = (p) => { const s = makeSeries({ seed: 1, ...p }); return analyseSeries(s.x, s.y); };
const f = { drift: first(PRE.drift), none: first(PRE.none), step: first(PRE.step), ext: first(PRE.extreme) };
console.log("first-view verdicts at seed 1:", { drift: f.drift.n, none: f.none.n, stepFound: f.step.change.significant, stepYear: f.step.change.year });
ok("first view: 'Steady drift' shows Significant", f.drift.n === 2);
ok("first view: 'Nothing real' shows Not significant", f.none.n === 0);
ok("first view: 'Sudden drop' finds the step at 1994", f.step.change.significant && f.step.change.year === 1994);
ok("first view: 'Extreme years' gives Borderline (one test passes)", f.ext.n === 1 && !f.ext.lin.significant && f.ext.mk.significant);

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
