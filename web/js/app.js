import { VARIABLES, CATEGORIES, rawParams } from "./catalog.js";
import { SITES, SITE_TYPES, suggest } from "./sites.js";
import { analyse, droughtMonitor, narrate } from "./analysis.js";
import * as S from "./stats.js";
import { Pdf } from "./report.js";
import { icon, hydrateIcons } from "./icons.js";
import { initLearn } from "./learn.js";

const $ = (id) => document.getElementById(id);
const state = { siteId: "kariba", varId: "PRECTOTCORR", y0: 1981, y1: 2025, mode: "annual", alpha: 0.05 };
const cache = new Map();
let customSite = null;
let last = null; // last analysis result
let lastDrought = null;
const charts = {};

// ---------------- data ----------------
const allSites = () => (customSite ? [customSite, ...SITES] : SITES);
const getSite = (id) => allSites().find((s) => s.id === id);

async function fetchGrid(param, bbox) {
  const key = `${param}|${bbox.join(",")}`;
  if (!cache.has(key)) {
    cache.set(key, fetch(`/api/region?param=${param}&bbox=${bbox.join(",")}`).then(async (r) => {
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    }).catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key);
}

async function loadGrids(site, params) {
  const out = {};
  await Promise.all([...new Set(params)].map(async (p) => { out[p] = await fetchGrid(p, site.bbox); }));
  return out;
}

// ---------------- UI setup ----------------
function fillSelects() {
  const sel = $("site");
  sel.innerHTML = "";
  if (customSite) {
    const g = document.createElement("optgroup"); g.label = "Your region";
    g.append(new Option(customSite.name, customSite.id)); sel.append(g);
  }
  for (const [type, label] of Object.entries(SITE_TYPES)) {
    const g = document.createElement("optgroup"); g.label = label;
    SITES.filter((s) => s.type === type).forEach((s) => g.append(new Option(s.name, s.id)));
    sel.append(g);
  }
  sel.value = state.siteId;
  const vs = $("variable");
  vs.innerHTML = "";
  for (const [cat, label] of Object.entries(CATEGORIES)) {
    const g = document.createElement("optgroup"); g.label = label;
    Object.entries(VARIABLES).filter(([, v]) => v.category === cat).forEach(([id, v]) => g.append(new Option(v.name, id)));
    vs.append(g);
  }
  vs.value = state.varId;
}

function renderSiteNote() {
  const s = getSite(state.siteId), n = cellCount(s.bbox);
  $("siteNote").innerHTML = `${s.country ? `<b>${s.country}</b> · ` : ""}${s.note || ""}<br><small>Box: ${s.bbox[0]}° to ${s.bbox[1]}° lat, ${s.bbox[2]}° to ${s.bbox[3]}° lon</small>
    <br><b>≈ ${n} grid cells</b>${n > 200 ? " <small>(large region - first load may take longer)</small>" : ""}`;
}

// "Dirty" = inputs changed since the last analysis; nothing re-runs until the user presses Analyse.
function setDirty(v) {
  const b = $("btnRun");
  b.classList.toggle("dirty", v);
  b.innerHTML = v ? `${icon("play")}Analyse changes` : "Analyse trend";
  $("btnRunRail").classList.toggle("dirty", v);
}

function syncInputs() {
  $("site").value = state.siteId; $("variable").value = state.varId;
  $("y0").value = state.y0; $("y1").value = state.y1;
  $("mode").value = state.mode; $("alpha").value = String(state.alpha);
  const s = getSite(state.siteId), v = VARIABLES[state.varId];
  renderSiteNote(); updateObsUI();
  $("varDef").innerHTML = `<b>${v.name}</b> (${v.unit}) - ${v.definition}<div class="why">${icon("droplet")}${v.why}</div><small>Source: ${v.source}</small>`;
  drawRegion(s);
}

function readInputs() {
  state.siteId = $("site").value; state.varId = $("variable").value;
  state.y0 = Math.max(1981, Math.min(2024, +$("y0").value || 1981));
  state.y1 = Math.max(state.y0 + 1, Math.min(2025, +$("y1").value || 2025));
  state.mode = $("mode").value; state.alpha = +$("alpha").value;
}

function setStatus(html, kind = "") {
  const el = $("status");
  el.hidden = !html; el.className = `status ${kind}`; el.innerHTML = html || "";
}

// ---------------- map ----------------
const map = L.map("map", { worldCopyJump: true }).setView([-14, 24], 4);
// Basemap with fallback chain: Esri dark -> OpenStreetMap (darkened by CSS) -> plain background.
const ESRI = [
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors", maxZoom: 10,
  }),
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 10, pane: "shadowPane" }),
];
const OSM = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors", maxZoom: 10 });
let baseState = "esri", tileErrors = 0;
function onTileError(which) {
  if (which !== baseState || ++tileErrors < 4) return;
  tileErrors = 0;
  if (which === "esri") { ESRI.forEach((l) => map.removeLayer(l)); OSM.addTo(map); map.getContainer().classList.add("fallback-osm"); baseState = "osm"; }
  else { map.removeLayer(OSM); map.getContainer().classList.remove("fallback-osm"); baseState = "none"; }
  updateMapSummary();
}
ESRI.forEach((l) => l.addTo(map).on("tileerror", () => onTileError("esri")));
OSM.on("tileerror", () => onTileError("osm"));

function updateMapSummary() {
  if (!last) { $("mapSummary").innerHTML = ""; return; }
  const note = baseState === "osm" ? "<br><span class='warn'>backup basemap (Esri unreachable)</span>" : baseState === "none" ? "<br><span class='warn'>basemap unavailable - grid only</span>" : "";
  $("mapSummary").innerHTML = `<b>${last.meta.name}</b><br>${last.y0}–${last.y1} · ${last.mode === "annual" ? "yearly" : "monthly anomalies"}${note}`;
}
let regionLayer = L.layerGroup().addTo(map);
let cellLayer = L.layerGroup().addTo(map);

let regionRect = null, handles = [];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// MERRA-2 grid is 0.5° lat × 0.625° lon; the server accepts boxes 2°–10° per side.
const cellCount = (b) => Math.max(1, Math.round((b[1] - b[0]) / 0.5)) * Math.max(1, Math.round((b[3] - b[2]) / 0.625));

function describeCustom(s) {
  const [a, b, c, d] = s.bbox;
  s.name = `Custom region (${((a + b) / 2).toFixed(1)}°, ${((c + d) / 2).toFixed(1)}°)`;
  s.note = `A ${(b - a).toFixed(1)}° × ${(d - c).toFixed(1)}° box. Drag the corner handles on the map to resize it.`;
}

function addHandles(s) {
  [[0, 0], [0, 1], [1, 0], [1, 1]].forEach(([la, lo]) => {
    const m = L.marker([s.bbox[la], s.bbox[2 + lo]], { draggable: true, zIndexOffset: 1000, title: "Drag to resize",
      icon: L.divIcon({ className: "handle", iconSize: [22, 22] }) }).addTo(regionLayer);
    m.on("drag", () => {
      const bb = s.bbox, ll = m.getLatLng();
      const lat = la ? clamp(ll.lat, bb[0] + 2, Math.min(90, bb[0] + 10)) : clamp(ll.lat, Math.max(-90, bb[1] - 10), bb[1] - 2);
      const lon = lo ? clamp(ll.lng, bb[2] + 2, bb[2] + 10) : clamp(ll.lng, bb[3] - 10, bb[3] - 2);
      bb[la] = +lat.toFixed(2); bb[2 + lo] = +lon.toFixed(2);
      regionRect.setBounds([[bb[0], bb[2]], [bb[1], bb[3]]]);
      handles.forEach(([h, a, b]) => h.setLatLng([bb[a], bb[2 + b]]));
      renderSiteNote();
    });
    m.on("dragend", () => { describeCustom(s); fillSelects(); renderSiteNote(); setDirty(true); });
    handles.push([m, la, lo]);
  });
}

function drawRegion(s) {
  regionLayer.clearLayers(); handles = [];
  const b = [[s.bbox[0], s.bbox[2]], [s.bbox[1], s.bbox[3]]];
  regionRect = L.rectangle(b, { color: "#2ec4b6", weight: 2, fill: false, dashArray: "6 4" }).addTo(regionLayer);
  if (s.dam) L.circleMarker(s.dam, { radius: 7, color: "#fff", fillColor: "#3a86ff", fillOpacity: 1, weight: 2 })
    .bindTooltip(`${s.name.split(" - ")[0]} (${s.capacityMW} MW)`).addTo(regionLayer);
  if (s.id === "custom") addHandles(s);
  map.invalidateSize();
  map.fitBounds((s.dam ? L.latLngBounds(b).extend(s.dam) : L.latLngBounds(b)).pad(0.18), { animate: false });
}

