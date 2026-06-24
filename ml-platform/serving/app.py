"""
Djir smart-pricing API  (FastAPI)
=================================
A portable serving layer for the ETA + surge models. It loads the joblib
artifacts produced by `scripts/run_local.py` (or exported from the Databricks
notebooks) and exposes a single quote endpoint the mobile app calls.

Why this exists alongside Databricks Model Serving: free Databricks tiers may
not expose a live serving endpoint, and a portfolio reviewer should be able to
`docker run` the whole thing in 30 seconds. The model artifacts are identical;
only the host differs (see ADR-004).

If the model files are missing, the API degrades gracefully to the deterministic
heuristic instead of failing — the mobile app therefore always gets a quote.

Run locally:
    cd ml-platform
    uvicorn serving.app:app --reload --port 8000
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys

import joblib
from fastapi import FastAPI
from pydantic import BaseModel, Field

# Make the shared `djir_ml` package importable regardless of CWD.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from djir_ml import features, predict  # noqa: E402
from djir_ml.config import (  # noqa: E402
    CURRENCY,
    ETA_MODEL_FILE,
    METRICS_FILE,
    MODELS_DIR,
    SURGE_MODEL_FILE,
)

MODELS_PATH = os.environ.get("DJIR_MODELS_DIR", os.path.join(_ROOT, MODELS_DIR))

app = FastAPI(
    title="Djir Smart Pricing API",
    version="1.0.0",
    description="ETA + dynamic-surge price quotes for the Djir ride-hailing app.",
)

# Loaded once at import time; None => heuristic fallback mode.
_eta_model = None
_surge_model = None
_metrics: dict = {}


def _load_models() -> None:
    global _eta_model, _surge_model, _metrics
    eta_p = os.path.join(MODELS_PATH, ETA_MODEL_FILE)
    surge_p = os.path.join(MODELS_PATH, SURGE_MODEL_FILE)
    if os.path.exists(eta_p) and os.path.exists(surge_p):
        _eta_model = joblib.load(eta_p)
        _surge_model = joblib.load(surge_p)
    metrics_p = os.path.join(MODELS_PATH, METRICS_FILE)
    if os.path.exists(metrics_p):
        with open(metrics_p) as f:
            _metrics = json.load(f)


_load_models()


class QuoteRequest(BaseModel):
    pickup_lat: float = Field(..., examples=[45.8000])
    pickup_lng: float = Field(..., examples=[15.9450])
    dropoff_lat: float = Field(..., examples=[45.8085])
    dropoff_lng: float = Field(..., examples=[15.9775])
    when: str | None = Field(None, description="ISO-8601 local time; defaults to now")
    weather: str = Field("clear", description="clear | rain | fog | snow")


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "models_loaded": _eta_model is not None and _surge_model is not None,
        "models_path": MODELS_PATH,
    }


@app.get("/metrics")
def metrics() -> dict:
    return _metrics or {"detail": "no metrics.json found — run scripts/run_local.py"}


@app.post("/predict-price")
def predict_price(req: QuoteRequest) -> dict:
    when = dt.datetime.fromisoformat(req.when) if req.when else dt.datetime.now()
    feats = features.request_features(
        req.pickup_lat, req.pickup_lng, req.dropoff_lat, req.dropoff_lng, when, req.weather
    )
    if _eta_model is not None and _surge_model is not None:
        quote = predict.quote(_eta_model, _surge_model, feats)
    else:
        quote = predict.heuristic_quote(feats)

    quote.update({
        "pickup_zone": feats["pickup_zone"],
        "dropoff_zone": feats["dropoff_zone"],
        "weather_condition": feats["weather_condition"],
        "request_time": when.isoformat(timespec="minutes"),
    })
    return quote


@app.get("/")
def root() -> dict:
    return {
        "service": "Djir Smart Pricing API",
        "currency": CURRENCY,
        "endpoints": ["/health", "/metrics", "POST /predict-price", "/docs"],
        "mode": "ml-model" if _eta_model is not None else "heuristic-fallback",
    }
