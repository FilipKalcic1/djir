"""
djir_ml.geo
===========
Geospatial helpers shared across the whole platform: great-circle distance and
mapping an arbitrary coordinate back to its nearest Zagreb zone.

These are deliberately dependency-light (pure Python + math) so the exact same
logic can be ported to the mobile app's TypeScript fallback without surprises.
"""

from __future__ import annotations

import math

from .config import ZONES

EARTH_RADIUS_KM = 6371.0088

# A stable default so nearest_zone always returns *something* even in the
# (impossible) empty-config case; ZONES is never empty in practice.
ZONE_NAMES_FALLBACK = next(iter(ZONES))


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two WGS84 points, in kilometres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def nearest_zone(lat: float, lng: float) -> str:
    """Return the name of the Zagreb zone whose centroid is closest to (lat, lng).

    Used at serving time: the app sends raw coordinates, we snap them to a known
    zone so the models (which were trained on zone categoricals) can score them.
    """
    best_name, best_d = ZONE_NAMES_FALLBACK, float("inf")
    for name, z in ZONES.items():
        d = haversine_km(lat, lng, z["lat"], z["lng"])
        if d < best_d:
            best_name, best_d = name, d
    return best_name
