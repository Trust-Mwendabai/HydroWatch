"""Offline tests for the optional Earthdata layers (SMAP, GPM IMERG) and their shared service.
The network step is replaced by a fake loader.   Run from the project folder:
    python -m unittest discover -s tests -p "test_*.py" """
import datetime
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import earthobs  # noqa: E402
import imerg  # noqa: E402
import smap  # noqa: E402


class MonthlyMeans(unittest.TestCase):
    def test_averages_samples_within_a_month(self):
        t, v = earthobs.monthly_means([((2015, 4), 0.20), ((2015, 4), 0.30), ((2015, 5), 0.10)])
        self.assertEqual(t, ["2015-04", "2015-05"])
        self.assertEqual(v, [0.25, 0.10])

    def test_missing_days_are_skipped_not_zero(self):
        _, v = earthobs.monthly_means([((2015, 4), None), ((2015, 4), 0.2), ((2015, 5), None)])
        self.assertEqual(v, [0.2, None])

    def test_sorted_by_month(self):
        t, _ = earthobs.monthly_means([((2016, 1), 0.1), ((2015, 12), 0.1)])
        self.assertEqual(t, ["2015-12", "2016-01"])


class Schedules(unittest.TestCase):
    def test_smap_starts_april_2015_and_stops_at_last_complete_month(self):
        days = smap.months_to_fetch(datetime.date(2015, 6, 10))
        self.assertEqual(days[0][:2], (2015, 4))
        self.assertEqual({d[:2] for d in days}, {(2015, 4), (2015, 5)})
        self.assertEqual(len(days), 2 * len(smap.SAMPLE_DAYS))

    def test_january_rolls_back_to_december(self):
        self.assertEqual(max(earthobs.month_range((2015, 4), datetime.date(2016, 1, 5))), (2015, 12))

    def test_imerg_starts_june_2000_one_granule_per_month(self):
        months = imerg.months_to_fetch(datetime.date(2000, 9, 1))
        self.assertEqual(months, [(2000, 6), (2000, 7), (2000, 8)])


class Units(unittest.TestCase):
    def test_imerg_rate_to_monthly_total(self):
        self.assertAlmostEqual(imerg.to_mm_per_month(0.1, 2021, 4), 0.1 * 24 * 30)
        self.assertAlmostEqual(imerg.to_mm_per_month(0.1, 2024, 2), 0.1 * 24 * 29)   # leap year


class SetupMessages(unittest.TestCase):
    def test_no_credentials(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertIn("EARTHDATA_TOKEN", earthobs.setup_problem())

    def test_missing_package_is_named(self):
        real_import = __import__

        def fake(name, *a, **k):
            if name == "earthaccess":
                raise ImportError("nope", name="earthaccess")
            return real_import(name, *a, **k)
        with mock.patch.dict(os.environ, {"EARTHDATA_TOKEN": "x"}, clear=True), mock.patch("builtins.__import__", fake):
            self.assertIn("earthaccess", earthobs.setup_problem())


class JobFlow(unittest.TestCase):
    """Same behaviour must hold for every layer, so run each test against both services."""
    BBOX = [-17.0, -11.0, 20.0, 27.0]

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.services = [smap.SERVICE, imerg.SERVICE]
        self.patches = [mock.patch.object(s, "cache", self.tmp.name) for s in self.services]
        self.patches.append(mock.patch.object(earthobs, "setup_problem", return_value=None))
        for p in self.patches:
            p.start()
        for s in self.services:
            s.jobs.clear()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def wait_for(self, svc, want):
        for _ in range(200):
            code, payload = svc.get(self.BBOX)
            if code == want:
                return payload
            time.sleep(0.02)
        self.fail(f"{svc.tag}: never reached status {want}; last was {code} {payload}")

    def test_background_job_then_cache(self):
        for svc in self.services:
            calls = []

            def fake_loader(bbox, progress, calls=calls):
                calls.append(bbox)
                progress(1, 2)
                return [((2015, 4), 0.21), ((2015, 4), 0.23), ((2015, 5), 0.30)]
            with mock.patch.object(svc, "loader", fake_loader):
                self.assertEqual(svc.get(self.BBOX)[0], 202)        # job started, browser should poll
                data = self.wait_for(svc, 200)
                self.assertEqual(data["times"], ["2015-04", "2015-05"])
                self.assertEqual(data["values"], [0.22, 0.3])
                self.assertEqual(data["units"], svc.units)
                svc.get(self.BBOX); svc.get(self.BBOX)
                self.assertEqual(len(calls), 1, f"{svc.tag}: later requests must come from the cache")

    def test_layers_do_not_share_cache_entries(self):
        with mock.patch.object(smap.SERVICE, "loader", lambda b, p: [((2015, 4), 0.2)]), \
             mock.patch.object(imerg.SERVICE, "loader", lambda b, p: [((2015, 4), 90.0)]):
            smap.SERVICE.get(self.BBOX); imerg.SERVICE.get(self.BBOX)
            self.assertEqual(self.wait_for(smap.SERVICE, 200)["values"], [0.2])
            self.assertEqual(self.wait_for(imerg.SERVICE, 200)["values"], [90.0])

    def test_failure_is_reported_then_retried(self):
        svc = imerg.SERVICE

        def boom(bbox, progress):
            raise RuntimeError("login rejected")
        with mock.patch.object(svc, "loader", boom):
            svc.get(self.BBOX)
            self.assertIn("login rejected", self.wait_for(svc, 502)["error"])
        with mock.patch.object(svc, "loader", lambda b, p: [((2015, 4), 1.0)]):
            self.assertEqual(svc.get(self.BBOX)[0], 202)             # retry starts a fresh job
            self.wait_for(svc, 200)

    def test_region_without_valid_pixels_is_an_error(self):
        with mock.patch.object(smap.SERVICE, "loader", lambda b, p: [((2015, 4), None)]):
            smap.SERVICE.get(self.BBOX)
            self.assertIn("no valid", self.wait_for(smap.SERVICE, 502)["error"])

    def test_not_set_up_returns_501_and_starts_nothing(self):
        with mock.patch.object(earthobs, "setup_problem", return_value="set EARTHDATA_TOKEN"), \
             mock.patch.object(imerg.SERVICE, "loader", side_effect=AssertionError("must not run")):
            self.assertEqual(imerg.SERVICE.get(self.BBOX), (501, {"error": "set EARTHDATA_TOKEN"}))


if __name__ == "__main__":
    unittest.main()
