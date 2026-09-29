<div align="center">

# 🧠 Djir ML Platform

**A lakehouse + ML system that turns Djir from a ride-hailing *app* into a ride-hailing *platform*.**

Synthetic Zagreb ride events → Databricks medallion lakehouse → XGBoost ETA &
dynamic-surge models (MLflow + Unity Catalog) → a serving endpoint the mobile app
calls for a real, condition-aware price.

</div>

---

## Why this exists

Without a model endpoint, the Djir app prices every trip with a fixed formula
that knows rush hour and weather. This platform adds a data product that learns
congestion and demand from ride events:

> **Same trip, different price.** Tresnjevka → Donji grad costs **€5.86** on a
> quiet weekday afternoon and **€9.74** on a rainy Saturday night, because the
> models learned the city's congestion and demand from simulated rides: they
> were trained on 49,944 of 64,610 (cancelled and incomplete rides are dropped,
> and the most recent 20% of the rest is held out for the test).

It demonstrates the end-to-end skills a data/ML role actually needs —
ingestion, the medallion architecture, feature engineering, experiment tracking,
model registry, serving, and closing the loop back into a product — rather than
just another front-end clone.

## Results (time-based hold-out, most recent 20% of rides)

| Model | Predicts | Test MAE | Naive baseline | Informed heuristic | R² |
|---|---|---|---|---|---|
| **ETA** | trip duration (min) | **3.18 min** | 7.58 min (flat speed) · model −58% | 3.12 min · model **+2%** | **0.883** |
| **Surge** | price multiplier (×) | **0.065×** | 0.263× (global mean) · model −75% | 0.193× · model **−66%** | **0.938** |

**How to read this.** The *naive* baselines are the simplest guesses: one flat
speed for every trip, and the mean surge for every request. The *informed*
heuristic is Djir's own fallback, and it is the honest bar. It already knows
rush hour and weather, because it uses the same physics the simulator generated
the data with. On ETA the model does **not** beat it (3.18 vs 3.12 min), which
is the expected result on synthetic data whose ground truth *is* that formula.
On surge the model cuts the error by two thirds, but not all of that is zones
and interactions the formula ignores: the heuristic's surge is also known to be
miscalibrated against the data (review finding R62, deferred: Friday nights too
low, Sunday nights too high), so part of the gap is plain hour × day × weather
calibration, and how much is not measured. With real trip logs the ETA
comparison would be the one to watch.

_Models: scikit-learn `Pipeline` (one-hot → `XGBRegressor`). The committed
models and these numbers come from the local run, `scripts/run_local.py`, which
trains with the same `djir_ml` code as notebooks 05 and 06; no Databricks run is
recorded. It retrains into `data/models/` (`--promote` replaces the committed
ones); `scripts/evaluate_baselines.py` re-scores the committed models against
both baselines. See `models/metrics.json`: `tests/test_project.py` checks this
table and the root README's against it._

## Architecture

```
 Mobile app (ride request)
        │  POST /(api)/predict-price
        ▼
 Expo API route ──────────► Djir Smart-Pricing endpoint  (FastAPI, serving/app.py)
   (heuristic fallback)         │  loads models/*.joblib — exported from @champion
                                │  by notebook 07 or run_local.py, when promoted
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
port of `djir_ml/pricing.py`. It agrees to the cent on 442 golden trips (30 of
them straddling the DST switches, 12 with an ETA on a rounding tie where
JavaScript's `Math.round` and Python's `round` disagree) plus 30 rounding cases,
all exported from Python by `scripts/export_parity_fixtures.py`. Jest asserts
the port against them, and pytest fails if the committed fixture goes stale.

## What is real vs. synthetic (honest by design)

* **Real engineering:** the medallion pipeline, feature engineering, XGBoost
  training, MLflow tracking, Unity Catalog registration, the FastAPI service and
  the app integration are all real and runnable.
* **Synthetic data:** there is no proprietary ride log to learn from, so
  `djir_ml/simulate.py` generates a realistic one — commute flows, rush-hour
  congestion, weather effects and demand/supply-driven surge. The models recover
  that structure (see ADR-003). Real data would replace the generator, but not
  as a drop-in: the app's `rides` table lacks most of the columns Silver needs,
  so it first needs a ride-event data contract (review finding R72, deferred).

## Repo layout

```
ml-platform/
├── djir_ml/                 # shared library (the single source of truth)
│   ├── artifacts.py         # where a run writes the models + metrics.json (run_local, notebook 07)
│   ├── config.py            # zones, pricing constants, feature contracts
│   ├── geo.py               # haversine + zone assignment
│   ├── pricing.py           # deterministic ETA/fare physics (+ heuristic surge)
│   ├── simulate.py          # the Zagreb ride-event generator
│   ├── features.py          # request → model features
│   ├── train.py             # ETA + surge training (time split, baselines)
│   └── predict.py           # compose models → price quote
├── scripts/
│   ├── generate_data.py     # write the dataset to data/
│   ├── run_local.py         # END-TO-END local proof (gen → train → MLflow → quotes)
│   ├── evaluate_baselines.py  # re-score the committed models vs both baselines
│   ├── export_parity_fixtures.py  # golden trips for the app's TS pricing port
│   └── plot_price_by_time.py  # the root README's chart, from the committed models
├── notebooks/               # Databricks notebooks (00–08, source format)
├── serving/                 # FastAPI app + Dockerfile
├── models/                  # committed: trained models + metrics.json
├── tests/                   # pytest: clock, serving, parity fixture, repo promises
└── sample_rides.csv         # 200-row preview of the dataset
```

## Quickstart — run the whole thing locally (no Databricks needed)

```bash
cd ml-platform
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 1) generate data + train both models + log to MLflow + print example quotes.
#    The new models and metrics.json go to data/models/; models/ is untouched.
python scripts/run_local.py --fresh

