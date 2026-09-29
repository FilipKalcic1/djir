"""
djir_ml.features
================
Turns a *raw ride request* (two coordinates + a timestamp) into the exact
feature dictionary the models expect.

This is the contract that has to match in three places: training (so the model
learns on these columns), the FastAPI/Databricks serving layer (so it scores on
the same columns) and the mobile app's TypeScript fallback (`lib/pricing.ts`).
The golden fixture written by `scripts/export_parity_fixtures.py` keeps the
TypeScript port honest: Jest asserts it reproduces these numbers to the cent.
"""

from __future__ import annotations

import datetime as _dt
from zoneinfo import ZoneInfo

from . import pricing
from .geo import haversine_km, nearest_zone

# Rides are priced on the Zagreb wall clock, whatever timezone the caller or
# the server runs in. The app sends UTC instants (`Date.toISOString()`).
SERVICE_TZ = ZoneInfo("Europe/Zagreb")


def to_service_time(when: _dt.datetime) -> _dt.datetime:
    """Return `when` as a naive Zagreb wall-clock datetime.

    Aware datetimes (e.g. the app's "...Z" timestamps) are converted. Naive
    datetimes are taken to be Zagreb local already — that is what the
    simulator, the notebooks and the training data use.
    """
    if when.tzinfo is None:
        return when
    return when.astimezone(SERVICE_TZ).replace(tzinfo=None)


def request_features(
    pickup_lat: float,
    pickup_lng: float,
    dropoff_lat: float,
    dropoff_lng: float,
    when: _dt.datetime,
    weather: str = "clear",
) -> dict:
    """Build the superset of features needed by BOTH the ETA and surge models.

    `when` may be aware (converted to Zagreb time) or naive (already Zagreb
    time). `weather` defaults to "clear" when the caller has no live weather
    (the app does not, today — see ADR-005).
    """
    local = to_service_time(when)
    hour = int(local.hour)
    dow = int(local.weekday())  # Monday=0 … Sunday=6 (matches pandas dayofweek)

    distance = haversine_km(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
    return {
        "trip_distance_km": round(distance, 3),
        "hour_of_day": hour,
        "day_of_week": dow,
        "is_weekend": pricing.is_weekend(dow),
        "is_rush_hour": pricing.is_rush_hour(hour, dow),
        "traffic_density": round(pricing.traffic_density(hour, dow), 3),
        "pickup_zone": nearest_zone(pickup_lat, pickup_lng),
        "dropoff_zone": nearest_zone(dropoff_lat, dropoff_lng),
        "weather_condition": weather if weather in pricing.WEATHER else "clear",
    }
