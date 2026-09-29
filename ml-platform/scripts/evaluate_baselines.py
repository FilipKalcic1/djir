"""
Re-score the COMMITTED models against both baselines, without retraining.

The ETA model's honest bar is not the naive flat-speed ETA but the informed
heuristic Djir already ships as its fallback (it knows congestion and weather).
This script regenerates the deterministic dataset (seed 42), rebuilds the same
time-based hold-out that training used, and rewrites models/metrics.json with
the model's numbers and both baselines, so the README can report all of them.

Usage (from ml-platform/):
    python scripts/evaluate_baselines.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib

ML_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_ROOT))

from djir_ml import simulate, train  # noqa: E402
from djir_ml.config import ETA_MODEL_FILE, METRICS_FILE, MODELS_DIR, SURGE_MODEL_FILE  # noqa: E402


def main() -> None:
    models = ML_ROOT / MODELS_DIR
    df = simulate.generate()
    train_df, test_df = train.time_split(train.prepare(df))

    eta = train.evaluate_eta(joblib.load(models / ETA_MODEL_FILE), len(train_df), test_df)
    surge = train.evaluate_surge(joblib.load(models / SURGE_MODEL_FILE), train_df, test_df)

    with open(models / METRICS_FILE, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps({"eta": eta, "surge": surge}, indent=2) + "\n")
    for name, m in (("ETA", eta), ("Surge", surge)):
        naive_key = "baseline_naive_flat_speed" if name == "ETA" else "baseline_mean"
        print(
            f"{name:5}  model MAE {m['model']['mae']:.4f}  "
            f"naive {m[naive_key]['mae']:.4f} ({m['mae_improvement_pct']:+.1f}%)  "
            f"informed {m['baseline_informed_heuristic']['mae']:.4f} "
            f"({m['mae_improvement_vs_informed_pct']:+.1f}%)"
        )


if __name__ == "__main__":
    main()
