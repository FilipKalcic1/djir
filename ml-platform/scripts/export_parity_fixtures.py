"""
Export golden pricing vectors for the mobile app's TypeScript port.

`lib/pricing.ts` must agree with `djir_ml` to the cent. This script prices a
fixed set of trips with the canonical Python code and writes them to
`__tests__/fixtures/pricing-parity.json` in the app:

  * Jest (`__tests__/lib/pricing.test.ts`) asserts the TypeScript heuristic
    reproduces every vector exactly;
  * pytest (`tests/test_parity_fixture.py`) asserts the committed file is still
    what this script produces, so a Python change without a re-export fails CI.

The trips are 30 instants either side of the DST switches, 400 random ones,
and ETA_TIE_TRIPS whose ETA lands on a rounding tie (see `_eta_tie_trips`).
`rounding` holds separate value/digit cases for the TS `pyRound` helper.

Usage (from ml-platform/):
    python scripts/export_parity_fixtures.py
"""

from __future__ import annotations

import datetime as dt
import json
import math
import random
import sys
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ML_ROOT.parent
FIXTURE_PATH = APP_ROOT / "__tests__" / "fixtures" / "pricing-parity.json"

sys.path.insert(0, str(ML_ROOT))

from djir_ml import features, predict, pricing  # noqa: E402
from djir_ml.geo import EARTH_RADIUS_KM  # noqa: E402

UTC = dt.timezone.utc
WEATHERS = ["clear", "rain", "fog", "snow"]

# Inputs for the TS `pyRound` helper's own cases, each at 0, 1 and 2 digits.
# 0.125, 2.5, 3.5, 3.625, 7.375, 9.875 and 16.125 are exact in binary, so at the
# right digit they are true ties: Python rounds them half-to-even, Math.round
# rounds them up. 1.005, 2.675 and 10.005 are NOT exact (1.005 is stored as
# 1.00499999999999989...): Python rounds the stored value, while x * 100 in
# floating point can land on the wrong side of .5 (Python rounds 10.005 to
# 10.01; Math.round(10.005 * 100) / 100 gives 10).
ROUNDING_CASES = [0.125, 2.5, 3.5, 3.625, 7.375, 9.875, 16.125, 1.005, 2.675, 10.005]

# Golden trips whose unrounded ETA sits on a .x5 tie, where Python's
# round(eta, 1) and JavaScript's Math.round(eta * 10) / 10 disagree: a port that
# swapped `pyRound` for Math.round fails the Jest golden test on them.
# The fare cannot be tested this way: for every speed and surge the heuristic
# uses and every whole-metre distance up to 60 km, the two roundings agree on the
# fare (tests/test_parity_fixture.py checks them all).
ETA_TIE_TRIPS = 12


def _iso(when: dt.datetime) -> str:
    return when.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def math_round(x: float, digits: int) -> float:
    """JavaScript's `Math.round(x * 10 ** digits) / 10 ** digits` (ties go up)."""
    scaled = x * 10**digits
    whole = math.floor(scaled)
    return (whole + (scaled - whole >= 0.5)) / 10**digits


def _eta_tie_trips(rng: random.Random) -> list[tuple[tuple, tuple, dt.datetime, str]]:
    """(pickup, dropoff, when, weather) for ETA_TIE_TRIPS trips whose heuristic
    ETA Python's round() and Math.round round differently.

    Distances are searched in whole metres from 1 km up, against one calendar
    slot per distinct heuristic speed. Each trip then runs due north from a
    random pickup, so its distance is exactly those metres, at a random pickup
    time that has the same speed.
    """
    slots_by_speed: dict[float, list[tuple[int, int, str]]] = {}
    for weather in WEATHERS:
        for day in range(7):
            for hour in range(24):
                speed = pricing.expected_speed_kmh(hour, day, weather)
                slots_by_speed.setdefault(speed, []).append((hour, day, weather))

    found: list[tuple[float, list[tuple[int, int, str]]]] = []
    metres = 1000
    while len(found) < ETA_TIE_TRIPS:
        km = metres / 1000
        for slots in slots_by_speed.values():
            hour, day, weather = slots[0]
            eta = pricing.estimate_duration_min(km, hour, day, weather)
            if round(eta, 1) != math_round(eta, 1):
                found.append((km, slots))
        metres += 1

    trips = []
    for km, slots in found[:ETA_TIE_TRIPS]:
        hour, day, weather = rng.choice(slots)
        monday = dt.date(2025, 1, 6) + dt.timedelta(weeks=rng.randrange(104))
        date = monday + dt.timedelta(days=day)
        when = dt.datetime(date.year, date.month, date.day, hour, rng.randrange(60),
                           tzinfo=features.SERVICE_TZ)
        pickup = (round(45.70 + rng.random() * 0.05, 6), round(15.90 + rng.random() * 0.22, 6))
        dropoff = (round(pickup[0] + math.degrees(km / EARTH_RADIUS_KM), 6), pickup[1])
        trips.append((pickup, dropoff, when, weather))
    return trips