function makeCustomBox(lat, lon, size) {
  const h = size / 2;
  customSite = { id: "custom", type: "custom", bbox: [+Math.max(-90, lat - h).toFixed(2), +Math.min(90, lat + h).toFixed(2), +(lon - h).toFixed(2), +(lon + h).toFixed(2)] };
  describeCustom(customSite);
  state.siteId = "custom"; fillSelects(); syncInputs(); setDirty(true);
}

// Clicking the map places a box; the user can resize it and press Analyse (no automatic run).
map.on("click", (e) => {
  if (tour.active) return;
  const lat = +e.latlng.lat.toFixed(2), lon = +(((e.latlng.lng + 180) % 360 + 360) % 360 - 180).toFixed(2);
  makeCustomBox(lat, lon, +$("boxSize").value);
  setCollapsed(false);
});

function divColor(t, wetter) {
  // t in [-1, 1]; wetter vars: brown->grey->blue, others: blue->grey->red
  const neg = wetter ? [166, 97, 26] : [44, 123, 182];
  const pos = wetter ? [43, 131, 186] : [215, 25, 28];
  const mid = [200, 200, 200];
  const c = t < 0 ? neg : pos, a = Math.min(1, Math.abs(t));
  const rgb = mid.map((m, i) => Math.round(m + (c[i] - m) * a));
  return `rgb(${rgb.join(",")})`;
}

function renderMap(r) {
  cellLayer.clearLayers();
  const cells = r.cellTrends.filter((c) => Number.isFinite(c.perDecade));
  if (!cells.length) return;
  const uniq = (a) => [...new Set(a)].sort((x, y) => x - y);
  const step = (a) => { const u = uniq(a); let d = Infinity; for (let i = 1; i < u.length; i++) d = Math.min(d, u[i] - u[i - 1]); return Number.isFinite(d) ? d : 0.5; };
  const dLat = step(cells.map((c) => c.lat)), dLon = step(cells.map((c) => c.lon));
  const vmax = Math.max(...cells.map((c) => Math.abs(c.perDecade))) || 1;
  const unit = r.mode === "annual" ? r.meta.annualUnit : r.meta.unit;
  const onlySig = $("onlySig").checked, strict = $("fdrOnly").checked;
  for (const c of cells) {
    const sig = strict ? c.fdr : c.significant;     // strict = survives the false-discovery-rate check
    if (onlySig && !sig) continue;
    const col = divColor(c.perDecade / vmax, r.meta.wetter);
    const base = { color: sig ? "#ffffff" : col, weight: sig ? 1 : 0, opacity: 0.9, fillColor: col, fillOpacity: sig ? 0.85 : 0.3 };
    const rect = L.rectangle([[c.lat - dLat / 2, c.lon - dLon / 2], [c.lat + dLat / 2, c.lon + dLon / 2]], base);
    rect.on("mouseover", () => rect.setStyle({ color: "#ffffff", weight: 2.5, opacity: 1, fillOpacity: 1 }).bringToFront());
    rect.on("mouseout", () => rect.setStyle(base));
    rect.bindTooltip(`${c.lat.toFixed(2)}°, ${c.lon.toFixed(2)}°<br><b>${c.perDecade > 0 ? "+" : ""}${c.perDecade.toFixed(r.meta.decimals)} ${unit}/decade</b>` +
      (Number.isFinite(c.pctPerDecade) ? ` (${c.pctPerDecade > 0 ? "+" : ""}${c.pctPerDecade.toFixed(1)}%)` : "") +
      `<br>t-test p = ${c.p.toFixed(3)} · MK p = ${c.mkp.toFixed(3)}<br>${sig ? "significant" : "not significant"}${strict ? " (FDR-corrected)" : c.significant ? (c.fdr ? " · survives FDR check" : " · does not survive FDR check") : ""}`);
    rect.addTo(cellLayer);
  }
  const lo = divColor(-1, r.meta.wetter), hi = divColor(1, r.meta.wetter);
  $("legend").innerHTML = `<span class="dir">${icon("arrow-down")}−${vmax.toFixed(r.meta.decimals)}</span><span class="bar" style="background:linear-gradient(90deg,${lo},rgb(200,200,200),${hi})"></span><span class="dir">${icon("arrow-up")}+${vmax.toFixed(r.meta.decimals)}</span><span>${unit}/decade</span>
    <span>· outlined = significant (${r.alpha * 100}%${strict ? ", FDR-corrected" : ""})</span>`;
  updateMapSummary();
}

// ---------------- rendering ----------------
const fmt = (v, d = 2) => (Number.isFinite(v) ? (Math.abs(v) > 0 && Math.abs(v) < 10 ** -d ? v.toExponential(1) : v.toFixed(d)) : "–");
const fmtP = (p) => (p < 0.001 ? "< 0.001" : fmt(p, 3));

