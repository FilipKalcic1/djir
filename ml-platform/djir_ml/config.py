"""
djir_ml.config
==============
The single source of truth for the Djir ML platform.

Every other component — the data simulator, the Databricks medallion notebooks,
the model-training code, the FastAPI serving layer and the mobile app's
heuristic fallback — derives its constants from THIS file. Keeping the schema,
the Zagreb zone table, the pricing formula and the feature lists in one place is
what stops the pipeline from drifting apart as it grows.

Narrative: Djir is a ride-hailing app operating in Zagreb, Croatia. Croatia
adopted the euro on 2023-01-01, so every monetary value in the platform is in
EUR (€).
"""

from __future__ import annotations

# ──────────────────────────────────────────────────────────────────────────
# Currency
# ──────────────────────────────────────────────────────────────────────────
CURRENCY = "EUR"
CURRENCY_SYMBOL = "€"

# ──────────────────────────────────────────────────────────────────────────
# Zagreb zones
# ──────────────────────────────────────────────────────────────────────────
# Each zone has:
#   lat, lng       — approximate centroid (WGS84)
#   origin_w       — relative weight of a ride STARTING here (supply of riders)
#   attractor_w    — relative weight of a ride ENDING here (pull of the zone)
#   residential    — boolean-ish (0..1): how residential the zone is. Drives the
#                    morning "commute to the centre" / evening "commute home" flow.
#   nightlife      — 0..1: weekend-night demand multiplier (bars, Jarun lake…)
#
# Coordinates are real Zagreb neighbourhoods; weights are hand-tuned to produce
# believable demand patterns, not official statistics.
ZONES: dict[str, dict] = {
    "Donji grad":        {"lat": 45.8085, "lng": 15.9775, "origin_w": 1.4, "attractor_w": 2.2, "residential": 0.2, "nightlife": 1.0},
    "Gornji grad":       {"lat": 45.8180, "lng": 15.9745, "origin_w": 0.7, "attractor_w": 1.1, "residential": 0.3, "nightlife": 0.6},
    "Trnje":             {"lat": 45.7950, "lng": 15.9850, "origin_w": 1.2, "attractor_w": 1.3, "residential": 0.6, "nightlife": 0.3},
    "Tresnjevka":        {"lat": 45.8000, "lng": 15.9450, "origin_w": 1.5, "attractor_w": 1.0, "residential": 0.8, "nightlife": 0.3},
    "Maksimir":          {"lat": 45.8250, "lng": 16.0150, "origin_w": 1.0, "attractor_w": 0.9, "residential": 0.7, "nightlife": 0.2},
    "Pescenica":         {"lat": 45.7970, "lng": 16.0300, "origin_w": 0.8, "attractor_w": 0.7, "residential": 0.6, "nightlife": 0.1},
    "Novi Zagreb":       {"lat": 45.7700, "lng": 15.9900, "origin_w": 1.6, "attractor_w": 1.1, "residential": 0.9, "nightlife": 0.3},
    "Jarun":             {"lat": 45.7830, "lng": 15.9400, "origin_w": 0.9, "attractor_w": 1.2, "residential": 0.4, "nightlife": 1.0},
    "Crnomerec":         {"lat": 45.8180, "lng": 15.9400, "origin_w": 1.0, "attractor_w": 0.7, "residential": 0.8, "nightlife": 0.2},
    "Dubrava":           {"lat": 45.8350, "lng": 16.0400, "origin_w": 1.3, "attractor_w": 0.7, "residential": 0.9, "nightlife": 0.2},
    "Sesvete":           {"lat": 45.8310, "lng": 16.1100, "origin_w": 1.1, "attractor_w": 0.6, "residential": 0.95, "nightlife": 0.1},
    "Velika Gorica":     {"lat": 45.7130, "lng": 16.0750, "origin_w": 0.8, "attractor_w": 0.6, "residential": 0.9, "nightlife": 0.1},
    "Airport":           {"lat": 45.7430, "lng": 16.0690, "origin_w": 0.6, "attractor_w": 1.4, "residential": 0.0, "nightlife": 0.0},
}
ZONE_NAMES: list[str] = list(ZONES.keys())

