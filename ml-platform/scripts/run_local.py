"""
End-to-end LOCAL pipeline — the proof the architecture works without Databricks.

Steps:
  1. Load (or generate) the ride dataset.
  2. Train the ETA and surge models (time-based hold-out + baseline comparison).
  3. Track everything in MLflow (local ./mlruns store) and log the models.
  4. Save portable joblib artifacts + metrics.json for the FastAPI serving layer.
  5. Print example quotes (rush hour vs. quiet night) so you can SEE surge move.

The Databricks notebooks mirror these exact steps at scale on the lakehouse.

Usage:
    python scripts/run_local.py            # generates data if missing
    python scripts/run_local.py --fresh    # always regenerate
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys

import joblib
import mlflow
import mlflow.sklearn
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Windows consoles default to cp1252; force UTF-8 so €, ×, ² print cleanly.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from djir_ml import features, predict, simulate, train  # noqa: E402
from djir_ml.config import (  # noqa: E402
    DATA_DIR,
    ETA_MODEL_FILE,
    METRICS_FILE,
    MODELS_DIR,
    RIDES_TABLE_FILE,
    SURGE_MODEL_FILE,
)


def load_or_generate(fresh: bool) -> pd.DataFrame:
    path = os.path.join(DATA_DIR, RIDES_TABLE_FILE)
    if fresh or not os.path.exists(path):
        print("Generating dataset …")
        df = simulate.generate()
        os.makedirs(DATA_DIR, exist_ok=True)
        df.to_parquet(path, index=False)
        df.to_csv(os.path.join(DATA_DIR, "rides.csv"), index=False)
        df[simulate.RAW_EVENT_COLUMNS].to_parquet(
            os.path.join(DATA_DIR, "rides_raw.parquet"), index=False
        )
    else:
        print(f"Loading dataset from {path} …")
        df = pd.read_parquet(path)
    df["requested_at"] = pd.to_datetime(df["requested_at"])
    return df


def sample_quotes(eta_pipe, surge_pipe) -> list[dict]:
    """Score a few hand-picked scenarios to sanity-check that surge moves."""
    pickup = (45.8000, 15.9450)    # Tresnjevka (residential)
    dropoff = (45.8085, 15.9775)   # Donji grad (centre)
    scenarios = {
        "Tue 08:15 (morning rush, clear)": (dt.datetime(2025, 6, 3, 8, 15), "clear"),
        "Tue 14:00 (midday, clear)":       (dt.datetime(2025, 6, 3, 14, 0), "clear"),
        "Sat 23:30 (weekend night, rain)": (dt.datetime(2025, 6, 7, 23, 30), "rain"),
        "Sun 04:00 (deep night, clear)":   (dt.datetime(2025, 6, 8, 4, 0), "clear"),
    }
    out = []
    for label, (when, weather) in scenarios.items():
        feats = features.request_features(*pickup, *dropoff, when, weather)
        q = predict.quote(eta_pipe, surge_pipe, feats)
        q["scenario"] = label
        out.append(q)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true", help="regenerate the dataset")
    args = ap.parse_args()

    df = load_or_generate(args.fresh)
    print(f"Dataset: {len(df):,} rides\n")

    # MLflow 3 retired the bare file store; SQLite is the recommended local backend.
    mlflow.set_tracking_uri("sqlite:///mlflow.db")
    mlflow.set_experiment("djir-ml-local")

    os.makedirs(MODELS_DIR, exist_ok=True)

    # ── ETA model ────────────────────────────────────────────────────────────
    with mlflow.start_run(run_name="eta_model"):
        eta_pipe, eta_metrics = train.train_eta(df)
        mlflow.log_params({"algorithm": "XGBRegressor", "target": "duration_min"})
        mlflow.log_metrics({f"eta_{k}": v for k, v in eta_metrics["model"].items()})
        mlflow.log_metric("eta_mae_improvement_pct", eta_metrics["mae_improvement_pct"])
        # artifact_path (not name=) works on both MLflow 2.x and 3.x.
        mlflow.sklearn.log_model(eta_pipe, artifact_path="model", serialization_format="cloudpickle")
    print("ETA model")
    print(f"  test MAE  : {eta_metrics['model']['mae']:.2f} min "
          f"(naive baseline {eta_metrics['baseline_naive_flat_speed']['mae']:.2f} min, "
          f"−{eta_metrics['mae_improvement_pct']:.1f}%)")
    print(f"  test R²   : {eta_metrics['model']['r2']:.3f}\n")

    # ── Surge model ──────────────────────────────────────────────────────────
    with mlflow.start_run(run_name="surge_model"):
        surge_pipe, surge_metrics = train.train_surge(df)
        mlflow.log_params({"algorithm": "XGBRegressor", "target": "surge_multiplier"})
        mlflow.log_metrics({f"surge_{k}": v for k, v in surge_metrics["model"].items()})
        mlflow.log_metric("surge_mae_improvement_pct", surge_metrics["mae_improvement_pct"])
        mlflow.sklearn.log_model(surge_pipe, artifact_path="model", serialization_format="cloudpickle")
    print("Surge model")
    print(f"  test MAE  : {surge_metrics['model']['mae']:.3f}× "
          f"(baseline {surge_metrics['baseline_mean']['mae']:.3f}×, "
          f"−{surge_metrics['mae_improvement_pct']:.1f}%)")
    print(f"  test R²   : {surge_metrics['model']['r2']:.3f}\n")

    # ── Persist portable artifacts for serving ───────────────────────────────
    joblib.dump(eta_pipe, os.path.join(MODELS_DIR, ETA_MODEL_FILE))
    joblib.dump(surge_pipe, os.path.join(MODELS_DIR, SURGE_MODEL_FILE))
    metrics = {"eta": eta_metrics, "surge": surge_metrics}
    with open(os.path.join(MODELS_DIR, METRICS_FILE), "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"Saved models + metrics to {MODELS_DIR}/\n")

    # ── Sanity-check quotes ──────────────────────────────────────────────────
    print("Example quotes (Tresnjevka → Donji grad):")
    for q in sample_quotes(eta_pipe, surge_pipe):
        print(f"  {q['scenario']:34}  ETA {q['eta_minutes']:>4} min  "
              f"surge {q['surge_multiplier']:.2f}×  →  €{q['total_fare_eur']:.2f}")


if __name__ == "__main__":
    main()