function renderTiles(r) {
  $("tiles").innerHTML = tileData(r).map(([k, v, s, help, tech]) =>
    `<div class="tile" tabindex="0" title="${(help || "").replace(/"/g, "&quot;")}"><div class="k">${k}${tech ? ` <span class="t">(${tech})</span>` : ""}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");
}

function tileData(r) {
  const d = r.meta.decimals, u = r.mode === "annual" ? r.meta.annualUnit : r.meta.unit;
  const tile = (k, v, s, help, tech) => [k, v, s, help, tech];
  const verdict = (ok) => (ok ? '<span class="pass">Passes</span>' : '<span class="fail">Fails</span>');
  const need = (p) => `p = ${fmtP(p)}, needs below ${r.alpha}`;
  return [
    tile("Change per decade", `${r.lin.slope > 0 ? "+" : ""}${fmt(r.lin.slope * 10, d)}`, `${u} per decade`,
      "How much the average moved over ten years, from a straight line through the data.", "trend"),
    tile("Likely range", `${fmt(r.lin.ci[0] * 10, d)} … ${fmt(r.lin.ci[1] * 10, d)}`, `${u} per decade, 95% sure`,
      "The true change is probably inside this range. If the range includes zero, no change at all is still possible.", "95% CI"),
    tile("Test 1: steady trend", verdict(r.lin.significant), need(r.lin.p),
      "t-test. Passes when a change this steady would happen less than 5% of the time by chance. It also allows for wet months following wet months.", "t-test"),
    tile("Test 2: ups vs downs", verdict(r.mk.significant), need(r.mk.p),
      "Counts how often a later year is higher or lower than an earlier one. A few extreme years cannot fool it.", r.mode === "annual" ? "Mann-Kendall" : "Seasonal Kendall"),
    tile("Typical change", `${r.mk.senSlope > 0 ? "+" : ""}${fmt(r.mk.senSlope * 10, d)}`, `${u} per decade, ignores extremes`,
      "The typical change per decade, calculated so that unusually wet or dry years cannot bend it.", "Sen's slope"),
    tile("Share of average", Number.isFinite(r.summary.pctPerDecade) ? `${r.summary.pctPerDecade > 0 ? "+" : ""}${r.summary.pctPerDecade.toFixed(1)}%` : "–", `per decade, of the ${r.y0}–${r.y1} average`,
      "The change per decade as a percentage of the long-term average.", "% per decade"),
  ];
}

function renderHeadline(r) {
  const n = (r.lin.significant ? 1 : 0) + (r.mk.significant ? 1 : 0);
  const [cls, word] = [["ns", "Not significant"], ["mixed", "Borderline"], ["sig", "Significant"]][n];
  const d = r.meta.decimals, u = r.mode === "annual" ? r.meta.annualUnit : r.meta.unit;
  $("headline").hidden = false;
  $("headline").innerHTML = `<span class="tag ${cls}">${word}</span><span class="big">${r.lin.slope > 0 ? "+" : ""}${fmt(r.lin.slope * 10, d)} <small>${u}/decade</small></span>
    <span class="sub">${r.meta.name} · ${r.y0}–${r.y1}${Number.isFinite(r.summary.pctPerDecade) ? ` · ${r.summary.pctPerDecade > 0 ? "+" : ""}${r.summary.pctPerDecade.toFixed(1)}% per decade` : ""}</span>`;
  $("whySum").textContent = `Why ${word.toLowerCase()}?`;
  $("plainVerdict").hidden = false;
  $("plainVerdict").innerHTML = plainVerdict(r, n);
}

// One everyday sentence a non-scientist can read and repeat.
function plainVerdict(r, n) {
  const d = r.meta.decimals, u = r.mode === "annual" ? r.meta.annualUnit : r.meta.unit;
  const place = getSite(state.siteId).name.split(" - ")[0], up = r.lin.slope > 0;
  const amt = `${fmt(Math.abs(r.lin.slope * 10), d)} ${u} per decade${Number.isFinite(r.summary.pctPerDecade) ? ` (${Math.abs(r.summary.pctPerDecade).toFixed(1)}%)` : ""}`;
  const lead = `<b>In plain words:</b> ${r.meta.name} at ${place}`;
  if (n === 2) return `${lead} has ${up ? "risen" : "fallen"} by about ${amt}. Both of our tests agree, so this is very unlikely to be luck.`;
  if (n === 1) return `${lead} has probably ${up ? "risen" : "fallen"} by about ${amt}, but only one of our two tests is convinced, so treat it with caution.`;
  return `${lead} shows a slight ${up ? "rise" : "fall"} of about ${amt}, but that is small compared with normal ups and downs, so it could just be luck.`;
}

function setCollapsed(c) {
  const s = getSite(state.siteId), v = VARIABLES[state.varId];
  document.querySelector(".controls").classList.toggle("collapsed", c);
  $("casePill").hidden = !c;
  $("casePill").innerHTML = `${icon("pin")}${s.name.split(" - ")[0]} · ${icon("droplet")}${v.name} · ${state.y0}–${state.y1} · ${state.mode === "annual" ? "Yearly" : "Monthly anomalies"}`;
  $("btnEdit").hidden = false;
  $("btnEdit").innerHTML = c ? `${icon("edit")}Edit` : `${icon("chevron-up")}Hide`; $("btnEdit").setAttribute("aria-expanded", String(!c));
  setTimeout(() => map.invalidateSize(), 50);
}

function chart(id, cfg) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id), cfg);
}
Chart.defaults.color = "#8ea6c0";
Chart.defaults.borderColor = "rgba(31,58,89,.6)";
Chart.defaults.font.family = "system-ui, sans-serif";

// ---------------- observation overlays (optional; the server needs an Earthdata login, see earthobs.py) ----------------
// soil moisture -> SMAP (right axis, different units); rainfall -> GPM IMERG (same axis as MERRA-2, mm/yr).
const OBS = {
  smap: { api: "/api/smap", box: "showSmap", wrap: "smapWrap", vars: ["GWETTOP", "GWETROOT"], label: "SMAP", sameAxis: false, axisTitle: "SMAP (m³/m³)", unit: "m³/m³", annual: "mean", minMonths: 9, note: "Only about a decade of SMAP exists, so treat this as a sanity check, not a trend test." },
  imerg: { api: "/api/imerg", box: "showImerg", wrap: "imergWrap", vars: ["PRECTOTCORR"], label: "GPM IMERG", sameAxis: true, unit: "mm/yr", annual: "sum", minMonths: 12, note: "MERRA-2 rainfall is bias-corrected with satellite and gauge data, so the two are not fully independent." },
};
const obsData = { smap: { key: null, data: null, timer: null }, imerg: { key: null, data: null, timer: null } };
const activeObs = () => Object.keys(OBS).find((k) => OBS[k].vars.includes(state.varId)) || null;
const bboxKey = () => getSite(state.siteId).bbox.join(",");
let obsNoteFor = null; // which layer the visible note describes, so a stale note never outlives a variable change
function setObsNote(html, kind = "") { const el = $("obsNote"); el.hidden = !html; el.className = `fine obsnote ${kind}`; el.innerHTML = html || ""; }
function updateObsUI() {
  for (const c of Object.values(OBS)) $(c.wrap).hidden = !c.vars.includes(state.varId);
  if (!activeObs()) Object.values(obsData).forEach((o) => clearTimeout(o.timer));
  if (obsNoteFor !== activeObs()) { setObsNote(""); obsNoteFor = null; }
}

async function loadObs(k) {
  const c = OBS[k], st = obsData[k];
  clearTimeout(st.timer);
  if (!$(c.box).checked || activeObs() !== k) return;
  obsNoteFor = k;
  const key = bboxKey();
  if (st.key === key && st.data) { last && renderTS(last); return; }
  st.key = null; st.data = null;
  setObsNote(`<span class="spinner"></span>Contacting NASA for ${c.label} data…`);
  try {
    const res = await fetch(`${c.api}?bbox=${key}`), j = await res.json();
    if (res.status === 200) { st.key = key; st.data = j; last && renderTS(last); }
    else if (res.status === 202) {
      setObsNote(`<span class="spinner"></span>Fetching ${c.label} from NASA: step ${j.done} of ${j.total}. First time for this region only; it can take several minutes.`);
      st.timer = setTimeout(() => loadObs(k), 4000);
    } else throw new Error(j.error || `HTTP ${res.status}`);
  } catch (e) {
    setObsNote(`${icon("alert")}${e.message}`, "error");
    $(c.box).checked = false; last && renderTS(last);
  }
}

// Yearly values from the monthly observation series (a year needs minMonths valid months); annual mode only.
function obsYearly(k, r) {
  const c = OBS[k], st = obsData[k];
  if (!$(c.box).checked || activeObs() !== k || r.mode !== "annual" || !st.data || st.key !== bboxKey()) return null;
  const by = {};
  st.data.times.forEach((t, i) => { const v = st.data.values[i]; if (v != null) (by[+t.slice(0, 4)] ||= []).push(v); });
  const pts = Object.entries(by).filter(([y, a]) => a.length >= c.minMonths && +y >= r.y0 && +y <= r.y1)
    .map(([y, a]) => ({ x: +y, y: c.annual === "sum" ? a.reduce((s, v) => s + v, 0) : S.mean(a) }));
  return pts.length >= 2 ? pts : null;
}

function updateObsAgreement(k, r, pts) {
  if (!k) return;
  const c = OBS[k];
  if (!$(c.box).checked || !obsData[k].data) return; // loading / error notes are set by loadObs
  obsNoteFor = k;
  if (r.mode !== "annual") return setObsNote(`${icon("alert")}The ${c.label} overlay is drawn in "Yearly values" mode.`);
  if (!pts) return setObsNote(`${icon("alert")}${c.label} has no complete years inside ${r.y0}–${r.y1}.`);
  const model = new Map(r.x.map((x, i) => [Math.round(x), r.y[i]]));
  const pairs = pts.map((p) => [model.get(p.x), p.y, p.x]).filter(([a]) => Number.isFinite(a));
  const y0 = pts[0].x, y1 = pts[pts.length - 1].x;
  let txt = `<b>${c.label}</b> (observed, ${y0}–${y1}${c.sameAxis ? "" : ", right axis in " + c.unit}) vs <b>MERRA-2</b> (modelled). `;
  if (pairs.length >= 4) {
    const ma = S.mean(pairs.map((p) => p[0])), mb = S.mean(pairs.map((p) => p[1]));
    const num = pairs.reduce((s, [a, b]) => s + (a - ma) * (b - mb), 0);
    const den = Math.sqrt(pairs.reduce((s, [a]) => s + (a - ma) ** 2, 0) * pairs.reduce((s, [, b]) => s + (b - mb) ** 2, 0));
    if (den) txt += `Year-to-year agreement r = <b>${(num / den).toFixed(2)}</b> over ${pairs.length} years. `;
  }
  if (c.sameAxis && pairs.length >= 8) {   // same units: compare the trends themselves over the shared years
    const xs = pairs.map((p) => p[2]);
    const tm = S.linearTrend(xs, pairs.map((p) => p[0]), { alpha: r.alpha }), to = S.linearTrend(xs, pairs.map((p) => p[1]), { alpha: r.alpha });
    const f = (t) => `${t.slope > 0 ? "+" : ""}${(t.slope * 10).toFixed(r.meta.decimals)} ${c.unit}/decade (${t.significant ? "significant" : "not significant"})`;
    txt += `Over ${xs[0]}–${xs[xs.length - 1]}: MERRA-2 ${f(tm)}; ${c.label} ${f(to)}. <b>${Math.sign(tm.slope) === Math.sign(to.slope) ? "Same direction." : "Opposite directions - treat the trend with caution."}</b> `;
  }
  setObsNote(txt + c.note);
}

function renderTS(r) {
  const u = r.mode === "annual" ? r.meta.annualUnit : r.meta.unit;
  const pts = r.x.map((x, i) => ({ x, y: r.y[i] })).filter((p) => Number.isFinite(p.y));
  const x0 = pts[0].x, x1 = pts[pts.length - 1].x;
  const line = (b, a) => [{ x: x0, y: a + b * x0 }, { x: x1, y: a + b * x1 }];
  const xm = S.mean(pts.map((p) => p.x)), ym = S.mean(pts.map((p) => p.y));
  const ds = [];
  if (r.mode === "anomaly") {
    const rm = r.y.map((_, i) => { if (i < 11) return NaN; const w = r.y.slice(i - 11, i + 1); return w.every(Number.isFinite) ? S.mean(w) : NaN; });
    ds.push({ label: "Monthly anomaly", data: pts, showLine: true, borderColor: "rgba(142,166,192,.35)", borderWidth: 1, pointRadius: 0 });
    ds.push({ label: "12-month running mean", data: r.x.map((x, i) => ({ x: x - 5.5 / 12, y: rm[i] })).filter((p) => Number.isFinite(p.y)), showLine: true, borderColor: "#3a86ff", borderWidth: 2, pointRadius: 0 });
  } else {
    ds.push({ label: `Yearly ${r.meta.annual === "sum" ? "total" : "mean"}`, data: pts, showLine: true, borderColor: "#3a86ff", backgroundColor: "#3a86ff", borderWidth: 1.5, pointRadius: 3 });
  }
  if ($("showCI").checked) {
    const lo = [r.lin.ci[0], r.lin.ci[1]].sort((a, b) => a - b);
    const band = (b) => [{ x: x0, y: ym + b * (x0 - xm) }, { x: x1, y: ym + b * (x1 - xm) }];
    ds.push({ label: "95% slope range", data: band(lo[0]), showLine: true, borderColor: "rgba(46,196,182,.0)", pointRadius: 0, fill: false });
    ds.push({ label: "95% slope range ", data: band(lo[1]), showLine: true, borderColor: "rgba(46,196,182,.0)", backgroundColor: "rgba(46,196,182,.15)", pointRadius: 0, fill: "-1" });
  }
  ds.push({ label: `Linear trend (${r.lin.slope > 0 ? "+" : ""}${fmt(r.lin.slope * 10, r.meta.decimals)}/decade)`, data: line(r.lin.slope, r.lin.intercept), showLine: true, borderColor: "#2ec4b6", borderWidth: 3, pointRadius: 0 });
  if ($("showSen").checked)
    ds.push({ label: "Sen's slope", data: line(r.mk.senSlope, r.mode === "annual" ? r.mk.senIntercept : S.median(pts.map((p) => p.y - r.mk.senSlope * p.x))), showLine: true, borderColor: "#f4a259", borderDash: [6, 4], borderWidth: 2, pointRadius: 0 });
  if ($("showChange").checked && r.change && r.change.significant) {   // Pettitt step change as a vertical marker
    const ys = pts.map((p) => p.y), cx = r.mode === "annual" ? r.change.year - 0.5 : r.change.year;
    ds.push({ label: `Step change ${r.change.year}`, data: [{ x: cx, y: Math.min(...ys) }, { x: cx, y: Math.max(...ys) }], showLine: true, borderColor: "#c77dff", borderDash: [2, 4], borderWidth: 2, pointRadius: 0 });
  }
  const ok = activeObs(), cfg = ok && OBS[ok], ob = ok && obsYearly(ok, r);
  if (ob) ds.push({ label: `${cfg.label} (observed${cfg.sameAxis ? "" : ", right axis"})`, data: ob, yAxisID: cfg.sameAxis ? "y" : "y2", showLine: true, borderColor: "#f4a259", backgroundColor: "#f4a259", pointStyle: "triangle", pointRadius: 5, borderWidth: 2 });
  updateObsAgreement(ok, r, ob);
  $("tsHow").textContent = r.mode === "annual"
    ? "Each dot is one year. The teal line is the trend. The shaded band shows how uncertain that trend is."
    : "The grey line is each month compared with what is normal for that month. The blue line is its 12-month average. The teal line is the trend.";
  $("tsTitle").textContent = `${r.meta.name} - ${r.mode === "annual" ? "yearly values" : "monthly anomalies (seasonal cycle removed)"} · ${getSite(state.siteId).name}`;
  chart("tsChart", {
    type: "scatter", data: { datasets: ds },
    options: {
      maintainAspectRatio: false, animation: { duration: 400 },
      scales: { x: { type: "linear", ticks: { callback: (v) => Math.round(v) }, title: { display: true, text: "Year" } },
        y: { title: { display: true, text: u } },
        ...(ob && !cfg.sameAxis ? { y2: { position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: cfg.axisTitle } } } : {}) },
      plugins: { legend: { labels: { filter: (i) => i.text !== "95% slope range ", boxWidth: 12 } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y, r.meta.decimals)} ${u} (${c.parsed.x.toFixed(1)})` } } },
    },
  });
}

