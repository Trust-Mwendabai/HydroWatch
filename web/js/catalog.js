// Variable catalog: plain-language definitions for students and the public.
// All raw data: NASA POWER monthly (MERRA-2 reanalysis, CERES/SRB for solar).

const daysIn = (y, m) => new Date(y, m, 0).getDate();

export const VARIABLES = {
  PRECTOTCORR: {
    name: "Rainfall (precipitation)", category: "water", unit: "mm/month", annualUnit: "mm/yr", annual: "sum",
    convert: (v, y, m) => v * daysIn(y, m), decimals: 1, wetter: true,
    definition: "How much water falls from the sky as rain or snow, measured as the depth it would make if it pooled on flat ground.",
    why: "Rain over the catchment is what fills reservoirs. Less rain upstream means less water reaching the turbines months later.",
    source: "MERRA-2 reanalysis, bias-corrected with gauge/satellite precipitation (via NASA POWER)",
  },
  EVPTRNS: {
    name: "Evapotranspiration", category: "water", unit: "mm/month", annualUnit: "mm/yr", annual: "sum",
    convert: (v, y, m) => (v / 2.45) * daysIn(y, m), decimals: 1, wetter: false,
    definition: "Water returned to the air by evaporation from soil and lakes plus 'breathing out' (transpiration) by plants.",
    why: "Water that evaporates never reaches the river. Rising evapotranspiration can shrink inflows even if rainfall stays the same.",
    source: "MERRA-2 reanalysis latent heat flux, converted at 2.45 MJ/kg",
  },
  P_MINUS_ET: {
    name: "Water balance (rain − evapotranspiration)", category: "water", unit: "mm/month", annualUnit: "mm/yr", annual: "sum",
    needs: ["PRECTOTCORR", "EVPTRNS"], derive: (p, et) => p - et, decimals: 1, wetter: true,
    definition: "Rainfall minus evapotranspiration: the water left over that can soak into the ground or run off into rivers.",
    why: "This is the closest single number to 'how much water the basin can give the dam'. A falling trend is an early warning for hydropower.",
    source: "Derived from two MERRA-2 variables",
  },
  GWETROOT: {
    name: "Root-zone soil moisture", category: "land", unit: "% saturation", annualUnit: "% saturation", annual: "mean",
    convert: (v) => v * 100, decimals: 1, wetter: true,
    definition: "How full the top ~1 metre of soil is with water, from 0% (bone dry) to 100% (completely soaked).",
    why: "Dry soils soak up rain before any runs off, so droughts in the soil delay and weaken river recovery.",
    source: "MERRA-2 land surface model",
  },
  GWETTOP: {
    name: "Surface soil moisture", category: "land", unit: "% saturation", annualUnit: "% saturation", annual: "mean",
    convert: (v) => v * 100, decimals: 1, wetter: true,
    definition: "Wetness of the top 5 cm of soil. It reacts within days to rain and heat.",
    why: "A fast indicator of 'flash drought' and of how crops and grasslands are coping.",
    source: "MERRA-2 land surface model (comparable to NASA SMAP observations)",
  },
  T2M: {
    name: "Air temperature", category: "heat", unit: "°C", annualUnit: "°C", annual: "mean", noPct: true,
    convert: (v) => v, decimals: 2, wetter: false,
    definition: "Average air temperature 2 metres above the ground, about head height.",
    why: "Warmer air increases evaporation from reservoirs and soils, and raises electricity demand for cooling.",
    source: "MERRA-2 reanalysis",
  },
  T2M_MAX: {
    name: "Daily maximum temperature", category: "heat", unit: "°C", annualUnit: "°C", annual: "mean", noPct: true,
    convert: (v) => v, decimals: 2, wetter: false,
    definition: "The average of each day's hottest temperature during the month.",
    why: "Tracks heat stress: hot afternoons drive peak evaporation and peak power demand, especially in cities.",
    source: "MERRA-2 reanalysis",
  },
  RH2M: {
    name: "Relative humidity", category: "air", unit: "%", annualUnit: "%", annual: "mean",
    convert: (v) => v, decimals: 1, wetter: true,
    definition: "How close the air is to being saturated with water vapour (100% = fog/dew).",
    why: "Drier air pulls more water out of lakes, soils and leaves.",
    source: "MERRA-2 reanalysis",
  },
  QV2M: {
    name: "Specific humidity", category: "air", unit: "g/kg", annualUnit: "g/kg", annual: "mean",
    convert: (v) => v, decimals: 2, wetter: true,
    definition: "Grams of water vapour in each kilogram of air - the actual amount of moisture, regardless of temperature.",
    why: "Warmer air can hold ~7% more water per °C, so this often rises with warming even where relative humidity falls.",
    source: "MERRA-2 reanalysis",
  },
  ALLSKY_SFC_SW_DWN: {
    name: "Sunlight at the surface", category: "air", unit: "kWh/m²/day", annualUnit: "kWh/m²/day", annual: "mean",
    convert: (v) => v / 3.6, decimals: 2, wetter: false,
    definition: "Solar energy reaching the ground each day, after clouds and haze have blocked some of it.",
    why: "More sun means more evaporation - but also a chance to add floating solar panels on reservoirs during droughts.",
    source: "NASA CERES / GEWEX SRB (via NASA POWER, from 1984)",
  },
  CLOUD_AMT: {
    name: "Cloud cover", category: "air", unit: "%", annualUnit: "%", annual: "mean",
    convert: (v) => v, decimals: 1, wetter: true,
    definition: "Percentage of the sky covered by cloud, averaged over the month.",
    why: "Clouds bring rain and shade reservoirs; fewer clouds usually go with drier, sunnier conditions.",
    source: "NASA CERES (via NASA POWER, from 1984)",
  },
  WS2M: {
    name: "Wind speed", category: "air", unit: "m/s", annualUnit: "m/s", annual: "mean",
    convert: (v) => v, decimals: 2, wetter: false,
    definition: "Average wind speed 2 metres above the ground.",
    why: "Wind carries moist air away from water surfaces and so speeds up evaporation.",
    source: "MERRA-2 reanalysis",
  },
};

export const CATEGORIES = {
  water: "Water for rivers & dams",
  land: "Drought & dry soils",
  heat: "Heat & warming",
  air: "Air, clouds & sunlight",
};

export function rawParams(id) {
  const v = VARIABLES[id];
  return v.needs || [id];
}

/** Build a converted monthly series for a variable from fetched POWER grids. */
export function buildCells(id, grids, times) {
  const v = VARIABLES[id];
  if (v.needs) {
    const parts = v.needs.map((p) => buildCells(p, grids, times));
    return parts[0].map((c, k) => ({
      lat: c.lat, lon: c.lon,
      v: c.v.map((x, i) => {
        const others = parts.slice(1).map((pp) => pp[k] && pp[k].v[i]);
        return [x, ...others].every(Number.isFinite) ? v.derive(x, ...others) : NaN;
      }),
    }));
  }
  return grids[id].cells.map((c) => ({
    lat: c.lat, lon: c.lon,
    v: c.v.map((x, i) => (x === null ? NaN : v.convert(x, times[i].year, times[i].month))),
  }));
}
