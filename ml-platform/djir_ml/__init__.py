"""Djir ML platform — shared library.

A small, dependency-light package shared by the data simulator, the Databricks
medallion + training notebooks, the FastAPI serving layer and (by deliberate
mirroring) the mobile app's pricing fallback. `config.py` is the single source
of truth; everything else derives from it.

Submodules are imported on demand (`from djir_ml import train`), never eagerly
here: `train` needs scikit-learn + XGBoost, and the notebooks that only read
`config` or `pricing` must not require them.
"""

__all__ = ["artifacts", "config", "features", "geo", "predict", "pricing", "simulate", "train"]
__version__ = "1.1.0"
