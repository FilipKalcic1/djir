"""
Djir smart-pricing API  (FastAPI)
=================================
A portable serving layer for the ETA + surge models. It loads the joblib
artifacts produced by `scripts/run_local.py` (or exported from the Databricks
notebooks) and exposes a single quote endpoint the mobile app calls.

Why this exists alongside Databricks Model Serving: free Databricks tiers may
not expose a live serving endpoint, and a portfolio reviewer should be able to
`docker run` the whole thing in 30 seconds. This service — not a Databricks
endpoint — is what the app's `ML_ENDPOINT_URL` points at (ADR-004).

If the model files are missing or cannot be loaded, the API degrades to the
deterministic heuristic instead of failing. `/health` still answers 200 (the
service is up and quoting); its `models_loaded` and `load_error` fields say
whether the models or the heuristic are pricing, and why.

Run locally:
    cd ml-platform
    uvicorn serving.app:app --reload --port 8000
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
import sys
from typing import Literal

import joblib
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

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
    SERVICE_CENTER,
    SERVICE_RADIUS_KM,
    SURGE_MODEL_FILE,
)
from djir_ml.geo import haversine_km  # noqa: E402

log = logging.getLogger("djir.serving")

MODELS_PATH = os.environ.get("DJIR_MODELS_DIR", os.path.join(_ROOT, MODELS_DIR))

# Pickup times are priced only for Zagreb calendar years in this range; outside
# it a date is a client bug, and near year 1 or 9999 the conversion overflows.
WHEN_YEARS = (2000, 2100)

app = FastAPI(
    title="Djir Smart Pricing API",
    version="1.1.0",
    description="ETA + dynamic-surge price quotes for the Djir ride-hailing app.",
)


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    """422 without echoing the input: FastAPI's default handler returns the
    offending value, and a NaN coordinate cannot be serialised as JSON (the
    client would get a 500 instead of the 422)."""
    errors = [{k: e[k] for k in ("loc", "msg", "type") if k in e} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors})


# Loaded once at import time; None => heuristic fallback mode.
_eta_model = None
_surge_model = None
_load_error: str | None = None
_metrics: dict = {}


def _load_models() -> None:
    """Load both artifacts, or neither: a half-loaded pair would silently mix
    model and heuristic answers, so any failure falls back to the heuristic
    and is reported by /health."""
    global _eta_model, _surge_model, _load_error, _metrics
    eta_p = os.path.join(MODELS_PATH, ETA_MODEL_FILE)
    surge_p = os.path.join(MODELS_PATH, SURGE_MODEL_FILE)
    present = [p for p in (eta_p, surge_p) if os.path.exists(p)]

    if len(present) == 2:
        try:
            _eta_model, _surge_model = joblib.load(eta_p), joblib.load(surge_p)
        except Exception as exc:  # corrupt or version-incompatible pickle
            _eta_model = _surge_model = None
            _load_error = f"{type(exc).__name__}: {exc}"
            log.exception("Could not load models from %s; using the heuristic", MODELS_PATH)
    elif len(present) == 1:
        _load_error = f"only {os.path.basename(present[0])} found in {MODELS_PATH}"
        log.warning("%s; using the heuristic", _load_error)

    metrics_p = os.path.join(MODELS_PATH, METRICS_FILE)
    if os.path.exists(metrics_p):
        with open(metrics_p) as f:
            _metrics = json.load(f)


_load_models()


def _in_service_area(lat: float, lng: float) -> bool:
    return haversine_km(lat, lng, *SERVICE_CENTER) <= SERVICE_RADIUS_KM


class QuoteRequest(BaseModel):
    pickup_lat: float = Field(..., ge=-90, le=90, allow_inf_nan=False, examples=[45.8000])
    pickup_lng: float = Field(..., ge=-180, le=180, allow_inf_nan=False, examples=[15.9450])
    dropoff_lat: float = Field(..., ge=-90, le=90, allow_inf_nan=False, examples=[45.8085])
    dropoff_lng: float = Field(..., ge=-180, le=180, allow_inf_nan=False, examples=[15.9775])
    when: dt.datetime | None = Field(
        None,
        description="ISO-8601 instant WITH an offset, e.g. 2025-06-07T21:30:00Z or "
        "2025-06-07T23:30:00+02:00. Defaults to now.",
        examples=["2025-06-07T21:30:00Z"],
    )
    weather: Literal["clear", "rain", "fog", "snow"] = "clear"

    @field_validator("when")
    @classmethod
    def _an_instant_we_can_price(cls, value: dt.datetime | None) -> dt.datetime | None:
        if value is None:
            return value
        # "02:30" on the last Sunday of October happens twice in Zagreb: without
        # an offset an instant is ambiguous, so it is refused (the app sends Z).
        if value.utcoffset() is None:
            raise ValueError("when needs a UTC offset, e.g. 2025-06-07T21:30:00Z")
        first, last = WHEN_YEARS
        try:
            year = value.astimezone(features.SERVICE_TZ).year
        except (OverflowError, ValueError):
            year = None
        if year is None or not first <= year <= last:
            raise ValueError(f"when must fall in the years {first}–{last} in Zagreb")
        return value

    @field_validator("weather", mode="before")
    @classmethod
    def _lowercase_weather(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value

    @model_validator(mode="after")
    def _inside_zagreb(self) -> "QuoteRequest":
        for name, lat, lng in (
            ("pickup", self.pickup_lat, self.pickup_lng),
            ("dropoff", self.dropoff_lat, self.dropoff_lng),
        ):
            if not _in_service_area(lat, lng):
                raise ValueError(
                    f"{name} is outside the Zagreb service area "
                    f"({SERVICE_RADIUS_KM:.0f} km around the centre)"
                )
        return self


@app.get("/health")
def health() -> dict:
    """Liveness: 200 whenever the service can quote, heuristic fallback included.
    `models_loaded` is false (with `load_error`) when the heuristic is pricing."""
    return {
        "status": "ok",
        "models_loaded": _eta_model is not None and _surge_model is not None,
        "models_path": MODELS_PATH,
        "load_error": _load_error,
    }


@app.get("/metrics")
def metrics() -> dict:
    return _metrics or {"detail": "no metrics.json found — run scripts/run_local.py"}


@app.post("/predict-price")
def predict_price(req: QuoteRequest) -> dict:
    when = req.when or dt.datetime.now(features.SERVICE_TZ)
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
        # Zagreb wall-clock time the quote was priced for.
        "request_time": features.to_service_time(when).isoformat(timespec="minutes"),
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
