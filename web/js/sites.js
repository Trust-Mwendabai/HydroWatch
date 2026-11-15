// Study regions. bbox = [latMin, latMax, lonMin, lonMax], each side 2-10 degrees
// (NASA POWER regional limits). Hydropower catchments are the area that FEEDS the
// dam, not just the dam itself, because inflow comes from upstream rainfall.

export const SITES = [
  { id: "kariba", type: "hydro", name: "Kariba Dam - Upper Zambezi catchment", country: "Zambia / Zimbabwe / Angola",
    bbox: [-17, -11, 20, 27], dam: [-16.52, 28.76], capacityMW: 2130,
    note: "Kariba is the world's largest man-made reservoir by volume and supplies much of Zambia's and Zimbabwe's electricity. The 2024 El Niño drought pushed it to record lows and caused long daily power cuts." },
  { id: "kafue", type: "hydro", name: "Kafue Gorge - Kafue River basin", country: "Zambia",
    bbox: [-16, -12, 25, 29], dam: [-15.81, 28.43], capacityMW: 1740,
    note: "The Kafue cascade (Itezhi-Tezhi, Kafue Gorge Upper and Lower) is Zambia's second hydropower pillar." },
  { id: "cahora", type: "hydro", name: "Cahora Bassa - Lower Zambezi", country: "Mozambique",
    bbox: [-18, -14, 30, 35], dam: [-15.59, 32.70], capacityMW: 2075,
    note: "Exports power across southern Africa; depends on Kariba releases plus local tributaries." },
  { id: "gerd", type: "hydro", name: "Grand Ethiopian Renaissance Dam - Blue Nile highlands", country: "Ethiopia",
    bbox: [8, 13, 34.5, 39.5], dam: [11.21, 35.09], capacityMW: 5150,
    note: "Africa's largest hydropower plant, fed by the summer monsoon over the Ethiopian highlands." },
  { id: "inga", type: "hydro", name: "Inga Falls - Congo basin (rainforest)", country: "DR Congo",
    bbox: [-4, 2, 15, 23], dam: [-5.52, 13.62], capacityMW: 1775,
    note: "The Congo has the second largest river flow on Earth and very steady rain from the rainforest." },
  { id: "itaipu", type: "hydro", name: "Itaipu - Paraná basin", country: "Brazil / Paraguay",
    bbox: [-26, -19, -55, -48], dam: [-25.41, -54.59], capacityMW: 14000,
    note: "One of the world's largest hydropower plants by energy output; hit by severe droughts in 2020-2021." },
  { id: "mead", type: "hydro", name: "Hoover Dam - Upper Colorado basin", country: "USA",
    bbox: [37, 42, -111, -105], dam: [36.02, -114.74], capacityMW: 2080,
    note: "Lake Mead fell to its lowest level since filling in 2022 during the long south-western 'megadrought'." },
  { id: "threegorges", type: "hydro", name: "Three Gorges - Upper Yangtze", country: "China",
    bbox: [27, 33, 102, 111], dam: [30.82, 111.00], capacityMW: 22500,
    note: "The world's largest power station. A 2022 heatwave-drought sharply cut Sichuan's hydropower." },
  { id: "sahara", type: "desert", name: "Central Sahara", country: "Algeria / Niger",
    bbox: [20, 28, 2, 10], note: "One of the driest places on Earth. Tiny rain amounts make percentage changes large and noisy." },
  { id: "sahel", type: "desert", name: "Western Sahel", country: "Mali / Burkina Faso / Niger",
    bbox: [12, 17, -4, 4], note: "The Sahel suffered devastating droughts in the 1970s-80s and has partly 're-greened' since." },
  { id: "amazon", type: "rainforest", name: "Southern Amazon (deforestation arc)", country: "Brazil",
    bbox: [-13, -7, -60, -52], note: "Forest clearing and warming are suspected of drying and lengthening the dry season here." },
  { id: "delhi", type: "city", name: "Delhi & surroundings", country: "India",
    bbox: [27.5, 30, 75.8, 78.5], note: "A megacity of 30+ million on the hot Indo-Gangetic plain, with fierce pre-monsoon heatwaves." },
  { id: "lagos", type: "city", name: "Lagos & coastal Nigeria", country: "Nigeria",
    bbox: [5.5, 8, 2, 5], note: "Africa's largest city, humid and coastal, growing very fast." },
  { id: "chesapeake", type: "estuary", name: "Chesapeake Bay estuary", country: "USA",
    bbox: [37, 40, -77.5, -75], note: "The largest US estuary; river runoff controls its salinity and water quality." },
  { id: "zambezidelta", type: "estuary", name: "Zambezi delta", country: "Mozambique",
    bbox: [-19.5, -17, 35, 37.5], note: "Wetlands and mangroves whose freshwater flows are regulated by upstream dams." },
  { id: "greenland", type: "polar", name: "West Greenland coast", country: "Greenland",
    bbox: [66, 70, -56, -48], note: "The Arctic is warming roughly four times faster than the global average." },
];

