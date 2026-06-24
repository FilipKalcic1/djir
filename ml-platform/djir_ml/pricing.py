"""
djir_ml.pricing
===============
The deterministic "physics + money" of a Djir ride.

This module is the canonical, dependency-free implementation of:
  * how congested the roads are at a given time   -> traffic_density()
  * how fast you actually move                     -> expected_speed_kmh()
  * how long a trip of a given distance takes      -> estimate_duration_min()
  * what that trip costs                            -> base_fare() / total_fare()

The data simulator uses these to GENERATE the labels the ML models learn, and
the serving layer (and the mobile app's TypeScript port) uses the SAME functions
as a fallback when a trained model is unavailable. One implementation, zero
drift between "how the data was made" and "how we price when the model is down".
"""

from __future__ import annotations

from .config import (
    BASE_FARE_EUR,
    BASE_SPEED_KMH,
    EVENING_RUSH,
    MIN_FARE_EUR,
    MORNING_RUSH,
    NAIVE_SPEED_KMH,
    PER_KM_EUR,
    PER_MIN_EUR,
    PICKUP_OVERHEAD_MIN,
    RUSH_SPEED_KMH,
    SURGE_MAX,
    SURGE_MIN,
    WEATHER,
)


def is_weekend(day_of_week: int) -> int:
    """day_of_week: Monday=0 … Sunday=6."""
    return int(day_of_week >= 5)


def is_rush_hour(hour: int, day_of_week: int) -> int:
    """Peak congestion only happens on weekday mornings/evenings."""
    if is_weekend(day_of_week):
        return 0
    in_morning = MORNING_RUSH[0] <= hour <= MORNING_RUSH[1]
    in_evening = EVENING_RUSH[0] <= hour <= EVENING_RUSH[1]
    return int(in_morning or in_evening)


def traffic_density(hour: int, day_of_week: int) -> float:
    """A 0..1 congestion index. Deterministic from the calendar.

    Weekday rush hours are worst; deep night is clear; weekends sit in between
    with a mild Friday/Saturday-night bump.
    """
    weekend = is_weekend(day_of_week)

    if is_rush_hour(hour, day_of_week):
        return 0.92
    if 10 <= hour <= 15:                       # midday
        return 0.45 if not weekend else 0.40
    if 20 <= hour <= 23:                       # evening out
        return 0.55 if weekend else 0.45
    if 0 <= hour <= 5:                         # deep night
        return 0.12
    # shoulders (6, early morning / late evening)
    return 0.35


def expected_speed_kmh(hour: int, day_of_week: int, weather: str) -> float:
    """Average door-to-door speed given congestion and weather."""
    td = traffic_density(hour, day_of_week)
    speed = BASE_SPEED_KMH - (BASE_SPEED_KMH - RUSH_SPEED_KMH) * td
    speed *= WEATHER.get(weather, WEATHER["clear"])["speed_factor"]
    return max(6.0, speed)


def estimate_duration_min(distance_km: float, hour: int, day_of_week: int, weather: str) -> float:
    """Deterministic ETA: travel time at the expected speed + fixed overhead.

    This is the *informed* heuristic — it knows about congestion and weather.
    It is what the serving layer falls back to when no model is loaded.
    """
    speed = expected_speed_kmh(hour, day_of_week, weather)
    return distance_km / speed * 60.0 + PICKUP_OVERHEAD_MIN


def naive_duration_min(distance_km: float) -> float:
    """The *naive* ETA a typical app uses: one flat average speed, blind to the
    time of day and the weather. Used only as the ML baseline to quantify how
    much accuracy the model's congestion/weather awareness actually buys.
    """
    return distance_km / NAIVE_SPEED_KMH * 60.0 + PICKUP_OVERHEAD_MIN


def heuristic_surge(hour: int, day_of_week: int, weather: str) -> float:
    """A model-free surge estimate, used when no trained model is available.

    Deliberately simple and side-effect-free so it can be ported verbatim to the
    mobile app's TypeScript fallback. It encodes the same intuitions the data was
    built on (rush hours, weekend nights and bad weather push surge up) without
    needing live demand/supply numbers.
    """
    weekend = is_weekend(day_of_week)
    surge = 1.0
    if is_rush_hour(hour, day_of_week):
        surge += 0.4
    if weekend and (hour >= 21 or hour <= 3):
        surge += 0.3
    surge += {"clear": 0.0, "fog": 0.1, "rain": 0.2, "snow": 0.4}.get(weather, 0.0)
    surge = min(SURGE_MAX, max(SURGE_MIN, surge))
    return round(surge * 20) / 20.0  # round to nearest 0.05


def base_fare(distance_km: float, duration_min: float) -> float:
    """Pre-surge fare: a startup charge plus per-km and per-minute components."""
    return BASE_FARE_EUR + PER_KM_EUR * distance_km + PER_MIN_EUR * duration_min


def total_fare(base: float, surge_multiplier: float) -> float:
    """Apply surge and the minimum-fare floor, rounded to the cent."""
    surge = min(SURGE_MAX, max(SURGE_MIN, surge_multiplier))
    return round(max(MIN_FARE_EUR, base * surge), 2)
