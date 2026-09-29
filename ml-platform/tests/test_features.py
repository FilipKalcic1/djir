"""The feature contract: request -> model features, on the Zagreb wall clock."""

import datetime as dt

import pandas as pd
import pytest

from djir_ml import features, train
from djir_ml.config import ETA_TARGET, SURGE_TARGET

TRESNJEVKA = (45.8000, 15.9450)
DONJI_GRAD = (45.8085, 15.9775)


def feats(when, weather="clear"):
    return features.request_features(*TRESNJEVKA, *DONJI_GRAD, when, weather)


@pytest.mark.parametrize(
    "when, hour, dow, rush",
    [
        # The app sends UTC instants: 06:15Z in June is 08:15 CEST, rush hour.
        ("2025-06-03T06:15:00Z", 8, 1, 1),
        # 06:15Z in January is 07:15 CET, also rush hour.
        ("2025-01-07T06:15:00Z", 7, 1, 1),
        # Friday 23:30Z in summer is already Saturday 01:30 in Zagreb.
        ("2025-06-06T23:30:00Z", 1, 5, 0),
        # An explicit +02:00 offset is honoured too.
        ("2025-06-03T08:15:00+02:00", 8, 1, 1),
    ],
)
def test_r06_aware_instants_are_read_on_the_zagreb_clock(when, hour, dow, rush):
    f = feats(dt.datetime.fromisoformat(when))
    assert (f["hour_of_day"], f["day_of_week"], f["is_rush_hour"]) == (hour, dow, rush)


def test_naive_datetimes_are_already_zagreb_local():
    # The simulator, notebooks and training data all use naive local times.
    f = feats(dt.datetime(2025, 6, 3, 8, 15))
    assert (f["hour_of_day"], f["is_rush_hour"]) == (8, 1)


@pytest.mark.parametrize(
    "utc, local_hour",
    [
        ("2026-03-29T00:59:00Z", 1),  # last minute of CET
        ("2026-03-29T01:00:00Z", 3),  # 02:00 does not exist
        ("2026-10-25T00:30:00Z", 2),  # first 02:30 (CEST)
        ("2026-10-25T01:30:00Z", 2),  # second 02:30 (CET)
    ],
)
def test_r06_dst_switches(utc, local_hour):
    assert features.to_service_time(dt.datetime.fromisoformat(utc)).hour == local_hour


@pytest.mark.parametrize("weather", ["storm", "Rain", ""])
def test_unknown_weather_is_priced_as_clear(weather):
    assert feats(dt.datetime(2025, 6, 3, 14), weather)["weather_condition"] == "clear"


def test_r11_prepare_accepts_the_databricks_feature_table_without_payment_status():
    # Notebook 04's table: Silver already dropped cancelled rides (R11).
    df = pd.DataFrame({
        "requested_at": pd.to_datetime(["2025-01-02", "2025-01-01"]),
        ETA_TARGET: [10.0, 12.0],
        SURGE_TARGET: [1.1, 1.3],
        "fare_amount_eur": [7.0, 9.0],
    })
    out = train.prepare(df)
    assert list(out[ETA_TARGET]) == [12.0, 10.0]  # sorted by time


def test_r11_prepare_drops_cancelled_rides_when_the_status_is_present():
    df = pd.DataFrame({
        "requested_at": pd.to_datetime(["2025-01-01", "2025-01-02"]),
        "payment_status": ["paid", "cancelled"],
        ETA_TARGET: [10.0, None],
        SURGE_TARGET: [1.1, 1.2],
        "fare_amount_eur": [7.0, None],
    })
    assert len(train.prepare(df)) == 1
