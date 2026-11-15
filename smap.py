"""Optional SMAP soil-moisture comparison layer for HydroWatch Global.

SMAP (Soil Moisture Active Passive) is a NASA satellite. Its data is OBSERVED, unlike the
MERRA-2 soil moisture that NASA POWER serves (modelled), so the app overlays it on the
MERRA-2 chart as a sanity check. The record starts in April 2015 (about 10 years).

Setup and the job/caching machinery live in earthobs.py. For each month we sample a few days
of the SMAP Enhanced L3 9 km daily product (SPL3SMP_E v006), read ONLY the pixels inside the
region (granules are streamed with HTTP range reads, never downloaded whole), average them,
then average the samples within the month.

NOTE: _load_samples needs a real Earthdata login and has not been run against the live
service. Everything around it is covered by tests/test_smap.py with a fake loader.
"""
import earthobs
from earthobs import monthly_means, month_range, setup_problem  # noqa: F401  (re-exported)

SHORT_NAME, VERSION = "SPL3SMP_E", "006"
GROUP = "Soil_Moisture_Retrieval_Data_AM"   # 6 am overpass: least affected by daytime heating
FIRST_MONTH = (2015, 4)                     # first full month of SMAP radiometer data
SAMPLE_DAYS = (8, 22)                       # days of the month to sample (fewer = faster, noisier)
MIN_PIXELS = 3                              # ignore days with fewer valid pixels in the region


def months_to_fetch(today=None):
    """[(year, month, day), ...] sample days from FIRST_MONTH up to the last complete month."""
    return [(y, m, d) for y, m in month_range(FIRST_MONTH, today) for d in SAMPLE_DAYS]


def _load_samples(bbox, progress):
    """Regional-mean SMAP soil moisture (m3/m3) for each sample day."""
    import earthaccess
    import numpy as np
    import xarray as xr

    earthaccess.login(strategy="environment")
    lat0, lat1, lon0, lon1 = bbox
    days = months_to_fetch()
    window = None          # (row slice, col slice, mask) - EASE-Grid 2.0 geometry is identical in every granule
    samples = []
    for i, (y, m, d) in enumerate(days):
        progress(i, len(days))
        found = earthaccess.search_data(
            short_name=SHORT_NAME, version=VERSION,
            temporal=(f"{y}-{m:02d}-{d:02d}", f"{y}-{m:02d}-{d:02d}T23:59:59"),
            bounding_box=(lon0, lat0, lon1, lat1), count=1)
        if not found:
            samples.append(((y, m), None))
            continue
        fobj = earthaccess.open(found[:1])[0]
        with xr.open_dataset(fobj, group=GROUP, engine="h5netcdf", phony_dims="sort") as ds:
            sm = ds["soil_moisture"]
            if window is None:
                la, lo = ds["latitude"].values, ds["longitude"].values
                inside = (la >= lat0) & (la <= lat1) & (lo >= lon0) & (lo <= lon1) & (la > -1000)
                rows, cols = np.where(inside.any(axis=1))[0], np.where(inside.any(axis=0))[0]
                if not len(rows) or not len(cols):
                    raise RuntimeError("this region has no SMAP pixels (check the bounding box).")
                rs, cs = slice(rows.min(), rows.max() + 1), slice(cols.min(), cols.max() + 1)
                window = (rs, cs, inside[rs, cs])
            rs, cs, mask = window
            vals = sm.isel({sm.dims[0]: rs, sm.dims[1]: cs}).values[mask]   # reads only the window
        vals = vals[(vals > 0) & (vals < 1)]                                 # drop fill values (-9999)
        samples.append(((y, m), float(vals.mean()) if len(vals) >= MIN_PIXELS else None))
    progress(len(days), len(days))
    return samples


SERVICE = earthobs.Service(
    tag="smap",
    source_text=f"SMAP {SHORT_NAME} v{VERSION} (9 km, daily, 6 am), {len(SAMPLE_DAYS)} sample days/month",
    units="m3/m3",
    loader=lambda bbox, progress: _load_samples(bbox, progress),
    total=lambda: len(months_to_fetch()),
)


def get(bbox):
    return SERVICE.get(bbox)
