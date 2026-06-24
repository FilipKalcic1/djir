"""
djir_ml.predict
===============
The canonical quote builder: given the two trained pipelines (or none) plus a
feature dict, produce the price quote the mobile app consumes.

`quote()` is what the FastAPI serving layer calls. `heuristic_quote()` is the
zero-model fallback — the same shape, so callers never special-case it.
"""

from __future__ import annotations

import pandas as pd

from . import pricing
from .config import CURRENCY, ETA_FEATURES, SURGE_FEATURES


def _round_quote(eta: float, surge: float, distance_km: float, source: str) -> dict:
    eta = max(1.5, float(eta))
    surge = min(pricing.SURGE_MAX, max(pricing.SURGE_MIN, float(surge)))
    base = pricing.base_fare(distance_km, eta)
    total = pricing.total_fare(base, surge)
    return {
        "eta_minutes": round(eta, 1),
        "surge_multiplier": round(surge, 2),
        "base_fare_eur": round(base, 2),
        "total_fare_eur": total,
        "trip_distance_km": round(distance_km, 2),
        "currency": CURRENCY,
        "source": source,
    }


def quote(eta_pipe, surge_pipe, feats: dict) -> dict:
    """Score a request with both models and assemble the fare quote."""
    eta = float(eta_pipe.predict(pd.DataFrame([{k: feats[k] for k in ETA_FEATURES}]))[0])
    surge = float(surge_pipe.predict(pd.DataFrame([{k: feats[k] for k in SURGE_FEATURES}]))[0])
    return _round_quote(eta, surge, feats["trip_distance_km"], source="ml-model")


def heuristic_quote(feats: dict) -> dict:
    """Model-free quote using only the deterministic pricing physics."""
    eta = pricing.estimate_duration_min(
        feats["trip_distance_km"], feats["hour_of_day"],
        feats["day_of_week"], feats["weather_condition"],
    )
    surge = pricing.heuristic_surge(
        feats["hour_of_day"], feats["day_of_week"], feats["weather_condition"]
    )
    return _round_quote(eta, surge, feats["trip_distance_km"], source="heuristic-fallback")
