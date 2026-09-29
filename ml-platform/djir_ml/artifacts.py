"""Where a training run's serving artifacts go, and how they are written.

Shared by `scripts/run_local.py` and notebook `07_register_and_serve`, so the
two writers of models/ follow one rule: `models/` is committed (serving, the
tests and both READMEs use it) and a retrain does not reproduce it bit for bit,
so a run writes to `data/models/` (git-ignored) unless it is asked to promote.
The two joblib pipelines always travel with the `metrics.json` that describes
them, so `/metrics` and the READMEs never describe other models.
"""

from __future__ import annotations

import json
from pathlib import Path

from djir_ml.config import DATA_DIR, ETA_MODEL_FILE, METRICS_FILE, MODELS_DIR, SURGE_MODEL_FILE


def artifacts_dir(ml_root: str | Path, promote: bool) -> Path:
    """`<ml_root>/models/` when promoting a retrain, else `<ml_root>/data/models/`."""
    root = Path(ml_root)
    return root / MODELS_DIR if promote else root / DATA_DIR / MODELS_DIR


def save_artifacts(eta_pipe, surge_pipe, metrics: dict, out_dir: str | Path) -> None:
    """Write the two joblib pipelines and their metrics.json into `out_dir`."""
    import joblib  # the notebooks' config-only imports must not need it

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump(eta_pipe, out / ETA_MODEL_FILE)
    joblib.dump(surge_pipe, out / SURGE_MODEL_FILE)
    with open(out / METRICS_FILE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(metrics, f, indent=2)