function renderSeason(r) {
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // split into first and second half of the record to show seasonal shifts
  const mid = Math.floor((r.y0 + r.y1) / 2);
  const c1 = S.climatology(r.times, r.regional, r.y0, mid), c2 = S.climatology(r.times, r.regional, mid + 1, r.y1);
  chart("seasonChart", {
    type: "bar",
    data: { labels: M, datasets: [
      { label: `${r.y0}–${mid}`, data: c1.slice(1), backgroundColor: "rgba(142,166,192,.55)" },
      { label: `${mid + 1}–${r.y1}`, data: c2.slice(1), backgroundColor: "#2ec4b6" },
    ] },
    options: { maintainAspectRatio: false, scales: { y: { title: { display: true, text: r.meta.unit } } }, plugins: { legend: { labels: { boxWidth: 12 } } } },
  });
}

function renderDrought(d) {
  if (!d) { $("droughtPanel").hidden = true; return; }
  $("droughtPanel").hidden = false;
  const col = (v) => (!Number.isFinite(v) ? "#555" : v <= -2 ? "#7f1d1d" : v <= -1.5 ? "#c2410c" : v <= -1 ? "#f59e0b" : v <= -0.5 ? "#fde68a" : v >= 1 ? "#1d4ed8" : "#3b5b7d");
  chart("droughtChart", {
    type: "bar",
    data: { labels: d.times.map((t) => `${t.year}-${String(t.month).padStart(2, "0")}`), datasets: [
      { label: "Hydro Stress Index", data: d.hsi, backgroundColor: d.hsi.map(col), barPercentage: 1, categoryPercentage: 1 },
    ] },
    options: { maintainAspectRatio: false, animation: false,
      scales: { x: { ticks: { maxTicksLimit: 10, callback: function (v) { return this.getLabelForValue(v).slice(0, 4); } } }, y: { suggestedMin: -3, suggestedMax: 3, title: { display: true, text: "σ (std. dev.)" } } },
      plugins: { legend: { display: false } } },
  });
  const b = $("droughtBadge");
  if (d.latest) { b.className = `badge ${d.latest.cls.key}`; b.textContent = `${d.latest.label}: ${d.latest.cls.level} (${d.latest.value.toFixed(2)})`; }
  const tr = d.hsiTrend;
  const sevCls = (p) => (p <= -2 ? "extreme" : p <= -1.5 ? "severe" : p <= -1 ? "moderate" : "mild");
  const sevName = (p) => ({ extreme: "Extreme", severe: "Severe", moderate: "Moderate", mild: "Mild" })[sevCls(p)];
  const maxMo = Math.max(1, ...d.episodes.map((e) => e.months));
  $("droughtInfo").innerHTML = `Index = 60% SPI-12 + 20% SPI-3 + 20% root-zone soil moisture anomaly, regional mean. Below −1 = inflow risk for hydropower.
    ${tr ? `Long-term drift of the index: ${tr.slope > 0 ? "+" : ""}${(tr.slope * 10).toFixed(2)} σ/decade (p ${fmtP(tr.p)}).` : ""}
    <table><tr><th>Worst droughts</th><th>Peak</th><th>Duration</th></tr>${d.episodes.map((e) => `<tr><td>${e.from} → ${e.to}</td><td><span class="sev ${sevCls(e.peak)}">${sevName(e.peak)} ${e.peak.toFixed(2)}</span> <small>${e.peakAt}</small></td><td><div class="dur"><i style="width:${Math.max(3, Math.round(e.months / maxMo * 90))}px"></i>${e.months} mo</div></td></tr>`).join("")}</table>`;
}