def _dst_edge_instants() -> list[dt.datetime]:
    """Instants either side of every CET/CEST switch in 2025-2027 (01:00 UTC)."""
    out = []
    for year in (2025, 2026, 2027):
        for month in (3, 10):
            last_day = dt.date(year, month, 31)
            switch_day = last_day - dt.timedelta(days=(last_day.weekday() + 1) % 7)
            switch = dt.datetime(switch_day.year, switch_day.month, switch_day.day, 1, tzinfo=UTC)
            out += [switch + dt.timedelta(minutes=m) for m in (-61, -1, 0, 59, 61)]
    return out


def build_fixture() -> dict:
    rng = random.Random(20260928)
    instants = _dst_edge_instants()
    start = dt.datetime(2025, 1, 1, tzinfo=UTC)
    instants += [start + dt.timedelta(minutes=rng.randrange(0, 60 * 24 * 365 * 2)) for _ in range(400)]

    inputs = []
    for when in instants:
        # 6 dp (~0.1 m) keeps the fixture short; inputs are exact decimals.
        pickup = (round(45.70 + rng.random() * 0.15, 6), round(15.90 + rng.random() * 0.22, 6))
        dropoff = (round(45.70 + rng.random() * 0.15, 6), round(15.90 + rng.random() * 0.22, 6))
        inputs.append((pickup, dropoff, when, rng.choice(WEATHERS)))
    inputs += _eta_tie_trips(random.Random(20260929))

    trips = []
    for pickup, dropoff, when, weather in inputs:
        feats = features.request_features(*pickup, *dropoff, when, weather)
        quote = predict.heuristic_quote(feats)
        trips.append({
            "pickup": list(pickup),
            "dropoff": list(dropoff),
            "when": _iso(when),
            "weather": weather,
            "hour_of_day": feats["hour_of_day"],
            "day_of_week": feats["day_of_week"],
            "trip_distance_km": feats["trip_distance_km"],
            "eta_minutes": quote["eta_minutes"],
            "surge_multiplier": quote["surge_multiplier"],
            "total_fare_eur": quote["total_fare_eur"],
        })

    cases = [{"value": v, "digits": d, "rounded": round(v, d)} for v in ROUNDING_CASES for d in (0, 1, 2)]
    return {"generated_by": "ml-platform/scripts/export_parity_fixtures.py", "trips": trips, "rounding": cases}


def render(fixture: dict) -> str:
    """Stable, diff-friendly JSON: one trip / rounding case per line."""
    def rows(items: list[dict]) -> str:
        return ",\n".join("    " + json.dumps(item, separators=(",", ":")) for item in items)

    return (
        "{\n"
        f'  "generated_by": {json.dumps(fixture["generated_by"])},\n'
        f'  "trips": [\n{rows(fixture["trips"])}\n  ],\n'
        f'  "rounding": [\n{rows(fixture["rounding"])}\n  ]\n'
        "}\n"
    )


def main() -> None:
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fixture = build_fixture()
    FIXTURE_PATH.write_text(render(fixture), encoding="utf-8", newline="\n")
    print(f"wrote {len(fixture['trips'])} trips + {len(fixture['rounding'])} rounding cases -> {FIXTURE_PATH}")


if __name__ == "__main__":
    main()
