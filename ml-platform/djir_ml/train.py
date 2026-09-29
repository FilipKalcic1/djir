"""
djir_ml.train
=============
Trains the two models that power Djir's smart pricing:

  * ETA model   — predicts trip duration in minutes (regression)
  * Surge model — predicts the dynamic-pricing multiplier (regression)

Both are scikit-learn Pipelines (one-hot encode the categoricals -> XGBoost),
which means the *saved* artifact already contains its own preprocessing: serving
just hands it a DataFrame of raw features. We evaluate on a TIME-BASED hold-out
(the most recent 20% of rides) — the honest setup for a forecasting problem —
and compare against TWO baselines, so the model's added value is explicit:

  * naive    — what a typical app shows (one flat speed / the global mean);
  * informed — the deterministic heuristic Djir itself falls back to, which
               already knows congestion and weather. Beating the naive baseline
               is easy; the informed one is the honest bar.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.metrics import mean_absolute_error, r2_score, root_mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from xgboost import XGBRegressor

from . import pricing
from .config import (
    ETA_CATEGORICAL_FEATURES,
    ETA_FEATURES,
    ETA_NUMERIC_FEATURES,
    ETA_TARGET,
    RANDOM_SEED,
    SURGE_CATEGORICAL_FEATURES,
    SURGE_FEATURES,
    SURGE_NUMERIC_FEATURES,
    SURGE_TARGET,
)


def prepare(df: pd.DataFrame) -> pd.DataFrame:
    """Keep only completed rides with valid labels (drop the cancelled ones).

    The Silver layer has already dropped cancelled rides, so the Databricks
    feature table may not carry `payment_status`; filter on it only if present.
    """
    out = df[df["payment_status"] == "paid"] if "payment_status" in df else df
    out = out.dropna(subset=[ETA_TARGET, SURGE_TARGET, "fare_amount_eur"]).copy()
    return out.sort_values("requested_at").reset_index(drop=True)


def time_split(df: pd.DataFrame, test_frac: float = 0.2):
    """Split chronologically: oldest rides train, most recent `test_frac` test.

    Guard the slice so a tiny frame can never invert (`iloc[:-0]` == empty): the
    test set holds at least 1 row and the train set always keeps at least 1 row.
    """
    n_test = max(1, min(len(df) - 1, int(len(df) * test_frac)))
    return df.iloc[:-n_test].copy(), df.iloc[-n_test:].copy()


def _make_pipeline(numeric: list[str], categorical: list[str]) -> Pipeline:
    pre = ColumnTransformer(
        transformers=[
            ("num", "passthrough", numeric),
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), categorical),
        ]
    )
    model = XGBRegressor(
        n_estimators=400,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_lambda=1.0,
        random_state=RANDOM_SEED,
        n_jobs=-1,
        tree_method="hist",
    )
    return Pipeline([("pre", pre), ("model", model)])


def _regression_metrics(y_true, y_pred) -> dict:
    return {
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 4),
        "rmse": round(float(root_mean_squared_error(y_true, y_pred)), 4),
        "r2": round(float(r2_score(y_true, y_pred)), 4),
    }


def _improvement_pct(y_true, y_pred, y_base) -> float:
    """MAE improvement over a baseline, from the UNrounded MAEs (no round-of-rounded)."""
    model_mae = mean_absolute_error(y_true, y_pred)
    base_mae = mean_absolute_error(y_true, y_base)
    return round((base_mae - model_mae) / base_mae * 100, 1)


def evaluate_eta(pipe, n_train: int, test_df: pd.DataFrame) -> dict:
    """Score a fitted ETA pipeline on the hold-out against both baselines."""
    y_true = test_df[ETA_TARGET].to_numpy()
    y_pred = pipe.predict(test_df[ETA_FEATURES])
    y_naive = test_df["trip_distance_km"].map(pricing.naive_duration_min).to_numpy()
    y_informed = np.array([
        pricing.estimate_duration_min(r.trip_distance_km, r.hour_of_day, r.day_of_week, r.weather_condition)
        for r in test_df.itertuples()
    ])
    return {
        "target": ETA_TARGET,
        "n_train": int(n_train),
        "n_test": int(len(test_df)),
        "model": _regression_metrics(y_true, y_pred),
        "baseline_naive_flat_speed": _regression_metrics(y_true, y_naive),
        "baseline_informed_heuristic": _regression_metrics(y_true, y_informed),
        "mae_improvement_pct": _improvement_pct(y_true, y_pred, y_naive),
        "mae_improvement_vs_informed_pct": _improvement_pct(y_true, y_pred, y_informed),
    }


def evaluate_surge(pipe, train_df: pd.DataFrame, test_df: pd.DataFrame) -> dict:
    """Score a fitted surge pipeline on the hold-out against both baselines."""
    y_true = test_df[SURGE_TARGET].to_numpy()
    y_pred = pipe.predict(test_df[SURGE_FEATURES])
    y_mean = np.full_like(y_true, train_df[SURGE_TARGET].mean(), dtype=float)
    y_informed = np.array([
        pricing.heuristic_surge(r.hour_of_day, r.day_of_week, r.weather_condition)
        for r in test_df.itertuples()
    ])
    return {
        "target": SURGE_TARGET,
        "n_train": int(len(train_df)),
        "n_test": int(len(test_df)),
        "model": _regression_metrics(y_true, y_pred),
        "baseline_mean": _regression_metrics(y_true, y_mean),
        "baseline_informed_heuristic": _regression_metrics(y_true, y_informed),
        "mae_improvement_pct": _improvement_pct(y_true, y_pred, y_mean),
        "mae_improvement_vs_informed_pct": _improvement_pct(y_true, y_pred, y_informed),
    }


def train_eta(df: pd.DataFrame):
    """Train the ETA model. Returns (pipeline, metrics)."""
    train_df, test_df = time_split(prepare(df))
    pipe = _make_pipeline(ETA_NUMERIC_FEATURES, ETA_CATEGORICAL_FEATURES)
    pipe.fit(train_df[ETA_FEATURES], train_df[ETA_TARGET])
    return pipe, evaluate_eta(pipe, len(train_df), test_df)


def train_surge(df: pd.DataFrame):
    """Train the surge model. Returns (pipeline, metrics)."""
    train_df, test_df = time_split(prepare(df))
    pipe = _make_pipeline(SURGE_NUMERIC_FEATURES, SURGE_CATEGORICAL_FEATURES)
    pipe.fit(train_df[SURGE_FEATURES], train_df[SURGE_TARGET])
    return pipe, evaluate_surge(pipe, train_df, test_df)