// ---------------- run ----------------
async function run() {
  readInputs(); syncInputs();
  const site = getSite(state.siteId);
  const params = [...rawParams(state.varId), "PRECTOTCORR", "GWETROOT"];
  $("btnRun").disabled = $("btnRunRail").disabled = true;
  setStatus(`<span class="spinner"></span>Fetching NASA data for ${site.name}… (first time per region can take ~10 s; then it's cached)`);
  try {
    const grids = await loadGrids(site, params);
    last = analyse(state.varId, grids, { y0: state.y0, y1: state.y1, mode: state.mode, alpha: state.alpha });
    lastDrought = droughtMonitor(grids, { y0: state.y0, y1: state.y1 });
    $("verdict").innerHTML = narrate(last, site.name);
    renderHeadline(last);
    renderTiles(last); renderTS(last); renderSeason(last); renderMap(last); renderDrought(lastDrought);
    setStatus(""); setDirty(false); $("btnPdf").disabled = false;
    describeForAT(last, lastDrought, site);
    if (activeObs()) loadObs(activeObs());
    return last;
  } catch (e) {
    setStatus(`${icon("alert")}Could not load the data: ${e.message}. Check that the HydroWatch server is running and that you are online. <button class="btn small" id="retryBtn">Try again</button>`, "error");
    const retry = $("retryBtn"); if (retry) retry.onclick = () => run().catch(() => {});
    throw e;
  } finally { $("btnRun").disabled = $("btnRunRail").disabled = false; }
}

function saveBlob(blob, name) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Chart canvases are transparent; paint the panel colour behind them so exports are readable.
function chartCanvas(id) {
  const src = $(id), c = document.createElement("canvas");
  c.width = src.width; c.height = src.height;
  const x = c.getContext("2d"); x.fillStyle = "#0d1d30"; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0);
  return c;
}

function downloadPng(id) {
  if (!charts[id]) return;
  chartCanvas(id).toBlob((b) => saveBlob(b, `hydrowatch_${state.siteId}_${state.varId}_${id}.png`), "image/png");
}

// Text alternatives for the canvas charts and the map (screen readers).
function describeForAT(r, d, site) {
  const n = (r.lin.significant ? 1 : 0) + (r.mk.significant ? 1 : 0), word = ["not significant", "borderline", "significant"][n];
  const u = r.mode === "annual" ? r.meta.annualUnit : r.meta.unit;
  const trend = `${r.meta.name} over ${site.name}, ${r.y0} to ${r.y1}: ${r.lin.slope > 0 ? "rising" : "falling"} by ${fmt(Math.abs(r.lin.slope) * 10, r.meta.decimals)} ${u} per decade, ${word}.`;
  const set = (id, t) => { const el = $(id); el.setAttribute("role", "img"); el.setAttribute("aria-label", t); };
  set("tsChart", `Time series chart. ${trend}`);
  set("seasonChart", `Bar chart of the average monthly cycle for the first and second half of the record.`);
  set("droughtChart", d && d.latest ? `Hydro-drought index chart. Latest status: ${d.latest.cls.level}, ${d.latest.value.toFixed(2)}.` : "Hydro-drought index chart.");
  $("map").setAttribute("aria-label", `Map of per-grid-cell trends. ${r.cellStats.up} cells significantly rising, ${r.cellStats.down} significantly falling, of ${r.cellStats.n}.`);
}

