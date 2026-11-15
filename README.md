# HydroWatch Global (AquaSentinel)
### NASA Space Apps 2026 · *Be An Earth System Trend Detective!*

HydroWatch Global is a web tool that turns students and the public into **Earth-system trend detectives**, with a focus on the water that feeds **hydropower dams** (Kariba and the Zambezi first). It answers the four questions the challenge asks:

| Challenge question | How HydroWatch answers it |
|---|---|
| **What** is changing? | 12 NASA variables with plain-language definitions. A guided question wizard recommends variables for your topic and type of place. The **Trend Scanner** tests every variable at once and ranks them. |
| **Where** is it changing? | A grid map repeats the trend test in every ~50 km NASA grid cell, so opposite trends inside one region become visible. |
| **How much**? | Linear trend per decade, % of the long-term average per decade, total change along the trend line, and Sen's slope (robust to outliers). |
| Is it **significant**? | t-test with autocorrelation correction, 95% confidence interval, Mann-Kendall test, and Seasonal Kendall test. A plain-language verdict says *Significant*, *Borderline* or *Not significant*. |

On top of that, a **hydro-drought early-warning index** (SPI-12, SPI-3 and soil moisture) flags inflow risk for reservoirs.

---

## Quick start

```bash
cd hydrowatch
./start.sh            # or: python3 server.py --port 8000
# open http://localhost:8000
```

Requirements: **Python 3.8+ (standard library only)** and a modern browser. No API keys, no `pip install`.
The first time a region is analysed, the data comes live from NASA POWER (about 3–10 s). After that it is cached in `data/cache/`. The 16 built-in regions are already cached, so the demos also work **offline**. Only the map background needs internet.

### Optional: NASA satellite observations (GPM IMERG rainfall, SMAP soil moisture)
Everything above uses MERRA-2, a *reanalysis* (a model constrained by observations). Two optional overlays check it against
satellite *observations*:

| Overlay | Shown for | Record | What you see |
|---|---|---|---|
| **GPM IMERG** rainfall | Rainfall | 2000 onward | Yearly totals on the same axis (mm/yr), year-to-year agreement, and the MERRA-2 vs IMERG **trend side by side** (same direction or not) |
| **SMAP** soil moisture | Surface / root-zone soil moisture | 2015 onward | SMAP on a right-hand axis (m³/m³) and year-to-year agreement |

```bash
pip install earthaccess xarray h5netcdf numpy
export EARTHDATA_TOKEN=...      # free token from https://urs.earthdata.nasa.gov/  (PowerShell: $env:EARTHDATA_TOKEN="...")
python3 server.py
```
Then tick **GPM IMERG overlay** / **SMAP overlay** above the time series (yearly mode). The first request per region runs in the
background for several minutes and is cached in `data/cache/`. Without the token and packages the rest of the app works
unchanged and the overlay explains what is missing. MERRA-2 rainfall is itself bias-corrected with satellite/gauge data, so
agreement is reassuring but the two are not fully independent.
Offline logic tests: `python -m unittest tests.test_smap`. The live NASA download step needs a real login and has not been run
against the real service yet.

### Demo links (good for presentations)
- `http://localhost:8000/#demo=kariba60` - **Kariba in 60 seconds** (5 steps: rain, step change, where, early warning, now)
- `http://localhost:8000/#demo=kariba` - **The Kariba power crisis** (7 steps)
- `#demo=itaipu` - **How long a record do you need?** (20 vs 45 years)
- `#demo=opposite` - **Same planet, opposite trends** (Sahel wetter, Amazon drier)
- `#demo=arctic` - **Arctic amplification** (Greenland vs Zambezi warming)
- `#site=kariba&scan=1` - opens Kariba and runs the Trend Scanner
- To start at a later step, add `&step=N`, e.g. `#demo=kariba&step=6`

---

## What it found (live NASA POWER / MERRA-2 data, yearly values 1981–2025)

| Region | Finding |
|---|---|
| **Kariba - Upper Zambezi** | Rainfall **−41 mm/yr per decade (−4.2%/decade)**. Mann-Kendall p = 0.011, but the t-test gives p = 0.14, so the verdict is *borderline*. Air temperature **+0.25 °C/decade** (significant). The worst drought in the 45-year record peaks at **−2.07σ in March 2024**, the El Niño drought that crippled Kariba hydropower. |
| **Itaipu - Paraná** | Strong, significant drying (rain −7.6%/decade, water balance −6.8%/decade, p < 0.01). With only 1981–2000 data the same water-balance analysis is **not significant** (p = 0.81). Record length matters. |
| **Sahel vs. Southern Amazon** | Sahel rainfall is **rising** (+7.6%/decade, 122 of 143 cells significant). Southern Amazon rainfall is **falling** (−10%/decade, 169 of 169 cells). |
| **West Greenland** | Warming **+0.61 °C/decade**, about 2.4× faster than the Zambezi catchment. |

> ⚠ MERRA-2 is a reanalysis (a model constrained by observations). Rainfall trends in regions with few observations should be cross-checked against GPM IMERG (e.g. in NASA Giovanni) before anyone draws conclusions.

---

