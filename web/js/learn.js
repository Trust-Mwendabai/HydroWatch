// "How it works": an interactive explainer. Every experiment runs the app's REAL statistics (stats.js),
// so what a visitor sees react here is exactly what the analysis does with NASA data.
import * as S from "./stats.js";
import { icon, hydrateIcons } from "./icons.js";

/* ====================== pure helpers (no DOM; unit-tested in tests/test_learn.mjs) ====================== */
const YEARS = Array.from({ length: 45 }, (_, i) => 1981 + i);

export function rng(seed) {                       // small deterministic random generator (mulberry32)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-9))) * Math.cos(2 * Math.PI * r());

/** 45 "years" of rainfall-like data: drift + optional sudden step (after 1993) + noise + optional extreme years. */
export function makeSeries({ seed = 1, slope = -40, noise = 120, step = 0, spikes = false } = {}) {
  const r = rng(seed);
  const y = YEARS.map((yr, i) => 1000 + (slope / 10) * (yr - 1981) - (i >= 13 ? step : 0) + noise * gauss(r));
  if (spikes) [30, 33, 38].forEach((i) => { y[i] += 450; });
  return { x: YEARS, y };
}

/** Same two tests + change-point test the real app uses. n = how many of the two tests pass (0, 1 or 2). */
export function analyseSeries(x, y) {
  const lin = S.linearTrend(x, y, { alpha: 0.05 }), mk = S.mannKendall(x, y, 0.05), pt = S.pettitt(y);
  return {
    lin, mk, n: (lin.significant ? 1 : 0) + (mk.significant ? 1 : 0),
    change: pt && { year: x[pt.index + 1], p: pt.p, before: pt.before, after: pt.after, significant: pt.p < 0.05 },
  };
}

/** 15 x 8 map cells. `real` cells carry a genuine trend, the rest are pure noise. Optionally apply the FDR correction. */
export function fdrDemo({ seed = 1, real = 15, correct = false, cols = 15, rows = 8 } = {}) {
  const r = rng(seed), total = cols * rows, idx = [...Array(total).keys()];
  for (let i = total - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const isReal = new Array(total).fill(false);
  idx.slice(0, real).forEach((i) => { isReal[i] = true; });
  const p = isReal.map((re) => { const u = r(); return re ? u ** 3 * 0.02 : u; });   // same draw either way: sliders move smoothly. Real trends: mostly strong, some weak
  const flag = correct ? S.fdr(p, 0.05) : p.map((v) => v < 0.05);
  const cells = p.map((pv, i) => ({ p: pv, real: isReal[i], flag: flag[i] }));
  return {
    cells, cols, rows,
    flagged: cells.filter((c) => c.flag).length,
    truePos: cells.filter((c) => c.flag && c.real).length,
    falseAlarms: cells.filter((c) => c.flag && !c.real).length,
    missed: cells.filter((c) => c.real && !c.flag).length,
  };
}

/** The Hydro Stress Index blend used by the app: 60% 12-month rain, 20% 3-month rain, 20% soil moisture. */
export const blend = (spi12, spi3, soil) => 0.6 * spi12 + 0.2 * spi3 + 0.2 * soil;

/* ====================== content ====================== */
const STEPS = [
  { id: "big", title: "The big picture", icon: "compass" },
  { id: "trend", title: "Spot a trend", icon: "trending-down" },
  { id: "step", title: "Sudden steps", icon: "activity" },
  { id: "tests", title: "Many tests, lucky guesses", icon: "grid" },
  { id: "warn", title: "Early warning", icon: "thermometer" },
  { id: "words", title: "Plain-language glossary", icon: "book" },
  { id: "go", title: "Your turn", icon: "play" },
];

const PIPE = [
  { icon: "globe", title: "NASA data", text: "Satellites and weather computers have logged rain, heat and soil moisture every month since 1981. HydroWatch reads that record from NASA POWER." },
  { icon: "server", title: "Local server", text: "A small Python program fetches each region once and keeps a copy, so the demos work offline and the map loads fast." },
  { icon: "monitor", title: "Your browser", text: "All the statistics run right here: the trend, two significance tests, the cell-by-cell map, the step-change test and the drought index." },
  { icon: "check", title: "The verdict", text: "One word you can trust, Significant, Borderline or Not significant, with a chart, a map and the uncertainty shown." },
];

const PRESETS = {
  drift: { label: "Steady drift", slope: -40, noise: 120, step: 0, spikes: false },
  none: { label: "Nothing real", slope: 0, noise: 140, step: 0, spikes: false },
  extreme: { label: "A few extreme years", slope: -40, noise: 60, step: 0, spikes: true },
  step: { label: "Sudden drop", slope: 0, noise: 100, step: 200, spikes: false },
};

const ZONES = {
  extreme: "A rare, severe drought. Expect serious pressure on the water reaching the dam.",
  severe: "A severe drought. Inflow to the reservoir is likely well below normal.",
  moderate: "Inflow risk starts here for hydropower. This is the line the app watches.",
  watch: "Drier than usual. Not an emergency, but worth watching.",
  normal: "Within the normal range of ups and downs.",
  wet: "Wetter than normal. Good news for inflow.",
};

const WARN_PRESETS = [
  { label: "Normal", v: [0, 0, 0] },
  { label: "Slightly dry", v: [-0.7, -0.6, -0.5] },
  { label: "Severe drought (like Kariba 2024)", v: [-2.3, -1.8, -1.7] },
  { label: "Wet spell", v: [1.6, 1.3, 1.0] },
];

const TERMS = [
  ["Trend", "The direction something drifts over many years.", "Pencil marks of a child's height on a door frame: each year a little higher or lower."],
  ["p-value", "How surprised you should be if nothing had really changed. Small means very surprised, so the change is probably real.", "Seventy heads in a hundred coin flips. You would suspect a loaded coin."],
  ["Significant", "A change that is very unlikely to be luck. By default, less than a 5% chance.", "A witness whose story matches the evidence."],
  ["Likely range", "The 95% confidence range: where the true change probably sits. If it includes zero, 'no change' is still possible.", "A best guess with wiggle room."],
  ["Two tests", "A t-test (is the slope steady?) and Mann-Kendall (are later years higher or lower?). Both pass means Significant. One means Borderline.", "Two doctors giving independent opinions."],
  ["False discovery rate", "A correction for testing many map cells at once, so lucky cells are not mistaken for real trends.", "Buy 120 lottery tickets and a few will win by luck."],
  ["Step change", "An abrupt shift in the level, found with the Pettitt test. No straight line assumed.", "A staircase, not a slope."],
  ["Reanalysis", "MERRA-2: a weather model re-run over the past and nudged toward every real measurement.", "A GPS that keeps correcting its guess using satellite fixes."],
  ["Anomaly", "How far a month is from what is normal for that month.", "Your weight compared with your own usual weight."],
  ["Hydro Stress Index", "The app's early-warning blend of rainfall and soil moisture. Below -1 means inflow risk.", "A thermometer for dryness."],
];

/* ====================== view ====================== */
const $q = (root, sel) => root.querySelector(sel);
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d).replace("-", "−") : "–");
const fmtP = (p) => (p < 0.001 ? "< 0.001" : p.toFixed(3));
const tagFor = (n) => [["ns", "Not significant"], ["mixed", "Borderline"], ["sig", "Significant"]][n];
const slider = (id, label, min, max, stp, val, unit = "") =>
  `<div class="slider"><label for="${id}"><span>${label}</span><b id="${id}V">${val}${unit}</b></label><input id="${id}" type="range" min="${min}" max="${max}" step="${stp}" value="${val}"></div>`;
