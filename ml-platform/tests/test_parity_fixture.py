"""The committed TS parity fixture must be what the exporter produces today.

If this fails, the Python pricing changed: run
    python scripts/export_parity_fixtures.py
and let the Jest parity test tell you what to change in lib/pricing.ts.
"""

import importlib.util
import json
import os
from decimal import ROUND_HALF_UP, Decimal

import numpy as np
import pytest

from djir_ml import pricing

ML_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _exporter():
    path = os.path.join(ML_ROOT, "scripts", "export_parity_fixtures.py")
    spec = importlib.util.spec_from_file_location("export_parity_fixtures", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_r25_committed_fixture_is_up_to_date():
    exporter = _exporter()
    expected = exporter.render(exporter.build_fixture())
    committed = exporter.FIXTURE_PATH.read_text(encoding="utf-8")
    assert committed == expected


@pytest.mark.parametrize(
    "doc", ["README.md", "ml-platform/README.md", "docs/architecture.md", "docs/REVIEW.md"]
)
def test_r25_docs_count_what_the_fixture_holds(doc):
    exporter = _exporter()
    fixture = json.loads(exporter.FIXTURE_PATH.read_text(encoding="utf-8"))
    text = (exporter.APP_ROOT / doc).read_text(encoding="utf-8")
    assert f"{len(fixture['trips'])} golden trips" in text
    assert f"{exporter.ETA_TIE_TRIPS} with an ETA on a rounding tie" in text
    assert f"{len(fixture['rounding'])} rounding cases" in text


def test_r25_golden_trips_catch_a_math_round_eta():
    # A TS port that rounded the ETA with Math.round(eta * 10) / 10, or with
    # toFixed(1), instead of pyRound must fail the Jest golden test.
    exporter = _exporter()
    trips = json.loads(exporter.FIXTURE_PATH.read_text(encoding="utf-8"))["trips"]
    math_round_misses, to_fixed_misses = 0, 0
    for trip in trips:
        eta = pricing.estimate_duration_min(
            trip["trip_distance_km"], trip["hour_of_day"], trip["day_of_week"], trip["weather"]
        )
        assert round(eta, 1) == trip["eta_minutes"]
        math_round_misses += exporter.math_round(eta, 1) != trip["eta_minutes"]
        # toFixed rounds the exact stored value, half up: it only errs on exact ties.
        to_fixed = float(Decimal(eta).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
        to_fixed_misses += to_fixed != trip["eta_minutes"]
    assert math_round_misses >= exporter.ETA_TIE_TRIPS
    assert to_fixed_misses >= 1


def test_r25_no_trip_fare_is_a_rounding_tie():
    # Why the golden rounding ties are all in the ETA: for every speed and surge
    # the heuristic uses and every whole-metre trip up to 60 km (the app's
    # MAX_TRIP_KM), Math.round and Python's round agree on the fare. If a pricing
    # change breaks this, add golden trips on a fare tie, as for the ETA.
    exporter = _exporter()
    slots = {}  # one calendar slot per distinct (speed, surge) pair
    for w in exporter.WEATHERS:
        for d in range(7):
            for h in range(24):
                key = (pricing.expected_speed_kmh(h, d, w), pricing.heuristic_surge(h, d, w))
                slots.setdefault(key, (h, d, w))

    def fare(metres, slot):  # unrounded, as predict.heuristic_quote computes it (Python floats)
        km = metres / 1000
        eta = max(1.5, pricing.estimate_duration_min(km, *slot))
        return max(pricing.MIN_FARE_EUR, pricing.base_fare(km, eta) * pricing.heuristic_surge(*slot))

    metres = np.arange(1, 60_001)
    km = metres / 1000
    disagreements = []
    for (speed, surge), slot in slots.items():
        # The same float operations, vectorised, to find near-ties quickly...
        eta = np.maximum(1.5, km / speed * 60.0 + pricing.PICKUP_OVERHEAD_MIN)
        fares = np.maximum(
            pricing.MIN_FARE_EUR,
            (pricing.BASE_FARE_EUR + pricing.PER_KM_EUR * km + pricing.PER_MIN_EUR * eta) * surge,
        )
        assert [float(fares[m - 1]) for m in (1, 2925, 60_000)] == [fare(m, slot) for m in (1, 2925, 60_000)]
        cents = fares * 100
        near = metres[np.abs(cents - np.floor(cents) - 0.5) < 1e-6]  # float error is ~1e-12
        # ...then the scalar pricing code, with Python's round(), decides each one.
        for m in near.tolist():
            x = fare(m, slot)
            if round(x, 2) != exporter.math_round(x, 2):
                disagreements.append((slot, m, x))
    assert slots
    assert disagreements == []
