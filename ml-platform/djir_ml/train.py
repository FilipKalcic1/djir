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
and always compare against the naive heuristic the app would otherwise use, so
the model's added value is explicit and measurable.
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
    """Keep only completed rides with valid labels (drop the cancelled ones)."""
    out = df[df["payment_status"] == "paid"].copy()
    out = out.dropna(subset=[ETA_TARGET, SURGE_TARGET, "fare_amount_eur"])
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


def train_eta(df: pd.DataFrame):
    """Train the ETA model. Returns (pipeline, metrics)."""
    train_df, test_df = time_split(prepare(df))
    pipe = _make_pipeline(ETA_NUMERIC_FEATURES, ETA_CATEGORICAL_FEATURES)
    pipe.fit(train_df[ETA_FEATURES], train_df[ETA_TARGET])

    y_true = test_df[ETA_TARGET].to_numpy()
    y_pred = pipe.predict(test_df[ETA_FEATURES])

    # Baseline = the NAIVE flat-speed ETA a typical app shows (blind to traffic
    # and weather). The model's job is to beat it by learning congestion.
    y_base = test_df["trip_distance_km"].map(pricing.naive_duration_min).to_numpy()

    model_m = _regression_metrics(y_true, y_pred)
    base_m = _regression_metrics(y_true, y_base)
    # Improvement from the UNrounded MAEs to avoid a round-of-rounded artifact.
    raw_model_mae = mean_absolute_error(y_true, y_pred)
    raw_base_mae = mean_absolute_error(y_true, y_base)
    metrics = {
        "target": ETA_TARGET,
        "n_train": int(len(train_df)),
        "n_test": int(len(test_df)),
        "model": model_m,
        "baseline_naive_flat_speed": base_m,
        "mae_improvement_pct": round((raw_base_mae - raw_model_mae) / raw_base_mae * 100, 1),
    }
    return pipe, metrics


def train_surge(df: pd.DataFrame):
    """Train the surge model. Returns (pipeline, metrics)."""
    train_df, test_df = time_split(prepare(df))
    pipe = _make_pipeline(SURGE_NUMERIC_FEATURES, SURGE_CATEGORICAL_FEATURES)
    pipe.fit(train_df[SURGE_FEATURES], train_df[SURGE_TARGET])

    y_true = test_df[SURGE_TARGET].to_numpy()
    y_pred = pipe.predict(test_df[SURGE_FEATURES])

    # Baseline = predict the global average surge for everyone.
    y_base = np.full_like(y_true, train_df[SURGE_TARGET].mean(), dtype=float)

    model_m = _regression_metrics(y_true, y_pred)
    base_m = _regression_metrics(y_true, y_base)
    raw_model_mae = mean_absolute_error(y_true, y_pred)
    raw_base_mae = mean_absolute_error(y_true, y_base)
    metrics = {
        "target": SURGE_TARGET,
        "n_train": int(len(train_df)),
        "n_test": int(len(test_df)),
        "model": model_m,
        "baseline_mean": base_m,
        "mae_improvement_pct": round((raw_base_mae - raw_model_mae) / raw_base_mae * 100, 1),
    }
    return pipe, metrics