const notice = (items) => `<ul class="notice">${items.map((t) => `<li>${icon("check")}<span>${t}</span></li>`).join("")}</ul>`;
const head = (eyebrow, title, lead) => `<div class="eyebrow">${eyebrow}</div><h3 class="big">${title}</h3><p class="lead">${lead}</p>`;

function chartSVG(series, res, { line = true, stepView = false } = {}) {
  const W = 640, H = 250, L = 46, R = 14, T = 14, B = 30, { x, y } = series;
  const lo = Math.min(...y), hi = Math.max(...y), pad = (hi - lo) * 0.1 || 1;
  const X = (v) => L + ((v - 1981) / 44) * (W - L - R), Y = (v) => T + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - T - B);
  const ticks = [0, 1, 2, 3].map((i) => lo - pad + ((hi - lo + 2 * pad) * i) / 3);
  let g = ticks.map((t) => `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${L - 8}" y="${Y(t) + 4}" text-anchor="end">${Math.round(t)}</text>`).join("");
  g += [1985, 1995, 2005, 2015, 2025].map((t) => `<text class="ax" x="${X(t)}" y="${H - 8}" text-anchor="middle">${t}</text>`).join("");
  if (stepView && res.change && res.change.significant) {
    const cx = X(res.change.year - 0.5);
    g += `<line class="stepl" x1="${cx}" x2="${cx}" y1="${T}" y2="${H - B}"/>`
      + `<line class="stepm" x1="${L}" x2="${cx}" y1="${Y(res.change.before)}" y2="${Y(res.change.before)}"/><line class="stepm" x1="${cx}" x2="${W - R}" y1="${Y(res.change.after)}" y2="${Y(res.change.after)}"/>`;
  } else if (line) {
    const a = res.lin.intercept + res.lin.slope * 1981, b = res.lin.intercept + res.lin.slope * 2025;
    g += `<line class="trendl" x1="${X(1981)}" x2="${X(2025)}" y1="${Y(a)}" y2="${Y(b)}"/>`;
  }
  g += x.map((xv, i) => `<circle class="dot" cx="${X(xv)}" cy="${Y(y[i])}" r="3.6"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Simulated yearly rainfall with the fitted trend">${g}</svg>`;
}

