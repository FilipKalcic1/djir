# Databricks notebook source
# MAGIC %md
# MAGIC # 05 · Train the ETA model (MLflow + Unity Catalog)
# MAGIC
# MAGIC Trains the trip-duration regressor on `features_rides` using the **same**
# MAGIC `djir_ml.train.train_eta` code the local pipeline ran — so the model you
# MAGIC register here is identical in logic to the one verified on a laptop. We log
# MAGIC params, metrics and the model to MLflow and register it to Unity Catalog with
# MAGIC a `@champion` alias that serving reads.
# MAGIC
# MAGIC Evaluation is a **time-based** hold-out (most recent 20%), compared with
# MAGIC two baselines: the naive flat-speed ETA and the informed heuristic Djir
# MAGIC falls back to. The informed one is the honest bar.

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
MODEL_NAME = f"{CATALOG}.{SCHEMA}.{config.ETA_REGISTERED_MODEL}"

# COMMAND ----------

import mlflow
import mlflow.sklearn

mlflow.set_registry_uri("databricks-uc")          # register models in Unity Catalog
mlflow.set_experiment(config.MLFLOW_EXPERIMENT)

# Pull the feature table to pandas (≈65k rows fits comfortably on the driver).
pdf = spark.table(FEATURES_TABLE).toPandas()
pdf["requested_at"] = __import__("pandas").to_datetime(pdf["requested_at"])
print(f"Training rows: {len(pdf):,}")

# COMMAND ----------

with mlflow.start_run(run_name="eta_xgboost") as run:
    pipe, metrics = train.train_eta(pdf)

    mlflow.log_params({
        "algorithm": "XGBRegressor",
        "target": config.ETA_TARGET,
        "features": ",".join(config.ETA_FEATURES),
        "split": "time-based 80/20",
    })
    mlflow.log_metrics({f"test_{k}": v for k, v in metrics["model"].items()})
    mlflow.log_metric("naive_mae", metrics["baseline_naive_flat_speed"]["mae"])
    mlflow.log_metric("mae_improvement_pct", metrics["mae_improvement_pct"])
    mlflow.log_metric("informed_mae", metrics["baseline_informed_heuristic"]["mae"])
    mlflow.log_metric("mae_improvement_vs_informed_pct", metrics["mae_improvement_vs_informed_pct"])
    # The whole report (baselines, n_train), which notebook 07 exports with the model.
    mlflow.log_dict(metrics, "metrics.json")

    sample = pdf[config.ETA_FEATURES].head(3)
    # artifact_path (not name=) is accepted by both MLflow 2.x and 3.x.
    mlflow.sklearn.log_model(
        pipe,
        artifact_path="model",
        serialization_format="cloudpickle",
        input_example=sample,
        registered_model_name=MODEL_NAME,
    )

print(f"ETA test MAE {metrics['model']['mae']:.2f} min  "
      f"(naive {metrics['baseline_naive_flat_speed']['mae']:.2f}, "
      f"-{metrics['mae_improvement_pct']:.1f}%; informed "
      f"{metrics['baseline_informed_heuristic']['mae']:.2f})  R²={metrics['model']['r2']:.3f}")

# COMMAND ----------

# MAGIC %md ### Promote the new version to `@champion`

# COMMAND ----------

from mlflow import MlflowClient

# Unity Catalog does NOT support get_latest_versions(); use the UC-supported
# search_model_versions and take the highest version number.
client = MlflowClient(registry_uri="databricks-uc")
latest = max(int(mv.version) for mv in client.search_model_versions(f"name='{MODEL_NAME}'"))
client.set_registered_model_alias(MODEL_NAME, "champion", latest)
print(f"{MODEL_NAME} v{latest} → @champion")

# COMMAND ----------

# MAGIC %md ✅ Continue with **`06_train_surge`**.