function exportPdf() {
  if (!last) return;
  const r = last, site = getSite(state.siteId), d = r.meta.decimals, u = r.mode === "annual" ? r.meta.annualUnit : r.meta.unit;
  const W = 842, M = 30, pdf = new Pdf(W, 595);
  const n = (r.lin.significant ? 1 : 0) + (r.mk.significant ? 1 : 0);
  const [word, col] = [["Not significant", "#7d8fa5"], ["Borderline", "#f4a259"], ["Significant", "#2ec4b6"]][n];
  pdf.rect(0, 0, W, 595, "#07121f");
  pdf.text(M, 22, "HYDROWATCH GLOBAL  |  EARTH SYSTEM TREND DETECTIVE", 8, "#2ec4b6", true);
  pdf.text(M, 36, `${r.meta.name} - ${site.name}`.slice(0, 80), 17, "#e6eef7", true);
  pdf.text(M, 60, `${r.y0}-${r.y1}  |  ${r.mode === "annual" ? "yearly values" : "monthly anomalies"}  |  significance level ${r.alpha * 100}%  |  box ${site.bbox.join(", ")}`, 8.5, "#8ea6c0");
  const bw = word.length * 7 + 18;
  pdf.rect(M, 76, bw, 20, col); pdf.text(M + 9, 80, word, 10, "#04221f", true);
  pdf.text(M + bw + 14, 74, `${r.lin.slope > 0 ? "+" : ""}${fmt(r.lin.slope * 10, d)} ${u} per decade`, 20, "#e6eef7", true);
  if (Number.isFinite(r.summary.pctPerDecade)) pdf.text(W - M - 130, 80, `${r.summary.pctPerDecade > 0 ? "+" : ""}${r.summary.pctPerDecade.toFixed(1)}% of average / decade`, 9, "#8ea6c0");

  const tiles = tileData(r), tw = (W - 2 * M - 5 * 8) / 6;
  tiles.forEach(([k, v, s], i) => {
    const x = M + i * (tw + 8);
    pdf.rect(x, 108, tw, 46, "#12273f");
    pdf.text(x + 6, 112, k.toUpperCase(), 6.5, "#8ea6c0");
    pdf.text(x + 6, 123, String(v).replace(/<[^>]+>/g, ""), 11.5, "#e6eef7", true);
    pdf.paragraph(x + 6, 140, tw - 10, String(s), 6, "#8ea6c0", 1.25, 2);
  });

  const panel = (x, y, w, h, title, id) => {
    pdf.rect(x, y, w, h, "#0d1d30"); pdf.text(x + 8, y + 6, title, 8, "#2ec4b6", true);
    if (!charts[id]) return;
    const c = chartCanvas(id);
    pdf.image(c.toDataURL("image/jpeg", 0.92), c.width, c.height, x + 4, y + 20, w - 8, h - 24);
  };
  panel(M, 164, 490, 226, "TIME SERIES", "tsChart");
  panel(M + 500, 164, W - 2 * M - 500, 108, "SEASONAL CYCLE (first vs second half of record)", "seasonChart");
  panel(M + 500, 282, W - 2 * M - 500, 108, "HYDRO-DROUGHT EARLY WARNING INDEX", "droughtChart");

  const plain = narrate(r, site.name).replace(/<br>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const dr = lastDrought && lastDrought.latest ? `\nHydro-drought status: ${lastDrought.latest.cls.level} (index ${lastDrought.latest.value.toFixed(2)}, ${lastDrought.latest.label}).${lastDrought.episodes[0] ? ` Worst episode peaked at ${lastDrought.episodes[0].peak.toFixed(2)} sigma in ${lastDrought.episodes[0].peakAt}.` : ""}` : "";
  pdf.text(M, 400, "WHAT THE DATA SAY", 8, "#2ec4b6", true);
  pdf.paragraph(M, 414, W - 2 * M, plain + dr, 8.5, "#c8d7e8", 1.35, 10);
  pdf.text(M, 566, `Data: NASA POWER monthly (MERRA-2 reanalysis), ${r.y0}-${r.y1}. Reanalysis rainfall trends should be cross-checked with observations (e.g. GPM IMERG). A significant trend shows change, not its cause.   Generated ${new Date().toISOString().slice(0, 10)}.`, 6.5, "#8ea6c0");
  saveBlob(pdf.toBlob(), `hydrowatch_${state.siteId}_${state.varId}_${r.y0}-${r.y1}.pdf`);
}

function exportCsv() {
  if (!last) return;
  const r = last, m = r.meta;
  const anom = S.deseasonalize(r.times, r.regional);
  const rows = [["year", "month", `${m.name} (${m.unit})`, `anomaly (${m.unit})`, "hydro_stress_index"]];
  r.times.forEach((t, i) => rows.push([t.year, t.month, fmt(r.regional[i], 4), fmt(anom[i], 4), lastDrought ? fmt(lastDrought.hsi[i], 3) : ""]));
  rows.push([]); rows.push(["# site", getSite(state.siteId).name]); rows.push(["# bbox", getSite(state.siteId).bbox.join(" ")]);
  rows.push(["# trend per decade", fmt(r.lin.slope * 10, 6), "ci95", fmt(r.lin.ci[0] * 10, 6), fmt(r.lin.ci[1] * 10, 6), "p_t", fmt(r.lin.p, 6), "p_mk", fmt(r.mk.p, 6), "sen_per_decade", fmt(r.mk.senSlope * 10, 6)]);
  rows.push(["# source", "NASA POWER (MERRA-2) via HydroWatch Global"]);
  const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `hydrowatch_${state.siteId}_${state.varId}_${state.y0}-${state.y1}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
}

// ---------------- trend scanner ----------------
async function scanAll() {
  readInputs();
  const site = getSite(state.siteId);
  const ids = Object.keys(VARIABLES);
  const params = [...new Set(ids.flatMap(rawParams))];
  $("btnScan").disabled = true;
  $("scanOut").innerHTML = `<span class="spinner"></span>Scanning ${ids.length} variables over ${site.name} (${params.length} NASA datasets)…`;
  try {
    const grids = await loadGrids(site, params);
    const rows = ids.map((id) => {
      try { return analyse(id, grids, { y0: state.y0, y1: state.y1, mode: "annual", alpha: state.alpha }); } catch { return null; }
    }).filter((r) => r && r.lin);
    const score = (r) => (r.lin.significant && r.mk.significant ? 2 : r.lin.significant || r.mk.significant ? 1 : 0);
    rows.sort((a, b) => score(b) - score(a) || Math.min(a.lin.p, a.mk.p) - Math.min(b.lin.p, b.mk.p));
    const tag = (r) => ["<span class='tag ns'>Not significant</span>", "<span class='tag mixed'>Borderline</span>", "<span class='tag sig'>Significant</span>"][score(r)];
    $("scanOut").innerHTML = `<div class="tablewrap"><table class="scan"><thead><tr><th>Variable</th><th>Direction</th><th class="num">Trend / decade</th><th class="num">% / decade</th><th class="num">t-test p</th><th class="num">MK p</th><th>Verdict</th><th class="num">Cells ↑ / ↓</th></tr></thead><tbody>${rows.map((r) =>
      `<tr data-v="${r.varId}"><td>${r.meta.name}</td><td><span class="dir-pill ${r.lin.slope > 0 ? "up" : "down"}">${r.lin.slope > 0 ? icon("arrow-up") + "rising" : icon("arrow-down") + "falling"}</span></td>
      <td class="num">${r.lin.slope > 0 ? "+" : ""}${fmt(r.lin.slope * 10, r.meta.decimals)} ${r.meta.annualUnit}</td>
      <td class="num">${Number.isFinite(r.summary.pctPerDecade) ? `${r.summary.pctPerDecade > 0 ? "+" : ""}${r.summary.pctPerDecade.toFixed(1)}%` : "–"}</td>
      <td class="num">${fmtP(r.lin.p)}</td><td class="num">${fmtP(r.mk.p)}</td><td>${tag(r)}</td>
      <td class="num">${r.cellStats.up} / ${r.cellStats.down} <small>of ${r.cellStats.n}</small></td></tr>`).join("")}</tbody></table></div>
      <p>Yearly values, ${state.y0}–${state.y1}, significance level ${state.alpha * 100}%. "Cells" = grid cells with their own significant rise / fall. ${icon("alert")}Testing many variables raises the chance that one looks significant by luck - confirm with the detailed view.</p>`;
    $("scanOut").querySelectorAll("tr[data-v]").forEach((tr) => (tr.onclick = () => {
      state.varId = tr.dataset.v; state.mode = "annual"; syncInputs(); run().then(() => window.scrollTo({ top: 0, behavior: "smooth" })).catch(() => {});
    }));
  } catch (e) {
    $("scanOut").innerHTML = `${icon("alert")}${e.message}`;
  } finally { $("btnScan").disabled = false; }
}

// ---------------- wizard ----------------
const wiz = { step: 0, topic: null, type: null };
const TOPIC_CARDS = [
  ["water", "droplet", "Water for rivers & dams", "Is there less (or more) water reaching rivers and reservoirs?"],
  ["land", "sprout", "Drought & dry soils", "Are soils and plants drying out?"],
  ["heat", "thermometer", "Heat & warming", "Is it getting hotter, and how fast?"],
  ["air", "cloud", "Air, clouds & sunlight", "Is the sky getting cloudier, sunnier, more humid?"],
];
const TYPE_ICONS = { hydro: "zap", desert: "sun", rainforest: "trees", city: "building", estuary: "waves", polar: "snowflake" };

function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }
document.querySelectorAll(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m || e.target.hasAttribute("data-close")) m.hidden = true; }));

function renderWizard() {
  $("wizSteps").innerHTML = [0, 1, 2, 3].map((i) => `<span class="${i <= wiz.step ? "on" : ""}"></span>`).join("");
  const body = $("wizBody");
  const card = (attr, ico, title, sub) => `<button class="card" ${attr}><span class="ico">${icon(ico)}</span><b>${title}</b><small>${sub}</small></button>`;
  if (wiz.step === 0) {
    body.innerHTML = `<h2>Question 1 · What are you curious about?</h2><div class="cards">${TOPIC_CARDS.map(([k, i, t, s]) => card(`data-topic="${k}"`, i, t, s)).join("")}</div>`;
    body.querySelectorAll("[data-topic]").forEach((b) => (b.onclick = () => { wiz.topic = b.dataset.topic; wiz.step = 1; renderWizard(); }));
  } else if (wiz.step === 1) {
    body.innerHTML = `<h2>Question 2 · What kind of place?</h2><div class="cards">${Object.entries(SITE_TYPES).map(([k, l]) => card(`data-type="${k}"`, TYPE_ICONS[k], l, `${SITES.filter((s) => s.type === k).length} study regions`)).join("")}
      ${card('data-type="map"', "pin", "Somewhere else", "Close this and click anywhere on the map")}</div>`;
    body.querySelectorAll("[data-type]").forEach((b) => (b.onclick = () => {
      if (b.dataset.type === "map") { closeModal("wizard"); setStatus(icon("pin") + "Click anywhere on the map to place a region, drag its corner handles to resize, then press Analyse."); return; }
      wiz.type = b.dataset.type; wiz.step = 2; renderWizard();
    }));
  } else if (wiz.step === 2) {
    body.innerHTML = `<h2>Question 3 · Which one?</h2><div class="cards">${SITES.filter((s) => s.type === wiz.type).map((s) => card(`data-site="${s.id}"`, TYPE_ICONS[s.type], s.name, s.country)).join("")}</div>`;
    body.querySelectorAll("[data-site]").forEach((b) => (b.onclick = () => { state.siteId = b.dataset.site; wiz.step = 3; renderWizard(); }));
  } else {
    const site = getSite(state.siteId);
    const sug = suggest(wiz.topic, site.type);
    body.innerHTML = `<h2>Your clues for ${site.name}</h2><p class="fine">${site.note}</p>
      <p>Based on your question and the character of this place, these variables are the most likely to reveal a trend:</p>
      <div class="cards">${sug.map((s, i) => card(`data-var="${s.id}"`, i === 0 ? "star" : "circle", VARIABLES[s.id].name, s.reason || VARIABLES[s.id].definition)).join("")}</div>`;
    body.querySelectorAll("[data-var]").forEach((b) => (b.onclick = () => {
      state.varId = b.dataset.var; closeModal("wizard"); showSuggestions(sug); syncInputs(); run();
    }));
  }
}

function showSuggestions(sug) {
  $("suggestBox").hidden = false;
  $("suggestList").innerHTML = sug.map((s) => `<button class="btn sugg" data-v="${s.id}">${VARIABLES[s.id].name}<small>${s.reason || ""}</small></button>`).join("");
  $("suggestList").querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => { state.varId = b.dataset.v; syncInputs(); run(); }));
}

// ---------------- demos (guided tours) ----------------
const memo = {};
const pct = (r) => `${r.summary.pctPerDecade > 0 ? "+" : ""}${r.summary.pctPerDecade.toFixed(1)}%`;
const per = (r) => `${r.lin.slope > 0 ? "+" : ""}${fmt(r.lin.slope * 10, r.meta.decimals)} ${r.mode === "annual" ? r.meta.annualUnit : r.meta.unit}/decade`;
const verdictWord = (r) => (r.lin.significant && r.mk.significant ? "<b>significant by both tests</b>" : r.lin.significant || r.mk.significant ? "<b>significant by only one test</b> (borderline)" : "<b>not significant</b>");

const DEMOS = [
  {
    id: "kariba60", icon: "zap", title: "Kariba in 60 seconds", sub: "Rain, step change and the early-warning index - the short version.",
    steps: [
      { set: { siteId: "kariba", varId: "PRECTOTCORR", mode: "annual", y0: 1981, y1: 2025 }, hl: "map",
        text: () => `<b>The problem.</b> Kariba's hydropower depends on rain that falls far upstream. The dashed box is the Zambezi catchment that feeds the dam (blue dot), so we watch the rain <i>there</i>.` },
      { hl: "verdict", text: (r) => `<b>Is it changing?</b> Catchment rainfall changed by <b>${per(r)}</b> (${pct(r)} per decade): ${verdictWord(r)}.${r.change && r.change.significant ? ` A step change shows up around <b>${r.change.year}</b>.` : ""}` },
      { hl: "map", text: (r) => `<b>Where?</b> ${r.cellStats.down} of ${r.cellStats.n} grid cells dry significantly and ${r.cellStats.up} get wetter. Allowing for ${r.cellStats.n} cells tested at once, <b>${r.cellStats.fdrDown} falling and ${r.cellStats.fdrUp} rising</b> remain. Tick "FDR-corrected" on the map to see only those.` },
      { hl: "droughtPanel", text: () => { const d = lastDrought, e = d.episodes[0]; return `<b>Early warning.</b> The Hydro Stress Index blends 12-month rain (60%), 3-month rain (20%) and soil moisture (20%). Below −1 means inflow risk. The worst episode in this record peaked at <b>${e.peak.toFixed(2)}σ in ${e.peakAt}</b> and lasted ${e.months} months.`; } },
      { hl: "droughtPanel", text: () => {
        const d = lastDrought, low = d.hsi.filter(Number.isFinite).slice(-24).filter((v) => v <= -1).length;
        return `<b>Right now (${d.latest.label}):</b> ${d.latest.cls.level}, index ${d.latest.value.toFixed(2)}. In the last 24 months it sat at or below −1 for <b>${low}</b> of them. It shows conditions are stressed <i>now</i>; it is an indicator, not a forecast. Cross-check the rain with satellite data via the GPM IMERG overlay (needs a free NASA login).`; } },
    ],
  },
  {
    id: "kariba", icon: "zap", title: "The Kariba power crisis", sub: "Why did Zambia and Zimbabwe lose their hydropower in 2024?",
    steps: [
      { set: { siteId: "kariba", varId: "PRECTOTCORR", mode: "annual", y0: 1981, y1: 2025 }, hl: "map",
        text: () => `Kariba Dam (blue dot) gets its water from the <b>Upper Zambezi catchment</b> (dashed box), hundreds of km upstream. So we investigate rainfall <i>there</i>, not at the dam.` },
      { hl: "tsChart", text: (r) => `Each blue dot is one year's total rainfall over the catchment. The green line is the best-fit trend: <b>${per(r)}</b> (${pct(r)} of the average per decade).` },
      { hl: "tiles", text: (r) => `Is it real? The t-test gives p = ${fmtP(r.lin.p)}, Mann-Kendall p = ${fmtP(r.mk.p)} - ${verdictWord(r)}. When tests disagree, it usually means a few extreme years dominate: Mann-Kendall only counts ups vs downs, the t-test is sensitive to big swings.` },
      { set: { mode: "anomaly" }, hl: "tsChart", text: (r) => `Now we remove the seasons and test every month (Seasonal Kendall compares each January with other Januaries…). Trend ${per(r)}, Seasonal Kendall p = ${fmtP(r.mk.p)}. More data points, sharper test.` },
      { set: { varId: "T2M", mode: "annual" }, hl: "verdict", text: (r) => `Meanwhile the catchment is warming at <b>${per(r)}</b> - ${verdictWord(r)}. Warmer air evaporates more water from Lake Kariba's enormous surface.` },
      { set: { varId: "PRECTOTCORR" }, hl: "droughtPanel", text: () => { const d = lastDrought, e = d.episodes[0]; return `The early-warning index shows the worst drought in the record peaking at <b>${e.peak.toFixed(2)}σ in ${e.peakAt}</b> - the 2024 El Niño drought that left the reservoir near its minimum operating level and caused long daily power cuts.`; } },
      { hl: "map", text: (r) => `<b>Where?</b> ${r.cellStats.down} of ${r.cellStats.n} grid cells show a significant drying and ${r.cellStats.up} a significant wetting. Hover the squares to inspect each one. Case notes: drier and hotter catchment → less inflow → more drought risk for the grid.` },
    ],
  },
  {
    id: "itaipu", icon: "factory", title: "Itaipu: how long a record do you need?", sub: "A strong drying trend - but would we have noticed it in 2000?",
    steps: [
      { set: { siteId: "itaipu", varId: "P_MINUS_ET", mode: "annual", y0: 1981, y1: 2025 }, hl: "verdict",
        text: (r) => `The Paraná basin feeds Itaipu, one of the largest hydropower plants on Earth. Water balance (rain − evapotranspiration): <b>${per(r)}</b>, ${verdictWord(r)}.` },
      { set: { y0: 1981, y1: 2000 }, hl: "tiles", text: (r) => `Same place, but only the first 20 years (1981–2000): trend ${per(r)}, t-test p = ${fmtP(r.lin.p)}. ${r.lin.significant ? "Already detectable." : "<b>Not significant</b> - with a short record, natural variability hides the signal."}` },
      { set: { y0: 1981, y1: 2025 }, hl: "tsChart", text: (r) => `With all 45 years the 95% confidence interval narrows to ${fmt(r.lin.ci[0] * 10, 0)} … ${fmt(r.lin.ci[1] * 10, 0)} mm/yr per decade. Longer records = smaller uncertainty. This is why long satellite & model archives matter.` },
      { hl: "droughtPanel", text: () => { const e = lastDrought.episodes; return `Drought index: worst episodes peak at ${e.slice(0, 2).map((x) => `<b>${x.peak.toFixed(2)}σ (${x.peakAt})</b>`).join(" and ")}. The 2021 drought cut Brazilian hydropower and pushed up electricity prices. Latest status: <b>${lastDrought.latest.cls.level}</b>.`; } },
    ],
  },
  {
    id: "opposite", icon: "arrow-up-down", title: "Same planet, opposite trends", sub: "The Sahel is getting wetter while the southern Amazon dries.",
    steps: [
      { set: { siteId: "sahel", varId: "PRECTOTCORR", mode: "annual", y0: 1981, y1: 2025 }, hl: "verdict",
        text: (r) => { memo.sahel = r; return `West African Sahel rainfall: <b>${per(r)} (${pct(r)})</b>, ${verdictWord(r)}. After the catastrophic droughts of the 1970s–80s, the rains have partly recovered.`; } },
      { set: { siteId: "amazon" }, hl: "verdict", text: (r) => `Southern Amazon: <b>${per(r)} (${pct(r)})</b>, ${verdictWord(r)}. Opposite sign, both in the tropics! Shifts of the tropical rain belt and land-use change can push regions in different directions.` },
      { hl: "map", text: (r) => `${r.cellStats.down} of ${r.cellStats.n} Amazon cells dry significantly, compared with ${memo.sahel.cellStats.up} of ${memo.sahel.cellStats.n} Sahel cells getting wetter. Averaged together, a "tropical mean" could show almost nothing - <b>always ask where</b>. ${icon("alert")}Reanalysis rainfall trends should be cross-checked with observations such as GPM IMERG.` },
    ],
  },
  {
    id: "arctic", icon: "snowflake", title: "Arctic amplification", sub: "Compare warming in Greenland with the Zambezi.",
    steps: [
      { set: { siteId: "greenland", varId: "T2M", mode: "annual", y0: 1981, y1: 2025 }, hl: "verdict", text: (r) => { memo.gl = r; return `West Greenland air temperature: <b>${per(r)}</b>, ${verdictWord(r)}.`; } },
      { set: { siteId: "kariba" }, hl: "verdict", text: (r) => `Upper Zambezi: <b>${per(r)}</b>. Greenland warms about <b>${(memo.gl.lin.slope / r.lin.slope).toFixed(1)}×</b> faster - melting snow and ice expose darker ground and ocean, which absorb more sunlight (a feedback loop).` },
      { set: { mode: "anomaly" }, hl: "seasonChart", text: () => `The seasonal-cycle chart compares the first and second half of the record month by month - see which seasons warmed most.` },
    ],
  },
];

