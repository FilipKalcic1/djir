# Databricks notebook source
# MAGIC %md
# MAGIC # 07 · Serve the models
# MAGIC
# MAGIC Two complementary serving paths (see ADR-004):
# MAGIC
# MAGIC 1. **Databricks Model Serving** — managed, autoscaling REST endpoints for
# MAGIC    each registered model. Shown here.
# MAGIC 2. **Portable export** — download the `@champion` pipelines to `joblib`
# MAGIC    artifacts the FastAPI container serves anywhere (and which compose the ETA
# MAGIC    + surge predictions into a single price quote for the mobile app).
# MAGIC
# MAGIC > On free Databricks tiers, managed Model Serving may be unavailable — that
# MAGIC > is exactly why the portable export + FastAPI path exists. The model
# MAGIC > artifacts are identical either way.

# COMMAND ----------

import sys

try:
    nb_path = (
        dbutils.notebook.entry_point.getDbutils()
        .notebook().getContext().notebookPath().get()
    )
    ML_PLATFORM = "/Workspace" + "/".join(nb_path.split("/")[:-2])
except Exception:
    ML_PLATFORM = "/Workspace/Repos/<your-user>/djir/ml-platform"
if ML_PLATFORM not in sys.path:
    sys.path.insert(0, ML_PLATFORM)

from djir_ml import config  # noqa: E402

CATALOG, SCHEMA = config.UC_CATALOG, config.UC_SCHEMA
ETA_MODEL = f"{CATALOG}.{SCHEMA}.{config.ETA_REGISTERED_MODEL}"
SURGE_MODEL = f"{CATALOG}.{SCHEMA}.{config.SURGE_REGISTERED_MODEL}"

# COMMAND ----------

# MAGIC %md ### Sanity-check: load `@champion` from Unity Catalog and score

# COMMAND ----------

import mlflow
import pandas as pd

mlflow.set_registry_uri("databricks-uc")

eta = mlflow.sklearn.load_model(f"models:/{ETA_MODEL}@champion")
surge = mlflow.sklearn.load_model(f"models:/{SURGE_MODEL}@champion")

example = pd.DataFrame([{
    "trip_distance_km": 2.69, "hour_of_day": 8, "day_of_week": 1,
    "is_weekend": 0, "is_rush_hour": 1, "traffic_density": 0.92,
    "pickup_zone": "Tresnjevka", "dropoff_zone": "Donji grad",
    "weather_condition": "clear",
}])
print("ETA  :", round(float(eta.predict(example[config.ETA_FEATURES])[0]), 1), "min")
print("Surge:", round(float(surge.predict(example[config.SURGE_FEATURES])[0]), 2), "x")

# COMMAND ----------

# MAGIC %md ### Path 1 — create managed Model Serving endpoints

# COMMAND ----------

from mlflow import MlflowClient
from mlflow.deployments import get_deploy_client

client = get_deploy_client("databricks")
_registry = MlflowClient(registry_uri="databricks-uc")

def ensure_endpoint(name: str, model: str):
    # Model Serving must pin a concrete entity_version (there is no alias field),
    # so resolve @champion → version first.
    version = _registry.get_model_version_by_alias(model, "champion").version
    config_ = {
        "served_entities": [{
            "entity_name": model,
            "entity_version": version,
            "workload_size": "Small",
            "scale_to_zero_enabled": True,
        }]
    }
    try:
        client.create_endpoint(name=name, config=config_)
        print(f"created endpoint: {name} (serving v{version})")
    except Exception as e:
        # Only tolerate "already exists"; re-raise genuine failures so they are
        # never silently swallowed.
        if "already exists" in str(e).lower() or "RESOURCE_ALREADY_EXISTS" in str(e):
            print(f"endpoint {name} already exists — update it to serve v{version} in the UI/API")
        else:
            raise

ensure_endpoint("djir-eta", ETA_MODEL)
ensure_endpoint("djir-surge", SURGE_MODEL)

# COMMAND ----------

# MAGIC %md
# MAGIC #### Example REST call against a serving endpoint
# MAGIC ```bash
# MAGIC curl -X POST \
# MAGIC   https://<workspace-host>/serving-endpoints/djir-eta/invocations \
# MAGIC   -H "Authorization: Bearer $DATABRICKS_TOKEN" \
# MAGIC   -H "Content-Type: application/json" \
# MAGIC   -d '{"dataframe_records": [{
# MAGIC         "trip_distance_km": 2.69, "hour_of_day": 8, "day_of_week": 1,
# MAGIC         "is_weekend": 0, "is_rush_hour": 1, "traffic_density": 0.92,
# MAGIC         "pickup_zone": "Tresnjevka", "dropoff_zone": "Donji grad",
# MAGIC         "weather_condition": "clear"}]}'
# MAGIC ```

# COMMAND ----------

# MAGIC %md ### Path 2 — export `@champion` to portable joblib artifacts
# MAGIC Writes `eta_model.joblib` + `surge_model.joblib` into the repo's `models/`
# MAGIC folder so the FastAPI serving container (which composes them into one quote)
# MAGIC can serve the Databricks-trained models unchanged.

# COMMAND ----------

import joblib
import os

models_dir = os.path.join(ML_PLATFORM, config.MODELS_DIR)
os.makedirs(models_dir, exist_ok=True)
joblib.dump(eta, os.path.join(models_dir, config.ETA_MODEL_FILE))
joblib.dump(surge, os.path.join(models_dir, config.SURGE_MODEL_FILE))
print("Exported champion models to", models_dir)

# COMMAND ----------

# MAGIC %md ✅ Pipeline complete. See **`08_analytics_dashboard.sql`** for the BI layer.
