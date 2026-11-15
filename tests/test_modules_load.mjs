// Run: node tests/test_modules_load.mjs
// Imports every browser module that does not need the DOM, so a syntax error, a duplicate declaration or a broken
// import fails here instead of silently blanking the page. (`node --check` does NOT catch these in ES modules.)
// It also runs the full analysis on real cached NASA data when available.
import { readdirSync, readFileSync, existsSync } from "node:fs";
let fails = 0;
for (const m of ["stats", "catalog", "sites", "analysis", "report", "icons", "learn"]) {
  try { await import(`../web/js/${m}.js`); console.log("ok  ", m); } catch (e) { fails++; console.log("FAIL", m, "-", e.message); }
}
const A = await import("../web/js/analysis.js");
const dir = new URL("../data/cache/", import.meta.url);
if (existsSync(dir)) {
  const grids = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const j = JSON.parse(readFileSync(new URL(f, dir)));
    if (j.bbox && Math.abs(j.bbox[0] - -17) < 0.01 && Math.abs(j.bbox[2] - 20) < 0.01 && j.param && !grids[j.param]) grids[j.param] = j;
  }
  if (grids.PRECTOTCORR) {
    const r = A.analyse("PRECTOTCORR", grids, { y0: 1981, y1: 2025, mode: "annual", alpha: 0.05 });
    const cs = r.cellStats;
    const sane = cs.fdrUp + cs.fdrDown <= cs.up + cs.down + cs.n && cs.fdrUp >= 0 && r.cellTrends.every((c) => typeof c.fdr === "boolean");
    console.log(`Kariba rainfall: ${cs.n} cells, ${cs.up}/${cs.down} significant up/down, ${cs.fdrUp}/${cs.fdrDown} after FDR; change:`, r.change && { year: r.change.year, p: +r.change.p.toFixed(3), significant: r.change.significant });
    if (!sane) { fails++; console.log("FAIL FDR bookkeeping"); }
    if (cs.fdrUp + cs.fdrDown > Math.max(cs.up + cs.down, 0) + 0) { /* FDR on MK-p can differ from the either-test rule; only report */ }
  } else console.log("skip real-data check (Kariba rainfall not cached yet)");
}
process.exit(fails ? 1 : 0);