## Features
- **Guided investigation wizard**: (1) what are you curious about, (2) what kind of place (hydropower basin, desert, rainforest, city, estuary, polar), (3) which region. You get ranked "clues" (variables), each with a reason tied to the character of the place.
- **4 auto-playing demo cases** that drive the real tool and explain each step. All numbers in the captions are computed live, none are hard-coded.
- **Click anywhere on the map** to analyse a 5° × 5° box at that spot.
- **Time-series chart**: trend line, Sen's slope, 95% slope band, yearly values or deseasonalised monthly anomalies with a 12-month running mean.
- **Seasonal-cycle chart**: compares the first and second half of the record month by month, showing which seasons changed.
- **Trend map**: per-cell trend colour; solid squares are significant, faded ones are not. Hover a square for its numbers.
- **Trend Scanner**: tests all variables in a region and ranks them, with a reminder about multiple-testing.
- **Hydro-drought early warning**: Hydro Stress Index, current status badge, and a table of the worst drought episodes.
- **CSV export** of the regional series, anomalies, drought index and trend statistics.
- **"How it works"** explainer written for high-school and college students.

## Data
All data comes from **NASA POWER** (Prediction Of Worldwide Energy Resources), monthly, 1981–2025, through its regional API. Grids are ~0.5° × 0.625° for MERRA-2 variables and ~1° for CERES variables.

| Variable | POWER id | Source |
|---|---|---|
| Rainfall | PRECTOTCORR | MERRA-2, bias-corrected |
| Evapotranspiration | EVPTRNS (MJ/m²/day ÷ 2.45 → mm) | MERRA-2 |
| Water balance P − ET | derived | MERRA-2 |
| Root-zone / surface soil moisture | GWETROOT / GWETTOP | MERRA-2 land model |
| Air temperature, daily max | T2M / T2M_MAX | MERRA-2 |
| Relative / specific humidity | RH2M / QV2M | MERRA-2 |
| Wind speed | WS2M | MERRA-2 |
| Sunlight at surface, cloud cover | ALLSKY_SFC_SW_DWN / CLOUD_AMT | CERES / GEWEX SRB (from 1984) |

Regional series are **cos(latitude) area-weighted means** of all grid cells in the box. Hydropower regions cover the **upstream catchment**, not just the dam, because the dam's inflow comes from rain upstream.

## Methods (`web/js/stats.js`)
- **Linear trend**: ordinary least squares. The t-test on the slope uses the effective sample size n_eff = n(1 − r₁)/(1 + r₁) from lag-1 autocorrelation of the residuals (Santer et al., 2000). The 95% CI is slope ± t₀.₉₇₅,df · SE.
- **Mann-Kendall**: tie-corrected variance, continuity-corrected Z, two-sided p.
- **Sen's slope**: median of pairwise slopes, with the Gilbert (1987) confidence interval.
- **Seasonal Kendall** (Hirsch et al., 1982): used in monthly-anomaly mode, so the seasonal cycle cannot create a false trend.
- **Deseasonalising**: each month minus its long-term mean for that calendar month.
- **SPI** (McKee et al., 1993): gamma distribution fitted with the Thom MLE per calendar month, then mapped to N(0, 1). Zero rainfall is handled with a mixed distribution.
- **Hydro Stress Index** = 0.6·SPI-12 + 0.2·SPI-3 + 0.2·z(3-month root-zone soil moisture). Classes: ≤ −0.5 abnormally dry, ≤ −1 moderate, ≤ −1.5 severe, ≤ −2 extreme drought.

**Validation:** `node tests/test_stats.mjs` checks the JavaScript engine against **SciPy** in 545 checks: t-distribution, normal and gamma functions, regression slope, SE, p and CI, Mann-Kendall S, Var(S), Z and p including ties, Sen's slope and its CI (`scipy.stats.theilslopes`), and SPI. All pass. Regenerate the reference values with `python3 tests/make_reference.py`.

## Project layout
```
hydrowatch/
├── server.py          # stdlib HTTP server + cached NASA POWER proxy (/api/region)
├── start.sh
├── data/cache/        # cached NASA grids (JSON)
├── web/
│   ├── index.html
│   ├── css/style.css
│   ├── js/stats.js    # statistics engine (pure, testable in Node)
│   ├── js/analysis.js # pipeline: regional mean, trends, per-cell map, drought index, narrative
│   ├── js/catalog.js  # variables, unit conversions, plain-language definitions
│   ├── js/sites.js    # study regions + rule-based variable recommender
│   ├── js/app.js      # UI: map, charts, wizard, demos, scanner, CSV
│   └── vendor/        # Leaflet 1.9.4, Chart.js 4.4.1 (local copies)
└── tests/             # SciPy reference generator + Node test runner
```

## Roadmap (team tasks)
- **Observations alongside the reanalysis**: GPM IMERG rainfall and SMAP soil moisture through NASA Earthdata or Giovanni (needs an Earthdata login).
- **Reservoir water itself**: SWOT lake heights and Landsat/Sentinel-2 water extent (Google Earth Engine) for Kariba, plotted against the drought index.
- **Forecasting**: an ML model (e.g. gradient boosting) that predicts reservoir level 3–6 months ahead from SPI, soil moisture and ENSO indices.
- **Alerts**: email/SMS early warnings when a basin's Hydro Stress Index crosses −1.
- **Better statistics**: change-point detection (Pettitt test), field significance for the trend map (false discovery rate), and pre-whitened Mann-Kendall.

## Credits
Data: NASA POWER Project (NASA Langley Research Center), funded through the NASA Earth Science/Applied Science Program, using MERRA-2 (NASA GMAO) and CERES/GEWEX SRB.
Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors. Libraries: Leaflet (BSD-2), Chart.js (MIT).
