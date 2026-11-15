"""Shared plumbing for the optional NASA Earthdata observation layers (SMAP, GPM IMERG).

Each layer is a `Service`: it is given a loader that does the slow network step and returns
per-sample regional means. The Service adds what every layer needs - credential/package
checks, a background job with progress, an on-disk cache, and clear error reporting - so
the browser can simply poll /api/<layer>?bbox=... until it gets data.

Needs (all optional; the rest of the app does not):
  * a free NASA Earthdata account  https://urs.earthdata.nasa.gov/
  * EARTHDATA_TOKEN (or EARTHDATA_USERNAME + EARTHDATA_PASSWORD) in the environment
  * pip install earthaccess xarray h5netcdf numpy
"""
import datetime
import hashlib
import json
import os
import threading

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, "data", "cache")


def setup_problem():
    """Human-readable reason Earthdata layers can't be fetched on this machine, or None if they can."""
    has_token = bool(os.environ.get("EARTHDATA_TOKEN"))
    has_login = bool(os.environ.get("EARTHDATA_USERNAME") and os.environ.get("EARTHDATA_PASSWORD"))
    if not (has_token or has_login):
        return ("This layer needs a free NASA Earthdata login. Set the EARTHDATA_TOKEN environment variable "
                "(or EARTHDATA_USERNAME and EARTHDATA_PASSWORD) and restart the server.")
    try:
        import earthaccess, h5netcdf, numpy, xarray  # noqa: F401
    except ImportError as e:
        return f"This layer needs an optional package that is not installed ({e.name}). Run: pip install earthaccess xarray h5netcdf numpy"
    return None


def month_range(first, today=None):
    """[(year, month), ...] from `first` up to the last complete calendar month."""
    today = today or datetime.date.today()
    last = (today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)
    out, (y, m) = [], first
    while (y, m) <= last:
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def monthly_means(samples):
    """samples: [((year, month), value_or_None), ...] -> (['2015-04', ...], [mean_or_None, ...])."""
    acc = {}
    for (y, m), v in samples:
        acc.setdefault((y, m), [])
        if v is not None:
            acc[(y, m)].append(v)
    keys = sorted(acc)
    return [f"{y}-{m:02d}" for y, m in keys], [round(sum(acc[k]) / len(acc[k]), 4) if acc[k] else None for k in keys]


class Service:
    """One observation layer.
    loader(bbox, progress) -> [((year, month), value_or_None), ...]   (slow; runs in a background thread)
    total() -> number of steps the loader will report (for the progress bar)."""

    def __init__(self, tag, source_text, units, loader, total):
        self.tag, self.source_text, self.units, self.loader, self.total = tag, source_text, units, loader, total
        self.cache = CACHE
        self.jobs = {}
        self.lock = threading.Lock()

    def _key(self, bbox):
        b = [round(float(x), 2) for x in bbox]
        key = f"{self.tag}_{b[0]}_{b[1]}_{b[2]}_{b[3]}"
        return key, os.path.join(self.cache, hashlib.sha1(key.encode()).hexdigest()[:16] + ".json"), b

    def _run(self, key, path, bbox):
        job = self.jobs[key]
        try:
            def progress(done, total):
                job["done"], job["total"] = done, total
            times, values = monthly_means(self.loader(bbox, progress))
            if not any(v is not None for v in values):
                raise RuntimeError("no valid pixels were returned for this region.")
            payload = {"source": self.source_text, "units": self.units, "bbox": bbox, "times": times, "values": values}
            os.makedirs(self.cache, exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w") as f:
                json.dump(payload, f, separators=(",", ":"))
            os.replace(tmp, path)
            job["state"] = "done"
        except Exception as e:  # reported to the browser on its next poll
            job["state"], job["error"] = "error", f"{self.tag.upper()} fetch failed: {e}"

    def get(self, bbox):
        """-> (http_status, payload). 200 data | 202 job running | 501 not set up | 502 fetch failed."""
        key, path, b = self._key(bbox)
        if os.path.exists(path):
            with open(path) as f:
                return 200, json.load(f)
        problem = setup_problem()
        if problem:
            return 501, {"error": problem}
        with self.lock:
            job = self.jobs.get(key)
            if job is None:
                job = self.jobs[key] = {"state": "running", "done": 0, "total": self.total()}
                threading.Thread(target=self._run, args=(key, path, b), daemon=True).start()
            if job["state"] == "error":
                del self.jobs[key]          # the next request retries
                return 502, {"error": job["error"]}
            if job["state"] == "done":
                del self.jobs[key]
                if os.path.exists(path):
                    with open(path) as f:
                        return 200, json.load(f)
            return 202, {"status": "running", "done": job["done"], "total": job["total"]}