# 2) serve the committed models (DJIR_MODELS_DIR=data/models serves the new ones)
uvicorn serving.app:app --port 8000
#    → open http://localhost:8000/docs  or:
curl -X POST localhost:8000/predict-price -H "Content-Type: application/json" \
  -d '{"pickup_lat":45.80,"pickup_lng":15.945,"dropoff_lat":45.8085,"dropoff_lng":15.9775,"when":"2025-06-07T23:30:00+02:00","weather":"rain"}'
```

**Promoting a retrain.** `python scripts/run_local.py --promote`, or notebook 07
with its `promote` widget set to `true`, writes to `models/` instead, which is
what serving, the tests and both READMEs use. A
retrain does not reproduce the committed models bit for bit, so promoting one
changes the headline numbers: the €5.86 / €9.74 quotes, the metrics tables and
the chart. The tests pinned to them then fail until you update the READMEs,
re-run `scripts/plot_price_by_time.py` and update the numbers pinned in
`tests/test_serving.py` and `tests/test_project.py`. Compare
`data/models/metrics.json` with `models/metrics.json` before you promote.

Run the tests (`pytest.ini` turns a scikit-learn version mismatch into an error):

```bash
pip install -r requirements-dev.txt
pytest
```

Or containerized:

```bash
cd ml-platform
docker build -f serving/Dockerfile -t djir-pricing .
docker run -p 8000:8000 djir-pricing
```

The container's `HEALTHCHECK` is a liveness check: `/health` answers 200 while
the API can quote, and that includes the heuristic fallback. Whether the models
are pricing is its `models_loaded` field (with `load_error` saying why not).
The CI workflow's `serving` job builds the image with the same command and
starts it, then requires `models_loaded: true`, a non-root process and Docker's
own health status `healthy`.

## Connect the mobile app to the model

Set one server-side variable in the app's `.env.local` and the booking flow uses
live ML prices. The app falls back to its built-in heuristic if the endpoint is
unset, slower than 2.5 s, or failing:

```
ML_ENDPOINT_URL=http://<your-host>:8000
```

The URL must be this FastAPI service. It composes ETA, surge and fare into the
one quote the app expects. A Databricks Model Serving endpoint scores a single
model and needs a workspace token, so it cannot be used as `ML_ENDPOINT_URL`
directly.

## Run it on Databricks

1. **Repos / Git folders:** add this GitHub repo to your workspace so `djir_ml`
   is importable (the notebooks auto-detect their path).
2. Run the notebooks in order:
   `00_setup` → `01_ingest_bronze` → `02_transform_silver` → `03_aggregate_gold`
   → `04_feature_engineering` → `05_train_eta` → `06_train_surge`
   → `07_register_and_serve`.
3. Build the dashboard from `08_analytics_dashboard.sql` in Databricks SQL.

> **Free tier:** use **Databricks Free Edition** (serverless, includes Unity
> Catalog + MLflow). Notebook `07` first exports the `@champion` models, with
> the `metrics.json` notebooks 05 and 06 logged, for the FastAPI container,
> which works on every tier. It then creates managed Model Serving endpoints
> where the tier offers them (ADR-004).
>
> Like `run_local.py`, notebook 07 writes to `data/models/` in the Git folder
> (git-ignored; serve it with `DJIR_MODELS_DIR=data/models`). Its `promote`
> widget replaces the committed `models/` instead, with the caveat above: a
> retrain changes the headline numbers and the tests pinned to them, so compare
> `data/models/metrics.json` with `models/metrics.json` first.

See [`../docs/architecture.md`](../docs/architecture.md) for the full design and
the architecture decision records.
