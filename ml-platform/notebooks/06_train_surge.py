# Databricks notebook source
# MAGIC %md
# MAGIC # 06 · Train the surge model (MLflow + Unity Catalog)
# MAGIC
# MAGIC Trains the dynamic-pricing multiplier regressor from time × place × weather
# MAGIC features (everything observable the moment a rider opens the app). Same
# MAGIC structure as the ETA notebook: `djir_ml.train.train_surge`, MLflow logging,
# MAGIC Unity Catalog registration, `@champion` alias. Baselines: the global
# MAGIC average surge for everyone, and Djir's informed heuristic surge.

# COMMAND ----------

# MAGIC %md ### Install the pinned training stack
# MAGIC `djir_ml.train` needs scikit-learn and XGBoost at the exact versions the
# MAGIC committed artifacts were built with (see `requirements.txt`).

# COMMAND ----------

# MAGIC %pip install -q scikit-learn==1.9.0 xgboost==3.3.0

# COMMAND ----------

dbutils.library.restartPython()

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

from djir_ml import config, train  # noqa: E402

CATALOG, SCHEMA = config.UC_CATALOG, config.UC_SCHEMA
FEATURES_TABLE = f"{CATALOG}.{SCHEMA}.features_rides"
MODEL_NAME = f"{CATALOG}.{SCHEMA}.{config.SURGE_REGISTERED_MODEL}"

# COMMAND ----------

import mlflow
import mlflow.sklearn
import pandas as pd

mlflow.set_registry_uri("databricks-uc")
mlflow.set_experiment(config.MLFLOW_EXPERIMENT)

pdf = spark.table(FEATURES_TABLE).toPandas()
pdf["requested_at"] = pd.to_datetime(pdf["requested_at"])
print(f"Training rows: {len(pdf):,}")

# COMMAND ----------

with mlflow.start_run(run_name="surge_xgboost") as run:
    pipe, metrics = train.train_surge(pdf)

    mlflow.log_params({
        "algorithm": "XGBRegressor",
        "target": config.SURGE_TARGET,
        "features": ",".join(config.SURGE_FEATURES),
        "split": "time-based 80/20",
    })
    mlflow.log_metrics({f"test_{k}": v for k, v in metrics["model"].items()})
    mlflow.log_metric("baseline_mean_mae", metrics["baseline_mean"]["mae"])
    mlflow.log_metric("mae_improvement_pct", metrics["mae_improvement_pct"])
    mlflow.log_metric("informed_mae", metrics["baseline_informed_heuristic"]["mae"])
    mlflow.log_metric("mae_improvement_vs_informed_pct", metrics["mae_improvement_vs_informed_pct"])
    # The whole report (baselines, n_train), which notebook 07 exports with the model.
    mlflow.log_dict(metrics, "metrics.json")

    sample = pdf[config.SURGE_FEATURES].head(3)
    # artifact_path (not name=) is accepted by both MLflow 2.x and 3.x.
    mlflow.sklearn.log_model(
        pipe,
        artifact_path="model",
        serialization_format="cloudpickle",
        input_example=sample,
        registered_model_name=MODEL_NAME,
    )

print(f"Surge test MAE {metrics['model']['mae']:.3f}x  "
      f"(baseline {metrics['baseline_mean']['mae']:.3f}, "
      f"-{metrics['mae_improvement_pct']:.1f}%)  R²={metrics['model']['r2']:.3f}")

# COMMAND ----------

from mlflow import MlflowClient

# Unity Catalog does NOT support get_latest_versions(); use the UC-supported
# search_model_versions and take the highest version number.
client = MlflowClient(registry_uri="databricks-uc")
latest = max(int(mv.version) for mv in client.search_model_versions(f"name='{MODEL_NAME}'"))
client.set_registered_model_alias(MODEL_NAME, "champion", latest)
print(f"{MODEL_NAME} v{latest} → @champion")

# COMMAND ----------

# MAGIC %md ✅ Continue with **`07_register_and_serve`**.
