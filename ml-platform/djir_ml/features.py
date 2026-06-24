"""
djir_ml.features
================
Turns a *raw ride request* (two coordinates + a timestamp) into the exact
feature dictionary the models expect.

This is the contract that has to match in three places: training (so the model
learns on these columns), the FastAPI/Databricks serving layer (so it scores on
the same columns) and the mobile app's TypeScript fallback (a literal port of
`request_features`). If you change a derivation here, change it in
`lib/pricing.ts` too — the docstring there points back at this file.
"""

from __future__ import annotations

import datetime as _dt

from . import pricing
from .geo import haversine_km, nearest_zone


def request_features(
    pickup_lat: float,
    pickup_lng: float,
    dropoff_lat: float,
    dropoff_lng: float,
    when: _dt.datetime,
    weather: str = "clear",
) -> dict:
    """Build the superset of features needed by BOTH the ETA and surge models.

    `when` is the local Zagreb request time. `weather` defaults to "clear" when
    the caller has no live weather (the app does not, today — see ADR-005).
    """
    hour = int(when.hour)
    dow = int(when.weekday())  # Monday=0 … Sunday=6 (matches pandas dayofweek)

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