export const SITE_TYPES = {
  hydro: "Hydropower basin", desert: "Desert", rainforest: "Rainforest", city: "Big city",
  estuary: "Coast & estuary", polar: "Polar region",
};

/** Rule-based suggestions: which variables are most likely to show interesting trends. */
const TOPIC_VARS = {
  water: ["P_MINUS_ET", "PRECTOTCORR", "EVPTRNS", "GWETROOT"],
  land: ["GWETROOT", "GWETTOP", "P_MINUS_ET", "EVPTRNS"],
  heat: ["T2M", "T2M_MAX", "QV2M", "RH2M"],
  air: ["ALLSKY_SFC_SW_DWN", "CLOUD_AMT", "QV2M", "WS2M"],
};
const PLACE_HINTS = {
  hydro: { P_MINUS_ET: "The net water the basin can give the dam.", PRECTOTCORR: "Rain upstream controls reservoir inflow.", EVPTRNS: "Evaporation losses grow with warming.", T2M: "Warming raises reservoir evaporation.", GWETROOT: "Dry soils absorb rain before it reaches the river." },
  desert: { T2M: "Deserts often warm faster than humid regions because there is little water to evaporate and cool the ground.", RH2M: "Desert air may get even drier as it warms.", PRECTOTCORR: "Rare rain makes trends noisy - a good test of significance!" },
  rainforest: { EVPTRNS: "Forests recycle rain through transpiration; clearing them can reduce it.", PRECTOTCORR: "Researchers report longer dry seasons in parts of the Amazon.", GWETROOT: "Deep soil moisture keeps trees alive in the dry season.", T2M: "Deforested land heats up more." },
  city: { T2M_MAX: "Big cities trap heat (urban heat island), raising afternoon peaks.", T2M: "City growth plus climate warming.", RH2M: "Concrete and fewer plants make city air drier." },
  estuary: { PRECTOTCORR: "Rain in the watershed sets freshwater flow into the estuary.", T2M: "Warmer water holds less oxygen.", P_MINUS_ET: "Net runoff controls salinity." },
  polar: { T2M: "Arctic amplification: the fastest warming on Earth.", CLOUD_AMT: "Clouds change as sea ice retreats.", QV2M: "Warmer Arctic air carries more moisture.", PRECTOTCORR: "More moisture can mean more snow and rain." },
};

export function suggest(topic, siteType) {
  const scores = {}, reasons = {};
  (TOPIC_VARS[topic] || []).forEach((v, i) => { scores[v] = (scores[v] || 0) + (4 - i); });
  Object.entries(PLACE_HINTS[siteType] || {}).forEach(([v, why], i) => {
    scores[v] = (scores[v] || 0) + (3 - Math.min(i, 2));
    reasons[v] = why;
  });
  return Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => ({ id, reason: reasons[id] || "" }));
}