# ──────────────────────────────────────────────────────────────────────────
# Weather
# ──────────────────────────────────────────────────────────────────────────
# probability — base sampling probability of this condition
# speed_factor — multiplies driving speed (rain/snow => slower => longer ETA)
# demand_factor — multiplies ride demand (bad weather => more people want a ride)
WEATHER: dict[str, dict] = {
    "clear": {"probability": 0.62, "speed_factor": 1.00, "demand_factor": 1.00},
    "rain":  {"probability": 0.24, "speed_factor": 0.82, "demand_factor": 1.35},
    "fog":   {"probability": 0.08, "speed_factor": 0.78, "demand_factor": 1.10},
    "snow":  {"probability": 0.06, "speed_factor": 0.62, "demand_factor": 1.55},
}
WEATHER_CONDITIONS: list[str] = list(WEATHER.keys())

# ──────────────────────────────────────────────────────────────────────────
# Traffic / speed model
# ──────────────────────────────────────────────────────────────────────────
BASE_SPEED_KMH = 32.0          # free-flow average city speed
RUSH_SPEED_KMH = 17.0          # average speed during peak congestion
NAIVE_SPEED_KMH = 30.0         # the single flat speed a naive app assumes (ETA baseline)
MORNING_RUSH = (7, 9)          # inclusive hour range
EVENING_RUSH = (16, 19)
PICKUP_OVERHEAD_MIN = 1.5      # fixed minutes added per trip (boarding, lights…)

# ──────────────────────────────────────────────────────────────────────────
# Pricing formula  (deterministic — shared by the simulator that creates the
# fare label AND by the serving/​fallback heuristic so they never disagree).
#
#   base_fare   = BASE + PER_KM * distance_km + PER_MIN * duration_min
#   total_fare  = max(MIN_FARE, base_fare * surge_multiplier)
# ──────────────────────────────────────────────────────────────────────────
BASE_FARE_EUR = 2.00
PER_KM_EUR = 0.80
PER_MIN_EUR = 0.20
MIN_FARE_EUR = 3.50

# Surge bounds
SURGE_MIN = 1.0
SURGE_MAX = 3.0

# ──────────────────────────────────────────────────────────────────────────
# Feature contracts
# ──────────────────────────────────────────────────────────────────────────
# Features available at SERVING time (the mobile app can supply / derive all of
# these from a ride request: two coordinates + the current timestamp).
ETA_NUMERIC_FEATURES = [
    "trip_distance_km",
    "hour_of_day",
    "day_of_week",
    "is_weekend",
    "is_rush_hour",
    "traffic_density",
]
ETA_CATEGORICAL_FEATURES = ["pickup_zone", "dropoff_zone", "weather_condition"]
ETA_FEATURES = ETA_NUMERIC_FEATURES + ETA_CATEGORICAL_FEATURES
ETA_TARGET = "duration_min"

# The surge model predicts surge purely from time + place + weather, all of
# which are observable when a rider opens the app (demand/supply are latent in
# the simulator and learned implicitly through these observable proxies).
SURGE_NUMERIC_FEATURES = [
    "hour_of_day",
    "day_of_week",
    "is_weekend",
    "is_rush_hour",
]
SURGE_CATEGORICAL_FEATURES = ["pickup_zone", "weather_condition"]
SURGE_FEATURES = SURGE_NUMERIC_FEATURES + SURGE_CATEGORICAL_FEATURES
SURGE_TARGET = "surge_multiplier"

# ──────────────────────────────────────────────────────────────────────────
# Storage paths / names (relative to the ml-platform/ directory for local runs;
# the notebooks override these with Unity Catalog / DBFS paths).
# ──────────────────────────────────────────────────────────────────────────
DATA_DIR = "data"
MODELS_DIR = "models"
RAW_EVENTS_FILE = "rides_raw.parquet"      # bronze-style raw events
RIDES_TABLE_FILE = "rides.parquet"          # silver/feature table
ETA_MODEL_FILE = "eta_model.joblib"
SURGE_MODEL_FILE = "surge_model.joblib"
METRICS_FILE = "metrics.json"

# Catalog / schema names used by the Databricks notebooks.
UC_CATALOG = "djir"
UC_SCHEMA = "lakehouse"
MLFLOW_EXPERIMENT = "/Shared/djir-ml"
ETA_REGISTERED_MODEL = "djir_eta_model"
SURGE_REGISTERED_MODEL = "djir_surge_model"

# Reproducibility
RANDOM_SEED = 42