const tour = { active: false, demo: null, i: 0 };
async function tourStep() {
  const d = tour.demo, st = d.steps[tour.i];
  $("tourTitle").textContent = d.title; $("tourStep").textContent = `step ${tour.i + 1} / ${d.steps.length}`;
  $("tourText").innerHTML = '<span class="spinner"></span>Working…'; $("tourNext").disabled = true;
  document.querySelectorAll(".highlight").forEach((e) => e.classList.remove("highlight"));
  try {
    if (st.set || !last) { Object.assign(state, st.set || {}); syncInputs(); await run(); }
    const el = $(st.hl); const box = el && (el.closest(".panel") || el);
    if (box) { box.classList.add("highlight"); box.scrollIntoView({ behavior: "smooth", block: "center" }); }
    $("tourText").innerHTML = st.text(last);
  } catch (e) { $("tourText").textContent = `Could not load data: ${e.message}`; }
  $("tourNext").disabled = false;
  $("tourNext").innerHTML = tour.i === d.steps.length - 1 ? `Finish${icon("check", "after")}` : `Next${icon("chevron-right", "after")}`;
}
function startDemo(id) {
  closeModal("demos"); $("welcome").hidden = true;
  tour.active = true; tour.demo = DEMOS.find((d) => d.id === id); tour.i = 0;
  $("tour").hidden = false; tourStep();
}
function stopTour() {
  tour.active = false; $("tour").hidden = true;
  document.querySelectorAll(".highlight").forEach((e) => e.classList.remove("highlight"));
}
$("tourNext").onclick = () => { if (tour.i < tour.demo.steps.length - 1) { tour.i++; tourStep(); } else stopTour(); };
$("tourStop").onclick = stopTour;

