"""Optional GPM IMERG rainfall comparison layer for HydroWatch Global.

IMERG (Integrated Multi-satellitE Retrievals for GPM) is NASA's satellite rainfall estimate
(0.1 degree). It is OBSERVATION-based, so it is the natural cross-check for the MERRA-2
reanalysis rainfall used everywhere else in the app. NOTE: MERRA-2's "corrected" rainfall is
itself adjusted using gauge/satellite products, so agreement is reassuring but the two are not
fully independent.

One monthly granule per month (GPM_3IMERGM v07, "Final" run). NASA's catalogue (CMR) lists this v07
collection from January 1998; we start at June 2000, a conservative choice that overlaps the whole
IMERG-era record. Moving FIRST_MONTH back to (1998, 1) is a one-line change. We read only the
region's pixels from each file (HTTP range reads), take the area-weighted mean rain rate and
convert mm/hour to mm/month so it plots on the same axis as MERRA-2.

Setup and the job/caching machinery live in earthobs.py.
NOTE: _load_samples needs a real Earthdata login and has not been run against the live
service. Everything around it is covered by tests/test_imerg.py with a fake loader.
"""
import calendar

import earthobs
from earthobs import monthly_means, month_range, setup_problem  # noqa: F401  (re-exported)

SHORT_NAME, VERSION = "GPM_3IMERGM", "07"
FIRST_MONTH = (2000, 6)       # conservative start; CMR lists v07 monthly data from 1998-01


def months_to_fetch(today=None):
    return month_range(FIRST_MONTH, today)


def to_mm_per_month(rate_mm_per_hour, year, month):
    """Mean rain rate (mm/hour) -> monthly total (mm)."""
    return rate_mm_per_hour * 24 * calendar.monthrange(year, month)[1]


def _load_samples(bbox, progress):
    """Area-weighted regional rainfall (mm/month) for each month."""
    import earthaccess
    import numpy as np
    import xarray as xr

    earthaccess.login(strategy="environment")
    lat0, lat1, lon0, lon1 = bbox
    months = months_to_fetch()
    samples = []
    for i, (y, m) in enumerate(months):
        progress(i, len(months))
        found = earthaccess.search_data(
            short_name=SHORT_NAME, version=VERSION,
            temporal=(f"{y}-{m:02d}-15", f"{y}-{m:02d}-16"),      # mid-month: matches that month's one granule
            bounding_box=(lon0, lat0, lon1, lat1), count=1)
        if not found:
            samples.append(((y, m), None))
            continue
        fobj = earthaccess.open(found[:1])[0]
        with xr.open_dataset(fobj, engine="h5netcdf", decode_times=False) as ds:
            da = ds["precipitation"].sel(lat=slice(lat0, lat1), lon=slice(lon0, lon1))   # reads only the window
            if "time" in da.dims:
                da = da.isel(time=0)
            da = da.transpose("lat", "lon")                   # file layout is (lon, lat); make it explicit
            vals = da.values.astype("float64")
            lats = da["lat"].values
        w = np.cos(np.deg2rad(lats))[:, None]                  # area weight: cells shrink toward the poles
        ok = np.isfinite(vals) & (vals >= 0)
        if ok.sum() < 3:
            samples.append(((y, m), None))
            continue
        rate = float((vals * w * ok).sum() / (w * ok).sum())
        samples.append(((y, m), to_mm_per_month(rate, y, m)))
    progress(len(months), len(months))
    return samples


SERVICE = earthobs.Service(
    tag="imerg",
    source_text=f"GPM IMERG Final monthly ({SHORT_NAME} v{VERSION}, 0.1 degree)",
    units="mm/month",
    loader=lambda bbox, progress: _load_samples(bbox, progress),
    total=lambda: len(months_to_fetch()),
)


def get(bbox):
    return SERVICE.get(bbox)
