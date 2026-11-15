#!/usr/bin/env python3
"""HydroWatch Global (AquaSentinel) - local server.

Serves the web app and proxies NASA POWER (MERRA-2 based) monthly data with an
on-disk cache, so the browser never has to deal with CORS or rate limits and
demo data keeps working offline once fetched.

Usage:  python3 server.py [--port 8000]
Then open http://localhost:8000
Standard library only - no pip install needed.
"""
import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
CACHE = os.path.join(ROOT, "data", "cache")
POWER = "https://power.larc.nasa.gov/api/temporal/monthly"

# Whitelist of NASA POWER parameters the app is allowed to request.
PARAMS = {
    "PRECTOTCORR", "T2M", "T2M_MAX", "T2M_MIN", "GWETROOT", "GWETTOP",
    "GWETPROF", "EVPTRNS", "RH2M", "QV2M", "WS2M", "ALLSKY_SFC_SW_DWN",
    "CLOUD_AMT", "T2MDEW", "PS",
}
FIRST_YEAR, LAST_YEAR = 1981, 2025


def _clamp_range(lo, hi, vmin, vmax):
    """POWER regional needs a 2..10 degree span; widen/shrink around the centre."""
    lo, hi = min(lo, hi), max(lo, hi)
    c, span = (lo + hi) / 2, hi - lo
    span = min(max(span, 2.0), 10.0)
    lo, hi = c - span / 2, c + span / 2
    if lo < vmin:
        lo, hi = vmin, vmin + span
    if hi > vmax:
        lo, hi = vmax - span, vmax
    return round(lo, 3), round(hi, 3)


def fetch_region(param, lat0, lat1, lon0, lon1, start, end):
    lat0, lat1 = _clamp_range(lat0, lat1, -90, 90)
    lon0, lon1 = _clamp_range(lon0, lon1, -180, 180)
    key = f"{param}_{lat0}_{lat1}_{lon0}_{lon1}_{start}_{end}"
    path = os.path.join(CACHE, hashlib.sha1(key.encode()).hexdigest()[:16] + ".json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f), True

    q = urllib.parse.urlencode({
        "parameters": param, "community": "AG",
        "latitude-min": lat0, "latitude-max": lat1,
        "longitude-min": lon0, "longitude-max": lon1,
        "start": start, "end": end, "format": "JSON",
    })
    req = urllib.request.Request(f"{POWER}/regional?{q}",
                                 headers={"User-Agent": "HydroWatch-Global/1.0"})
    last_err = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                raw = json.load(r)
            break
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            try:
                msg = "; ".join(json.loads(body).get("messages", [])) or body[:300]
            except ValueError:
                msg = body[:300]
            raise ValueError(f"NASA POWER rejected the request: {msg}")
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
            time.sleep(2 * (attempt + 1))
    else:
        raise ConnectionError(f"Could not reach NASA POWER: {last_err}")

    fill = raw.get("header", {}).get("fill_value", -999.0)
    meta = raw.get("parameters", {}).get(param, {})
    times, cells = None, []
    for feat in raw.get("features", []):
        lon, lat = feat["geometry"]["coordinates"][:2]
        series = feat["properties"]["parameter"][param]
        # Drop the annual "YYYY13" entries; keep months 01..12.
        keys = sorted(k for k in series if not k.endswith("13"))
        if times is None:
            times = keys
        vals = [None if (series.get(k) is None or series.get(k) == fill) else series[k]
                for k in times]
        cells.append({"lat": lat, "lon": lon, "v": vals})
    if not cells:
        raise ValueError("NASA POWER returned no grid cells for this region.")

    out = {
        "param": param,
        "units": meta.get("units", ""),
        "longname": meta.get("longname", param),
        "bbox": [lat0, lat1, lon0, lon1],
        "times": [f"{t[:4]}-{t[4:]}" for t in times],
        "cells": cells,
        "source": "NASA POWER " + ", ".join(raw.get("header", {}).get("sources", [])),
        "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    os.makedirs(CACHE, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    os.replace(tmp, path)
    return out, False


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _json(self, code, obj, extra=None):
        body = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/api/region":
            return self.api_region(urllib.parse.parse_qs(u.query))
        if u.path in ("/api/smap", "/api/imerg"):
            return self.api_obs(u.path.rsplit("/", 1)[1], urllib.parse.parse_qs(u.query))
        if u.path == "/api/health":
            return self._json(200, {"ok": True, "years": [FIRST_YEAR, LAST_YEAR]})
        return super().do_GET()

    def api_obs(self, layer, qs):
        """Optional NASA Earthdata observation layers: 'smap' (smap.py) or 'imerg' (imerg.py)."""
        try:
            bbox = [float(x) for x in qs.get("bbox", [""])[0].split(",")]
            if len(bbox) != 4 or bbox[0] >= bbox[1] or bbox[2] >= bbox[3] or bbox[1] - bbox[0] > 10.5 or bbox[3] - bbox[2] > 10.5:
                raise ValueError("bbox must be latMin,latMax,lonMin,lonMax with each side at most 10 degrees.")
            module = __import__(layer)           # layer is whitelisted by do_GET: smap or imerg
            code, payload = module.get(bbox)
            self._json(code, payload)
        except ValueError as e:
            self._json(400, {"error": str(e)})
        except Exception as e:  # pragma: no cover
            self._json(500, {"error": f"Server error: {e}"})

    def api_region(self, qs):
        try:
            param = qs.get("param", [""])[0].upper()
            if param not in PARAMS:
                raise ValueError(f"Unknown parameter '{param}'.")
            bbox = [float(x) for x in qs.get("bbox", [""])[0].split(",")]
            if len(bbox) != 4:
                raise ValueError("bbox must be latMin,latMax,lonMin,lonMax")
            start = int(qs.get("start", [FIRST_YEAR])[0])
            end = int(qs.get("end", [LAST_YEAR])[0])
            start = max(FIRST_YEAR, min(start, LAST_YEAR))
            end = max(start, min(end, LAST_YEAR))
            data, cached = fetch_region(param, *bbox, start, end)
            self._json(200, data, {"X-Cache": "HIT" if cached else "MISS"})
        except ValueError as e:
            self._json(400, {"error": str(e)})
        except ConnectionError as e:
            self._json(502, {"error": str(e)})
        except Exception as e:  # pragma: no cover
            self._json(500, {"error": f"Server error: {e}"})


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--open", action="store_true", help="open the app in a web browser")
    a = ap.parse_args()
    srv = None
    for port in range(a.port, a.port + 20):
        try:
            srv = ThreadingHTTPServer((a.host, port), Handler)
            break
        except OSError as e:
            if e.errno not in (98, 48, 10048):  # address already in use (Linux/macOS/Windows)
                raise
            print(f"Port {port} is busy, trying {port + 1}...", flush=True)
    if srv is None:
        sys.exit(f"No free port between {a.port} and {a.port + 19}. Try: python3 server.py --port 9000")
    url = f"http://localhost:{srv.server_address[1]}"
    print(f"HydroWatch Global running at {url}  (Ctrl+C to stop)", flush=True)
    if a.open:
        import threading
        import webbrowser
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