// ---------------- PWA: service worker, install prompt, offline badge ----------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
let installEvent = null;
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; $("btnInstall").hidden = false; });
window.addEventListener("appinstalled", () => { installEvent = null; $("btnInstall").hidden = true; });
if (isIOS && !standalone) $("btnInstall").hidden = false; // iOS has no install prompt: show instructions instead
$("btnInstall").onclick = async () => {
  if (installEvent) { installEvent.prompt(); await installEvent.userChoice.catch(() => {}); installEvent = null; $("btnInstall").hidden = true; }
  else setStatus("To install on iPhone/iPad: tap the Share button, then <b>Add to Home Screen</b>.");
};
const showNet = () => ($("netBadge").hidden = navigator.onLine);
window.addEventListener("online", showNet); window.addEventListener("offline", showNet); showNet();

// ---------------- mobile-first defaults ----------------
const isPhone = () => window.matchMedia("(max-width: 900px)").matches;
// On phones start with only "Location" open so results aren't pushed off-screen by the form.
if (isPhone()) document.querySelectorAll("#caseBody details.sec").forEach((d, i) => { if (i > 0) d.open = false; });

// ---------------- wire up ----------------
hydrateIcons();
fillSelects(); syncInputs();
$("demoCards").innerHTML = DEMOS.map((d) => `<button class="card" data-demo="${d.id}"><span class="ico">${icon(d.icon)}</span><b>${d.title}</b><small>${d.sub}</small></button>`).join("");
$("demoCards").querySelectorAll("[data-demo]").forEach((b) => (b.onclick = () => startDemo(b.dataset.demo)));
$("btnWizard").onclick = () => { wiz.step = 0; renderWizard(); openModal("wizard"); };
$("btnDemos").onclick = () => openModal("demos");
const learn = initLearn($("learn"), {
  tour: () => startDemo("kariba60"),
  guide: () => $("btnWizard").click(),
  demos: () => openModal("demos"),
});
$("btnLearn").onclick = () => learn.open();
const onAnalyse = () => run().then(() => setCollapsed(true)).catch(() => {});
$("btnRun").onclick = onAnalyse;
$("btnRunRail").onclick = onAnalyse;

// Whole-sidebar collapse (slim rail). The choice is remembered per browser.
function setSidebar(open, remember = true) {
  document.querySelector(".layout").classList.toggle("sb-collapsed", !open);
  $("btnSidebar").setAttribute("aria-expanded", String(open));
  if (remember) try { localStorage.setItem("hw.sidebar", open ? "open" : "closed"); } catch {}
  setTimeout(() => map.invalidateSize(), 300); // after the width transition
}
$("btnSidebar").onclick = () => setSidebar(false);
$("btnRailOpen").onclick = () => setSidebar(true);
document.addEventListener("keydown", (e) => {
  if (e.key !== "[" || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
  setSidebar(document.querySelector(".layout").classList.contains("sb-collapsed"));
});
try { if (localStorage.getItem("hw.sidebar") === "closed") setSidebar(false, false); } catch {}
$("btnEdit").onclick = () => setCollapsed(!document.querySelector(".controls").classList.contains("collapsed"));
$("btnCsv").onclick = exportCsv;
$("btnScan").onclick = scanAll;
// Changing a control only marks the case file "dirty"; the user decides when to re-run (press Analyse).
["site", "variable"].forEach((id) => $(id).addEventListener("change", () => { readInputs(); syncInputs(); setDirty(true); }));
["mode", "alpha", "y0", "y1"].forEach((id) => $(id).addEventListener("change", () => { readInputs(); syncInputs(); setDirty(true); }));
$("boxSize").addEventListener("change", () => {
  if (!customSite || state.siteId !== "custom") return; // otherwise it applies to the next map click
  const [a, b, c, d] = customSite.bbox;
  makeCustomBox((a + b) / 2, (c + d) / 2, +$("boxSize").value);
});
$("btnPdf").onclick = exportPdf;
Object.entries(OBS).forEach(([k, c]) => $(c.box).addEventListener("change", () => {
  if ($(c.box).checked) loadObs(k);
  else { clearTimeout(obsData[k].timer); setObsNote(""); last && renderTS(last); }
}));
// Map layer toggles
L.DomEvent.disableClickPropagation($("mapToggles")); L.DomEvent.disableScrollPropagation($("mapToggles"));
const toggleLayer = (layer, on) => (on ? map.addLayer(layer) : map.removeLayer(layer));
$("showGrid").onchange = (e) => toggleLayer(cellLayer, e.target.checked);
$("showRegion").onchange = (e) => toggleLayer(regionLayer, e.target.checked);
$("onlySig").onchange = () => last && renderMap(last);
$("fdrOnly").onchange = () => last && renderMap(last);
document.querySelectorAll("[data-png]").forEach((b) => (b.onclick = () => downloadPng(b.dataset.png)));
["showSen", "showCI", "showChange"].forEach((id) => $(id).addEventListener("change", () => last && renderTS(last)));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".modal").forEach((m) => (m.hidden = true)); });
// Deep link for presentations: #demo=kariba&step=3
const hp = new URLSearchParams(location.hash.slice(1));

// First-visit welcome: shown once, then remembered. Never shown on demo links.
function closeWelcome() { $("welcome").hidden = true; try { localStorage.setItem("hw.welcome", "1"); } catch {} }
$("welcomeClose").onclick = closeWelcome;
$("welcomeTour").onclick = () => { closeWelcome(); startDemo("kariba60"); };
$("welcomeGuide").onclick = () => { closeWelcome(); $("btnWizard").click(); };
(() => { let seen = false; try { seen = localStorage.getItem("hw.welcome") === "1"; } catch {} if (!seen && !hp.get("demo")) $("welcome").hidden = false; })();
if (hp.get("demo") && DEMOS.some((d) => d.id === hp.get("demo"))) {
  (async () => {
    tour.active = true; tour.demo = DEMOS.find((d) => d.id === hp.get("demo")); $("tour").hidden = false;
    const target = Math.min(Math.max(1, +hp.get("step") || 1), tour.demo.steps.length) - 1;
    for (tour.i = 0; tour.i <= target; tour.i++) await tourStep();
    tour.i = target;
  })();
} else {
  if (hp.get("site") && getSite(hp.get("site"))) state.siteId = hp.get("site");
  if (hp.get("var") && VARIABLES[hp.get("var")]) state.varId = hp.get("var");
  syncInputs();
  run().then(() => { if (isPhone()) setCollapsed(true); return hp.has("scan") && scanAll(); }).catch(() => {});
}
