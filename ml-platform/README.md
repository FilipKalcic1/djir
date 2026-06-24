<div align="center">

# 🧠 Djir ML Platform

**A lakehouse + ML system that turns Djir from a ride-hailing *app* into a ride-hailing *platform*.**

Synthetic Zagreb ride events → Databricks medallion lakehouse → XGBoost ETA &
dynamic-surge models (MLflow + Unity Catalog) → a serving endpoint the mobile app
calls for a real, condition-aware price.

</div>

---

## Why this exists

The Djir mobile app, on its own, shows fixed seed drivers and a naive fare. This
platform replaces the guesswork with a data product:

> **Same trip, different price.** Tresnjevka → Donji grad costs **€5.86** on a
> quiet weekday afternoon and **€9.74** on a rainy Saturday night — because a
> model trained on 64,610 rides learned the city's congestion and demand.

It demonstrates the end-to-end skills a data/ML role actually needs —
ingestion, the medallion architecture, feature engineering, experiment tracking,
model registry, serving, and closing the loop back into a product — rather than
just another front-end clone.

## Results (time-based hold-out, most recent 20% of rides)

| Model | Predicts | Test MAE | Naive baseline | Improvement | R² |
|---|---|---|---|---|---|
| **ETA** | trip duration (min) | **3.18 min** | 7.58 min (flat-speed) | **−58%** | **0.883** |
| **Surge** | price multiplier (×) | **0.065×** | 0.263× (global mean) | **−75%** | **0.938** |

_Models: scikit-learn `Pipeline` (one-hot → `XGBRegressor`). Numbers reproduced
by `scripts/run_local.py`; see `models/metrics.json`._

## Architecture

```
 Mobile app (ride request)
        │  POST /(api)/predict-price
        ▼
 Expo API route ──────────► Djir Smart-Pricing endpoint  (FastAPI / Databricks Model Serving)
   (heuristic fallback)         │  loads @champion ETA + surge models
                                ▼
                       ┌─────────────── Databricks Lakehouse ───────────────┐
   ride events ──►  Bronze ──►  Silver ──►  Gold ──►  Feature table          │
   (Auto Loader)   (raw Delta) (clean,    (zone/day  (ETA + surge features)   │
                                validated)  KPIs)        │                    │
                                                         ▼                    │
                                          XGBoost training + MLflow tracking  │
                                          → Unity Catalog model registry      │
                                          → @champion alias                   │
                                └─────────────────────────────────────────────┘
```

The same `djir_ml` Python package powers the local pipeline, the Databricks
notebooks and the serving layer — one source of truth, no copy-paste drift. The
mobile app's TypeScript fallback (`lib/pricing.ts`) is a deliberate line-for-line
port of `djir_ml/pricing.py`, verified to agree to the cent.

## What is real vs. synthetic (honest by design)

* **Real engineering:** the medallion pipeline, feature engineering, XGBoost
  training, MLflow tracking, Unity Catalog registration, the FastAPI service and
  the app integration are all real and runnable.
* **Synthetic data:** there is no proprietary ride log to learn from, so
  `djir_ml/simulate.py` generates a realistic one — commute flows, rush-hour
  congestion, weather effects and demand/supply-driven surge. The models recover
  that structure (see ADR-003). On real data you would simply skip the generator;
  every other component stays the same.

## Repo layout

```
ml-platform/
├── djir_ml/                 # shared library (the single source of truth)
│   ├── config.py            # zones, pricing constants, feature contracts
│   ├── geo.py               # haversine + zone assignment
│   ├── pricing.py           # deterministic ETA/fare physics (+ heuristic surge)
│   ├── simulate.py          # the Zagreb ride-event generator
│   ├── features.py          # request → model features
│   ├── train.py             # ETA + surge training (time split, baselines)
│   └── predict.py           # compose models → price quote
├── scripts/
│   ├── generate_data.py     # write the dataset to data/
│   └── run_local.py         # END-TO-END local proof (gen → train → MLflow → quotes)
├── notebooks/               # Databricks notebooks (00–08, source format)
├── serving/                 # FastAPI app + Dockerfile
├── models/                  # committed: trained models + metrics.json
└── sample_rides.csv         # 200-row preview of the dataset
```

## Quickstart — run the whole thing locally (no Databricks needed)

```bash
cd ml-platform
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 1) generate data + train both models + log to MLflow + print example quotes
python scripts/run_local.py --fresh

# 2) serve the models
uvicorn serving.app:app --port 8000
#    → open http://localhost:8000/docs  or:
curl -X POST localhost:8000/predict-price -H "Content-Type: application/json" \
  -d '{"pickup_lat":45.80,"pickup_lng":15.945,"dropoff_lat":45.8085,"dropoff_lng":15.9775,"when":"2025-06-07T23:30:00","weather":"rain"}'
```

Or containerized:

```bash
cd ml-platform
docker build -f serving/Dockerfile -t djir-pricing .
docker run -p 8000:8000 djir-pricing
```

## Connect the mobile app to the model

Set one variable in the app's `.env` and the booking flow uses live ML prices
(it falls back to the built-in heuristic if the endpoint is down):

```
ML_ENDPOINT_URL=http://<your-host>:8000
```

## Run it on Databricks

1. **Repos / Git folders:** add this GitHub repo to your workspace so `djir_ml`
   is importable (the notebooks auto-detect their path).
2. Run the notebooks in order:
   `00_setup` → `01_ingest_bronze` → `02_transform_silver` → `03_aggregate_gold`
   → `04_feature_engineering` → `05_train_eta` → `06_train_surge`
   → `07_register_and_serve`.
3. Build the dashboard from `08_analytics_dashboard.sql` in Databricks SQL.

> **Free tier:** use **Databricks Free Edition** (serverless, includes Unity
> Catalog + MLflow). If managed Model Serving isn't available on your tier, notebook
> `07` also exports the `@champion` models to `models/*.joblib` for the FastAPI
> path — identical artifacts, different host (ADR-004).

See [`../docs/architecture.md`](../docs/architecture.md) for the full design and
the architecture decision records.
