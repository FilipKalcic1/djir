"""
djir_ml.simulate
================
A realistic ride-event generator for Zagreb.

The whole ML story only holds up if the synthetic data has *learnable structure*
rather than random noise. So the generator models the real forces behind a
ride-hailing market:

  * a double-peaked weekday demand curve (08:00 + 17:00 commutes), a Friday/
    Saturday bump and quiet Sundays;
  * directional commute FLOWS — residential zones -> centre in the morning,
    centre -> residential in the evening, nightlife zones busy late on weekends;
  * weather sampled per day, which both slows traffic (longer ETAs) and raises
    demand (more surge);
  * an inelastic driver SUPPLY that does not chase every spike, so demand
    routinely outruns supply during predictable windows -> predictable surge,
    plus Poisson noise for realism;
  * a small share of cancelled rides with missing duration/fare, so the Silver
    layer has real data-quality work to do.

Targets the models will learn:
  * duration_min     (ETA regression)
  * surge_multiplier (dynamic-pricing regression)

Everything monetary is in EUR.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import pricing
from .config import (
    BASE_FARE_EUR,
    PER_KM_EUR,
    PER_MIN_EUR,
    RANDOM_SEED,
    SURGE_MAX,
    SURGE_MIN,
    WEATHER,
    WEATHER_CONDITIONS,
    ZONE_NAMES,
    ZONES,
)
from .geo import haversine_km

# Relative weekday demand by hour of day (index 0..23). Double commute peak.
_HOURLY_DEMAND = np.array([
    0.20, 0.10, 0.06, 0.05, 0.06, 0.15, 0.45, 0.95,   # 0..7
    1.30, 0.90, 0.70, 0.75, 0.85, 0.80, 0.78, 0.85,   # 8..15
    1.15, 1.45, 1.30, 1.00, 0.85, 0.80, 0.70, 0.45,   # 16..23
])

# Monday=0 … Sunday=6
_DOW_FACTOR = np.array([1.00, 0.98, 1.00, 1.05, 1.25, 1.18, 0.78])

# Per-day weather demand multiplier is applied on top.
_KM_PER_DEG_LAT = 111.0  # rough, used only to convert a metric jitter to degrees

# Coordinate jitter inside a zone (~0.6 km standard deviation).
_JITTER_KM = 0.6

# Supply model: baseline drivers available in a zone scale with the zone's
# origin weight; supply follows a *smooth* daily shape that deliberately does
# NOT spike as hard as demand, so rush/nightlife/bad-weather windows surge.
_SUPPLY_HOURLY = np.array([
    0.25, 0.18, 0.15, 0.13, 0.14, 0.22, 0.45, 0.70,   # 0..7
    0.80, 0.78, 0.72, 0.72, 0.75, 0.74, 0.72, 0.74,   # 8..15
    0.82, 0.85, 0.82, 0.72, 0.65, 0.60, 0.50, 0.35,   # 16..23
])
_SURGE_GAIN = 1.10          # how hard surge reacts to demand-pressure above normal
_CANCEL_RATE = 0.035


def _pickup_factor(zone: dict, hour: int, weekend: bool) -> float:
    morning = (not weekend) and (7 <= hour <= 9)
    evening = (not weekend) and (16 <= hour <= 19)
    weekend_night = weekend and (hour >= 21 or hour <= 3)
    if morning:
        return 1.0 + 1.5 * zone["residential"]      # leaving home
    if evening:
        return 1.0 + 1.0 * (1.0 - zone["residential"])  # leaving work/centre
    if weekend_night:
        return 1.0 + 1.0 * zone["nightlife"]        # leaving the bars
    return 1.0


def _dropoff_factor(zone: dict, hour: int, weekend: bool) -> float:
    morning = (not weekend) and (7 <= hour <= 9)
    evening = (not weekend) and (16 <= hour <= 19)
    going_out = weekend and (20 <= hour <= 23)
    if morning:
        return 1.0 + 1.5 * (1.0 - zone["residential"])  # commuting into centre
    if evening:
        return 1.0 + 1.2 * zone["residential"]          # heading home
    if going_out:
        return 1.0 + 1.2 * zone["nightlife"]            # heading to nightlife
    return 1.0


def _seasonal_temp_c(day_of_year: int, rng: np.random.Generator) -> float:
    """A simple Zagreb-ish seasonal temperature curve (coldest ~mid-January)."""
    mean = 12.0 - 12.0 * np.cos(2 * np.pi * (day_of_year - 15) / 365.0)
    return round(float(mean + rng.normal(0, 3.0)), 1)


def generate(
    n_days: int = 120,
    start_date: str = "2025-01-01",
    target_rides: int = 65_000,
    n_drivers: int = 60,
    n_users: int = 4_000,
    seed: int = RANDOM_SEED,
) -> pd.DataFrame:
    """Generate a ride-event history and return it as a tidy DataFrame."""
    rng = np.random.default_rng(seed)
    start = pd.Timestamp(start_date)

    zone_names = np.array(ZONE_NAMES)
    origin_w = np.array([ZONES[z]["origin_w"] for z in ZONE_NAMES])
    attractor_w = np.array([ZONES[z]["attractor_w"] for z in ZONE_NAMES])
    centroid_lat = {z: ZONES[z]["lat"] for z in ZONE_NAMES}
    centroid_lng = {z: ZONES[z]["lng"] for z in ZONE_NAMES}

    # ── Pass 1: weather per day + an unscaled demand grid (day × hour) ────────
    day_weather: list[str] = []
    w_probs = np.array([WEATHER[w]["probability"] for w in WEATHER_CONDITIONS])
    w_probs = w_probs / w_probs.sum()
    lam = np.zeros((n_days, 24))
    for d in range(n_days):
        date = start + pd.Timedelta(days=d)
        dow = date.dayofweek
        weather = rng.choice(WEATHER_CONDITIONS, p=w_probs)
        day_weather.append(weather)
        wdem = WEATHER[weather]["demand_factor"]
        lam[d] = _HOURLY_DEMAND * _DOW_FACTOR[dow] * wdem

    # Scale so the expected total number of rides matches `target_rides`.
    lam *= target_rides / lam.sum()

    # ── Pass 2: draw rides per (day, hour) and assign everything ─────────────
    rows: list[dict] = []
    jitter_deg = _JITTER_KM / _KM_PER_DEG_LAT
    for d in range(n_days):
        date = start + pd.Timedelta(days=d)
        dow = int(date.dayofweek)
        weekend = dow >= 5
        weather = day_weather[d]
        doy = int(date.dayofyear)
        for hour in range(24):
            n = rng.poisson(lam[d, hour])
            if n == 0:
                continue

            # Zone sampling probabilities for this (hour, weekend) context.
            p_pick = origin_w * np.array(
                [_pickup_factor(ZONES[z], hour, weekend) for z in ZONE_NAMES]
            )
            p_pick = p_pick / p_pick.sum()
            p_drop = attractor_w * np.array(
                [_dropoff_factor(ZONES[z], hour, weekend) for z in ZONE_NAMES]
            )
            p_drop = p_drop / p_drop.sum()

            pick_idx = rng.choice(len(zone_names), size=n, p=p_pick)
            drop_idx = rng.choice(len(zone_names), size=n, p=p_drop)
            # Avoid pickup == dropoff: re-roll the collisions a few times.
            for _ in range(3):
                clash = drop_idx == pick_idx
                if not clash.any():
                    break
                drop_idx[clash] = rng.choice(len(zone_names), size=int(clash.sum()), p=p_drop)

            for i in range(n):
                pz = zone_names[pick_idx[i]]
                dz = zone_names[drop_idx[i]]
                plat = centroid_lat[pz] + rng.normal(0, jitter_deg)
                plng = centroid_lng[pz] + rng.normal(0, jitter_deg)
                dlat = centroid_lat[dz] + rng.normal(0, jitter_deg)
                dlng = centroid_lng[dz] + rng.normal(0, jitter_deg)
                dist = max(0.4, haversine_km(plat, plng, dlat, dlng))

                minute = int(rng.integers(0, 60))
                second = int(rng.integers(0, 60))
                ts = date + pd.Timedelta(hours=hour, minutes=minute, seconds=second)

                rows.append({
                    "requested_at": ts,
                    "hour_of_day": hour,
                    "day_of_week": dow,
                    "is_weekend": int(weekend),
                    "is_rush_hour": pricing.is_rush_hour(hour, dow),
                    "pickup_zone": pz,
                    "dropoff_zone": dz,
                    "pickup_lat": round(plat, 6),
                    "pickup_lng": round(plng, 6),
                    "dropoff_lat": round(dlat, 6),
                    "dropoff_lng": round(dlng, 6),
                    "trip_distance_km": round(dist, 3),
                    "weather_condition": weather,
                    "temperature_c": _seasonal_temp_c(doy, rng),
                    "traffic_density": round(pricing.traffic_density(hour, dow), 3),
                    "driver_id": int(rng.integers(1, n_drivers + 1)),
                    "user_id": f"user_{int(rng.integers(1, n_users + 1)):05d}",
                    # Expected pickup intensity for this zone-hour (drives surge).
                    "_exp_demand": float(lam[d, hour] * p_pick[pick_idx[i]]),
                })

    df = pd.DataFrame(rows)
    df = df.sort_values("requested_at").reset_index(drop=True)
    df.insert(0, "ride_id", [f"ride_{i:07d}" for i in range(len(df))])

    # ── Pass 3: demand pressure vs supply -> surge ───────────────────────────
    df["date"] = df["requested_at"].dt.date.astype(str)

    # Realized demand count per zone-hour — kept for the Gold analytics layer.
    demand = (
        df.groupby(["date", "hour_of_day", "pickup_zone"])
        .size()
        .rename("demand_index")
        .reset_index()
    )
    df = df.merge(demand, on=["date", "hour_of_day", "pickup_zone"], how="left")

    # Smooth, inelastic supply baseline per zone-hour (does not chase spikes).
    supply_base = {z: 2.0 + 6.0 * ZONES[z]["origin_w"] for z in ZONE_NAMES}
    df["supply_index"] = (
        df["pickup_zone"].map(supply_base).to_numpy()
        * _SUPPLY_HOURLY[df["hour_of_day"].to_numpy()]
    ).round(2)
    df["supply_index"] = df["supply_index"].clip(lower=0.5)

    # Surge is driven by EXPECTED demand pressure (a smooth function of zone ×
    # hour × day × weather) relative to supply, so it spikes predictably during
    # rush hours / weekend nights / bad weather and is genuinely learnable.
    pressure = df["_exp_demand"] / df["supply_index"]
    ratio = pressure / pressure.median()
    weather_bump = df["weather_condition"].map(
        {w: (WEATHER[w]["demand_factor"] - 1.0) * 0.6 for w in WEATHER_CONDITIONS}
    )
    surge = 1.0 + _SURGE_GAIN * (ratio - 1.0).clip(lower=0) + weather_bump
    # Idiosyncratic noise so surge is NOT perfectly predictable from the served
    # features (a real surge market never is); keeps the model's R² believable.
    surge = surge + rng.normal(0, 0.09, size=len(df))
    df["surge_multiplier"] = surge.clip(SURGE_MIN, SURGE_MAX).round(2)
    df = df.drop(columns=["_exp_demand"])

    # ── Pass 4: duration (ETA target) + fares ────────────────────────────────
    base_dur = df.apply(
        lambda r: pricing.estimate_duration_min(
            r["trip_distance_km"], r["hour_of_day"], r["day_of_week"], r["weather_condition"]
        ),
        axis=1,
    ).to_numpy()
    # Multiplicative log-normal noise so real trips scatter around the estimate.
    # mean = -sigma^2/2 makes the multiplier mean-neutral (E[noise] = 1), so the
    # labels stay centred on the deterministic estimate instead of drifting high.
    sigma = 0.18
    dur_noise = rng.lognormal(mean=-(sigma**2) / 2, sigma=sigma, size=len(df))
    df["duration_min"] = np.maximum(1.5, base_dur * dur_noise).round(2)

    base = BASE_FARE_EUR + PER_KM_EUR * df["trip_distance_km"] + PER_MIN_EUR * df["duration_min"]
    df["base_fare_eur"] = base.round(2)
    fare = (base * df["surge_multiplier"]) * (1.0 + rng.normal(0, 0.03, size=len(df)))
    df["fare_amount_eur"] = np.maximum(pricing.MIN_FARE_EUR, fare).round(2)

    # ── Pass 5: inject cancellations (missing duration/fare) for the Silver
    #            layer to clean. Cancelled rides keep their request context.
    df["payment_status"] = "paid"
    cancel_mask = rng.random(len(df)) < _CANCEL_RATE
    df.loc[cancel_mask, ["duration_min", "base_fare_eur", "fare_amount_eur"]] = np.nan
    df.loc[cancel_mask, "payment_status"] = "cancelled"

    # Tidy column order.
    cols = [
        "ride_id", "requested_at", "date", "hour_of_day", "day_of_week",
        "is_weekend", "is_rush_hour", "pickup_zone", "dropoff_zone",
        "pickup_lat", "pickup_lng", "dropoff_lat", "dropoff_lng",
        "trip_distance_km", "weather_condition", "temperature_c",
        "traffic_density", "demand_index", "supply_index", "surge_multiplier",
        "duration_min", "base_fare_eur", "fare_amount_eur",
        "payment_status", "driver_id", "user_id",
    ]
    return df[cols]


# Columns that make up the "raw" Bronze event (what the app would actually emit
# at request time — no labels, no derived demand/supply).
RAW_EVENT_COLUMNS = [
    "ride_id", "requested_at", "pickup_zone", "dropoff_zone",
    "pickup_lat", "pickup_lng", "dropoff_lat", "dropoff_lng",
    "weather_condition", "temperature_c", "driver_id", "user_id",
    "duration_min", "fare_amount_eur", "payment_status",
]