/* A trend experiment used by two steps (drift lab, step lab). */
function trendLab(cfg) {
  const st = { ...PRESETS[cfg.preset], seed: 1, view: "line" };
  const html = `<div class="lab split">
    <div class="chips" role="group" aria-label="Examples">${Object.entries(PRESETS).map(([k, p]) => `<button class="chipbtn${k === cfg.preset ? " on" : ""}" data-preset="${k}">${p.label}</button>`).join("")}</div>
    <div class="chart pane" data-el="chart"></div>
    <div class="readout" data-el="read"></div>
    <div class="side">
      <div class="sliders">${slider("sl", "True change per decade", -100, 100, 5, st.slope)}${slider("sn", "Natural ups and downs", 40, 300, 10, st.noise)}${slider("ss", "Sudden drop in 1994", 0, 300, 10, st.step)}</div>
      <div class="chips tools"><button class="btn small" data-act="reroll">${icon("shuffle")}New random years</button>
        <button class="chipbtn" data-act="spikes" aria-pressed="${st.spikes}">Add 3 extreme wet years</button>
        ${cfg.stepToggle ? `<span class="seg" role="group" aria-label="View"><button class="chipbtn on" data-view="line">Straight line</button><button class="chipbtn" data-view="step">Step change</button></span>` : ""}</div>
    </div>
  </div>`;
  const bind = (root) => {
    const draw = () => {
      const s = makeSeries(st), res = analyseSeries(s.x, s.y), [cls, word] = tagFor(res.n);
      $q(root, '[data-el="chart"]').innerHTML = chartSVG(s, res, { stepView: st.view === "step" });
      const c = res.change, stepTxt = c && c.significant ? `Yes, around <b>${c.year}</b> (p = ${fmtP(c.p)})` : "None found";
      $q(root, '[data-el="read"]').innerHTML = `
        <div class="rcard"><div class="k">Verdict</div><div class="v"><span class="tag ${cls}">${word}</span></div></div>
        <div class="rcard"><div class="k">Change per decade</div><div class="v">${res.lin.slope > 0 ? "+" : ""}${fmt(res.lin.slope * 10)} <small>mm/yr</small></div></div>
        <div class="rcard"><div class="k">Test 1: steady trend</div><div class="v ${res.lin.significant ? "pass" : "fail"}">${res.lin.significant ? "Passes" : "Fails"}</div><div class="s">p = ${fmtP(res.lin.p)}</div></div>
        <div class="rcard"><div class="k">Test 2: ups vs downs</div><div class="v ${res.mk.significant ? "pass" : "fail"}">${res.mk.significant ? "Passes" : "Fails"}</div><div class="s">p = ${fmtP(res.mk.p)}</div></div>
        <div class="rcard wide"><div class="k">Sudden step found?</div><div class="v sm">${stepTxt}</div></div>`;
      for (const [id, key] of [["sl", "slope"], ["sn", "noise"], ["ss", "step"]]) {
        $q(root, `#${id}`).value = st[key]; $q(root, `#${id}V`).textContent = key === "slope" && st[key] > 0 ? "+" + st[key] : st[key];
      }
      const sp = $q(root, '[data-act="spikes"]'); sp.setAttribute("aria-pressed", st.spikes); sp.classList.toggle("on", st.spikes);
      root.querySelectorAll("[data-preset]").forEach((b) => b.classList.toggle("on", b.dataset.preset === st.preset));
      root.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === st.view));
    };
    for (const [id, key] of [["sl", "slope"], ["sn", "noise"], ["ss", "step"]]) $q(root, `#${id}`).oninput = (e) => { st[key] = +e.target.value; st.preset = null; draw(); };
    root.querySelectorAll("[data-preset]").forEach((b) => (b.onclick = () => { Object.assign(st, PRESETS[b.dataset.preset], { preset: b.dataset.preset }); if (cfg.stepToggle && b.dataset.preset === "step") st.view = "step"; draw(); }));
    $q(root, '[data-act="reroll"]').onclick = () => { st.seed = (st.seed * 7919 + 13) % 99991; draw(); };
    $q(root, '[data-act="spikes"]').onclick = () => { st.spikes = !st.spikes; st.preset = null; draw(); };
    root.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => { st.view = b.dataset.view; draw(); }));
    st.preset = cfg.preset; if (cfg.stepToggle) st.view = "step"; draw();
  };
  return { html, bind };
}

