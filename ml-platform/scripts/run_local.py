"""
End-to-end LOCAL pipeline — the proof the architecture works without Databricks.

Steps:
  1. Load (or generate) the ride dataset.
  2. Train the ETA and surge models (time-based hold-out + baseline comparison).
  3. Track everything in MLflow (local ./mlruns store) and log the models.
  4. Save portable joblib artifacts + metrics.json: to data/models/, or to
     models/ (what serving, the tests and the READMEs use) with --promote.
  5. Print example quotes (rush hour vs. quiet night) so you can SEE surge move.

The Databricks notebooks mirror these exact steps at scale on the lakehouse.

A retrain does not reproduce the committed models bit for bit, so promoting one
changes the headline numbers (the €9.74 quote, the metrics tables, the chart)
and the tests pinned to them. Compare data/models/metrics.json first.

Usage:
    python scripts/run_local.py                      # generates data if missing
    python scripts/run_local.py --fresh              # always regenerate
    python scripts/run_local.py --fresh --promote    # also replace models/
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
from pathlib import Path

import pandas as pd

# Everything (data/, models/, mlflow.db, mlruns/) lives under ml-platform/, whatever
# the working directory: serving reads models/ from there, so a run started
# elsewhere must not leave it serving stale artifacts.
ML_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_ROOT))

# Windows consoles default to cp1252; force UTF-8 so €, ×, ² print cleanly.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from djir_ml import artifacts, features, predict, simulate, train  # noqa: E402
from djir_ml.config import (  # noqa: E402
    DATA_DIR,
    MODELS_DIR,
    RIDES_TABLE_FILE,
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


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Generate, train, track and quote, locally.")
    ap.add_argument("--fresh", action="store_true", help="regenerate the dataset")
    ap.add_argument(
        "--promote",
        action="store_true",
        help="write the models and metrics.json to models/ (what serving, the tests "
        "and the READMEs use) instead of data/models/",
    )
    return ap.parse_args(argv)


def artifacts_dir(promote: bool) -> Path:
    """models/ is committed, so a retrain only replaces it when asked to."""
    return artifacts.artifacts_dir(ML_ROOT, promote)


# The writer notebook 07 uses too: the pipelines always travel with their metrics.json.
save_artifacts = artifacts.save_artifacts


def main(argv: list[str] | None = None) -> None:
    # MLflow is imported here, not at the top, so the helpers above can be
    # imported (and tested) without it: requirements-dev.txt leaves it out.
    import mlflow
    import mlflow.sklearn

    args = parse_args(argv)
    os.chdir(ML_ROOT)

    df = load_or_generate(args.fresh)
    print(f"Dataset: {len(df):,} rides\n")

    # MLflow 3 retired the bare file store; SQLite is the recommended local backend.
    mlflow.set_tracking_uri("sqlite:///mlflow.db")
    mlflow.set_experiment("djir-ml-local")

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
          f"−{eta_metrics['mae_improvement_pct']:.1f}%; informed heuristic "
          f"{eta_metrics['baseline_informed_heuristic']['mae']:.2f} min, "
          f"{-eta_metrics['mae_improvement_vs_informed_pct']:+.1f}%)")
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
    out_dir = artifacts_dir(args.promote)
    save_artifacts(eta_pipe, surge_pipe, {"eta": eta_metrics, "surge": surge_metrics}, out_dir)
    print(f"Saved models + metrics to {out_dir}")
    if not args.promote:
        print(f"{MODELS_DIR}/ is unchanged: serving, the tests and the READMEs still use the "
              "committed models. Serve these with DJIR_MODELS_DIR, or re-run with --promote "
              "to replace them (the headline numbers and the pinned tests will change).")
    print()

    # ── Sanity-check quotes ──────────────────────────────────────────────────
    print("Example quotes (Tresnjevka → Donji grad):")
    for q in sample_quotes(eta_pipe, surge_pipe):
        print(f"  {q['scenario']:34}  ETA {q['eta_minutes']:>4} min  "
              f"surge {q['surge_multiplier']:.2f}×  →  €{q['total_fare_eur']:.2f}")


if __name__ == "__main__":
    main()
