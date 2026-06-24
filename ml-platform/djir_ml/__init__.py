"""Djir ML platform — shared library.

A small, dependency-light package shared by the data simulator, the Databricks
medallion + training notebooks, the FastAPI serving layer and (by deliberate
mirroring) the mobile app's pricing fallback. `config.py` is the single source
of truth; everything else derives from it.
"""

from . import config, features, geo, predict, pricing, simulate, train  # noqa: F401

__all__ = ["config", "features", "geo", "predict", "pricing", "simulate", "train"]
__version__ = "1.0.0"