const VIEWS = {
  big() {
    const html = `${head("Step 1 of 7", "From NASA's record to one honest answer", "HydroWatch turns 45 years of NASA data into a plain answer: is the water behind a dam really changing? Click each stage, or press play to follow the journey.")}
      <div class="lab"><div class="pipe" role="tablist" aria-label="The four stages">${PIPE.map((p, i) => `${i ? '<span class="flow" aria-hidden="true"></span>' : ""}<button class="node${i ? "" : " on"}" role="tab" data-node="${i}" aria-selected="${i === 0}"><span class="ico">${icon(p.icon)}</span><b>${p.title}</b></button>`).join("")}</div>
      <div class="nodecard" data-el="node" aria-live="polite"></div>
      <div class="chips tools"><button class="btn small primary" data-act="play">${icon("play")}Play the journey</button></div></div>
      ${notice(["No account, no API key and nothing to install to run the core app.", "The same analysis code runs in the browser and in the automated tests, so what you see is what was tested.", "Everything you open is saved, so those regions keep working offline."])}`;
    const bind = (root, ctx) => {
      let cur = 0, timer = null;
      const show = (i) => {
        cur = i; root.querySelectorAll("[data-node]").forEach((b) => { const on = +b.dataset.node === i; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
        $q(root, '[data-el="node"]').innerHTML = `<h4>${icon(PIPE[i].icon)}${PIPE[i].title}</h4><p>${PIPE[i].text}</p>`;
      };
      const stop = () => { clearInterval(timer); timer = null; const b = $q(root, '[data-act="play"]'); if (b) b.innerHTML = `${icon("play")}Play the journey`; };
      root.querySelectorAll("[data-node]").forEach((b) => (b.onclick = () => { stop(); show(+b.dataset.node); }));
      $q(root, '[data-act="play"]').onclick = () => {
        if (timer) return stop();
        $q(root, '[data-act="play"]').textContent = "Pause"; show(0);
        timer = setInterval(() => { if (cur >= 3) return stop(); show(cur + 1); }, 2200);
      };
      ctx.onLeave(stop); show(0);
    };
    return { html, bind };
  },

  trend() {
    const lab = trendLab({ preset: "drift" });
    return {
      html: `${head("Step 2 of 7", "Spot a trend, then test it", "A trend is the direction numbers drift over many years. But weather is noisy, so every trend must pass two different tests before the tool says it is real. Pick an example or drag the sliders.")}${lab.html}
        ${notice(["Little real change plus big natural noise gives 'Not significant'. That is the tool being honest, not failing.", "A few extreme years can fool one test but not the other. That is why there are two.", "Press 'New random years': the same settings give different data, like different decades of weather."])}`,
      bind: lab.bind,
    };
  },

  step() {
    const lab = trendLab({ preset: "step", stepToggle: true });
    return {
      html: `${head("Step 3 of 7", "Sometimes change is a staircase", "A straight trend line assumes a slow slope. Kariba's rain actually dropped in one step around 1994. Flip between the two views and see how a staircase looks to each method.")}${lab.html}
        ${notice(["A straight line spreads a sudden drop over 45 years, so it understates it.", "The step test (Pettitt) needs no straight-line assumption. It looks for one abrupt jump.", "It also fires on a steady ramp, so treat it as a clue, not proof."])}`,
      bind: lab.bind,
    };
  },

  tests() {
    const html = `${head("Step 4 of 7", "Test enough cells and some win by luck", "The map runs a test in every grid cell. At a 5% threshold, about 1 in 20 cells with no real trend still lights up. Slide the real-trend count down to zero, then switch the correction on.")}
      <div class="lab split fdr">
        <div class="pane"><div class="fgrid" data-el="grid" aria-label="120 map cells"></div>
          <div class="legend2"><span><i class="sw real"></i>Real trend found</span><span><i class="sw fake"></i>Lucky false alarm</span><span><i class="sw miss"></i>Real but missed</span><span><i class="sw none"></i>Nothing flagged</span></div></div>
        <div class="readout" data-el="read"></div>
        <div class="side">
          <div class="sliders one">${slider("fr", "Cells with a REAL trend", 0, 40, 1, 15)}</div>
          <div class="chips tools"><button class="btn small" data-act="reroll">${icon("shuffle")}Re-roll the luck</button>
            <button class="chipbtn" data-act="fdr" aria-pressed="false">Correct for many tests (FDR): <b>Off</b></button></div>
        </div>
      </div>
      ${notice(["With 0 real trends, about 6 of 120 cells still flag by luck. That is 5% of 120.", "The correction (false discovery rate) removes most of those lucky cells.", "It keeps cells with strong evidence. It can miss weak real ones: honesty has a price."])}`;
    const bind = (root) => {
      const st = { seed: 11, real: 15, correct: false };
      const draw = () => {
        const d = fdrDemo(st);
        $q(root, '[data-el="grid"]').style.gridTemplateColumns = `repeat(${d.cols}, 1fr)`;
        $q(root, '[data-el="grid"]').innerHTML = d.cells.map((c) => `<i class="fcell ${c.flag ? (c.real ? "real" : "fake") : c.real ? "miss" : ""}" title="p = ${c.p.toFixed(3)}${c.real ? " (real trend)" : ""}"></i>`).join("");
        $q(root, '[data-el="read"]').innerHTML = `
          <div class="rcard"><div class="k">Cells flagged</div><div class="v">${d.flagged}</div></div>
          <div class="rcard"><div class="k">Real trends found</div><div class="v pass">${d.truePos}</div></div>
          <div class="rcard"><div class="k">Lucky false alarms</div><div class="v fail">${d.falseAlarms}</div><div class="s">${d.flagged ? Math.round((100 * d.falseAlarms) / d.flagged) : 0}% of flagged cells</div></div>
          <div class="rcard"><div class="k">Real but missed</div><div class="v">${d.missed}</div></div>`;
        $q(root, "#frV").textContent = st.real; $q(root, "#fr").value = st.real;
        const b = $q(root, '[data-act="fdr"]'); b.setAttribute("aria-pressed", st.correct); b.classList.toggle("on", st.correct); b.querySelector("b").textContent = st.correct ? "On" : "Off";
      };
      $q(root, "#fr").oninput = (e) => { st.real = +e.target.value; draw(); };
      $q(root, '[data-act="reroll"]').onclick = () => { st.seed = (st.seed * 7919 + 13) % 99991; draw(); };
      $q(root, '[data-act="fdr"]').onclick = () => { st.correct = !st.correct; draw(); };
      draw();
    };
    return { html, bind };
  },

  warn() {
    const html = `${head("Step 5 of 7", "The dryness thermometer", "The Hydro Stress Index blends three signals: 12-month rain (60%), 3-month rain (20%) and soil moisture (20%), each counted as how far from normal it is. Move the sliders, or try an example. These values are illustrative.")}
      <div class="lab"><div class="chips" role="group" aria-label="Examples">${WARN_PRESETS.map((p, i) => `<button class="chipbtn" data-wp="${i}">${p.label}</button>`).join("")}</div>
        <div class="thermo"><div class="tcol" data-el="thermo"></div>
          <div class="tright"><div class="readout one" data-el="read"></div>
            <div class="sliders one">${slider("w1", "12-month rainfall (60% of the index)", -3, 3, 0.1, 0)}${slider("w2", "3-month rainfall (20%)", -3, 3, 0.1, 0)}${slider("w3", "Soil moisture (20%)", -3, 3, 0.1, 0)}</div></div></div></div>
      ${notice(["Zero is normal. Each whole step is one 'standard deviation' from normal.", "Long rain shortfalls move the index most, because 12-month rain carries 60% of the weight.", "It describes conditions now. It does not forecast next season."])}`;
    const bind = (root) => {
      const v = [0, 0, 0], ids = ["w1", "w2", "w3"];
      const colors = { extreme: "#7f1d1d", severe: "#c2410c", moderate: "#f59e0b", watch: "#fde68a", normal: "#3b5b7d", wet: "#1d4ed8" };
      const draw = () => {
        const idx = blend(...v), cls = S.droughtClass(idx), key = cls.key, y = (z) => 8 + ((3 - Math.max(-3, Math.min(3, z))) / 6) * 224;
        const bands = [[3, 1, "wet"], [1, -0.5, "normal"], [-0.5, -1, "watch"], [-1, -1.5, "moderate"], [-1.5, -2, "severe"], [-2, -3, "extreme"]];
        $q(root, '[data-el="thermo"]').innerHTML = `<svg viewBox="0 0 150 240" role="img" aria-label="Thermometer: index ${fmt(idx, 2)}, ${cls.level}">
          ${bands.map(([a, b, k]) => `<rect x="14" y="${y(a)}" width="34" height="${y(b) - y(a)}" fill="${colors[k]}" opacity=".85"/>`).join("")}
          ${[2, 1, 0, -1, -2].map((t) => `<line class="gl" x1="14" x2="54" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="60" y="${y(t) + 4}">${t === 0 ? "0 (normal)" : fmt(t)}</text>`).join("")}
          <g style="transform:translateY(${y(idx)}px);transition:transform .25s"><path d="M4 0 L14 -6 L14 6 Z" fill="#fff"/><line x1="14" x2="48" y1="0" y2="0" stroke="#fff" stroke-width="2.5"/></g></svg>`;
        $q(root, '[data-el="read"]').innerHTML = `<div class="rcard big"><div class="k">Hydro Stress Index</div><div class="v">${fmt(idx, 2)}</div><div class="zone"><span class="badge ${key}">${cls.level}</span></div><p class="s">${ZONES[key]}</p></div>`;
        ids.forEach((id, i) => { $q(root, `#${id}`).value = v[i]; $q(root, `#${id}V`).textContent = fmt(v[i], 1); });
      };
      ids.forEach((id, i) => ($q(root, `#${id}`).oninput = (e) => { v[i] = +e.target.value; root.querySelectorAll("[data-wp]").forEach((b) => b.classList.remove("on")); draw(); }));
      root.querySelectorAll("[data-wp]").forEach((b) => (b.onclick = () => { WARN_PRESETS[+b.dataset.wp].v.forEach((z, i) => (v[i] = z)); root.querySelectorAll("[data-wp]").forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
      draw();
    };
    return { html, bind };
  },

  words() {
    const html = `${head("Step 6 of 7", "The jargon, in plain language", "Tap a word. Each one comes with an everyday comparison you can repeat to a friend.")}
      <div class="lab"><div class="chips" role="tablist">${TERMS.map((t, i) => `<button class="chipbtn${i ? "" : " on"}" role="tab" data-term="${i}" aria-selected="${i === 0}">${t[0]}</button>`).join("")}</div>
      <div class="gcard" data-el="term" aria-live="polite"></div></div>`;
    const bind = (root) => {
      const show = (i) => {
        root.querySelectorAll("[data-term]").forEach((b) => { const on = +b.dataset.term === i; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
        const [t, plain, like] = TERMS[i];
        $q(root, '[data-el="term"]').innerHTML = `<h4>${t}</h4><p>${plain}</p><div class="like">${icon("sparkles")}<span><b>Think of it like:</b> ${like}</span></div>`;
      };
      root.querySelectorAll("[data-term]").forEach((b) => (b.onclick = () => show(+b.dataset.term)));
      show(0);
    };
    return { html, bind };
  },

  go() {
    const html = `${head("Step 7 of 7", "Now investigate for yourself", "You have seen the whole method. Pick how you want to start.")}
      <div class="actions">
        <button class="acard primary" data-go="tour"><span class="ico">${icon("play")}</span><b>Take the 60-second Kariba tour</b><span>Rain, a step change, where it is happening, and the early-warning reading, in five steps.</span></button>
        <button class="acard" data-go="guide"><span class="ico">${icon("search")}</span><b>Guide me</b><span>Answer three questions and get suggested variables for your place.</span></button>
        <button class="acard" data-go="demos"><span class="ico">${icon("compass")}</span><b>Explore all demos</b><span>Itaipu, Sahel versus Amazon, Greenland and more.</span></button>
        <button class="acard" data-go="close"><span class="ico">${icon("droplet")}</span><b>Start analysing</b><span>Close this page and pick any place on the map.</span></button>
      </div>
      ${notice(["Install the app from your browser to use it like a phone app, even offline.", "Export any chart as a PNG, the data as CSV, or a one-page PDF report from the verdict card.", "Always read the Borderline label as 'be careful', not 'ignore'."])}`;
    const bind = (root, ctx) => root.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => ctx.act(b.dataset.go)));
    return { html, bind };
  },
};

/* ====================== shell ====================== */
export function initLearn(modal, actions = {}) {
  const stage = $q(modal, "#learnStage"), rail = $q(modal, "#learnSteps"), bar = $q(modal, "#learnBar"), count = $q(modal, "#learnCount");
  const back = $q(modal, "#learnBack"), next = $q(modal, "#learnNext");
  let cur = 0, seen = new Set([0]), leave = [];
  const ctx = { onLeave: (f) => leave.push(f), act: (a) => { close(); (actions[a] || (() => {}))(); } };

  rail.innerHTML = STEPS.map((s, i) => `<button class="lstep" data-step="${i}"><span class="n">${i + 1}</span><span>${s.title}</span></button>`).join("");
  const close = () => { modal.hidden = true; leave.forEach((f) => f()); leave = []; };

  function go(i) {
    leave.forEach((f) => f()); leave = [];
    cur = Math.max(0, Math.min(STEPS.length - 1, i)); seen.add(cur);
    const view = VIEWS[STEPS[cur].id]();
    stage.innerHTML = `<div class="view">${view.html}</div>`;
    hydrateIcons(stage);
    view.bind(stage, ctx);
    stage.scrollTop = 0;
    rail.querySelectorAll(".lstep").forEach((b, k) => { b.classList.toggle("on", k === cur); b.classList.toggle("done", k !== cur && seen.has(k)); b.setAttribute("aria-current", k === cur ? "step" : "false"); });
    const on = rail.querySelector(".lstep.on"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "center" });
    bar.style.width = `${((cur + 1) / STEPS.length) * 100}%`;
    count.textContent = `${cur + 1} / ${STEPS.length}`;
    back.disabled = cur === 0;
    next.innerHTML = cur === STEPS.length - 1 ? `Start analysing${icon("check", "after")}` : `Next${icon("chevron-right", "after")}`;
  }

  rail.onclick = (e) => { const b = e.target.closest("[data-step]"); if (b) go(+b.dataset.step); };
  back.onclick = () => go(cur - 1);
  next.onclick = () => (cur === STEPS.length - 1 ? ctx.act("close") : go(cur + 1));
  document.addEventListener("keydown", (e) => {
    if (modal.hidden || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
    if (e.key === "ArrowRight") go(cur + 1); else if (e.key === "ArrowLeft") go(cur - 1);
  });
  new MutationObserver(() => { if (modal.hidden) { leave.forEach((f) => f()); leave = []; } }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });

  return { open(step = 0) { modal.hidden = false; go(step); stage.focus({ preventScroll: true }); }, close };
}
