# Databricks notebook source
# MAGIC %md
# MAGIC # 04 · Feature engineering — the ML feature table
# MAGIC
# MAGIC Builds `features_rides`: the exact union of the columns the ETA and surge
# MAGIC models consume (defined once in `djir_ml.config`), plus both labels. By
# MAGIC reading the feature lists from `config` we guarantee training here, the local
# MAGIC pipeline and serving all agree on the schema.
# MAGIC
# MAGIC In a larger setup this table would live in the **Databricks Feature Store**;
# MAGIC a plain Delta table keeps the demo self-contained while staying drop-in
# MAGIC compatible.

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
SILVER_TABLE = f"{CATALOG}.{SCHEMA}.silver_rides"
FEATURES_TABLE = f"{CATALOG}.{SCHEMA}.features_rides"
spark.sql(f"USE CATALOG {CATALOG}"); spark.sql(f"USE SCHEMA {SCHEMA}")

# COMMAND ----------

from pyspark.sql import functions as F

silver = spark.table(SILVER_TABLE)

# Re-derive the temporal features defensively (cheap, and makes this notebook
# robust even if an upstream change drops them). Matches djir_ml.pricing exactly.
feat = (
    silver
    .withColumn("is_weekend", (F.col("day_of_week") >= 5).cast("int"))
    .withColumn(
        "is_rush_hour",
        (
            (F.col("day_of_week") < 5)
            & (
                F.col("hour_of_day").between(*config.MORNING_RUSH)
                | F.col("hour_of_day").between(*config.EVENING_RUSH)
            )
        ).cast("int"),
    )
)

keep = (
    ["ride_id", "requested_at"]
    + sorted(set(config.ETA_FEATURES) | set(config.SURGE_FEATURES))
    + [config.ETA_TARGET, config.SURGE_TARGET, "fare_amount_eur"]
)
feat = feat.select(*keep)

feat.write.format("delta").mode("overwrite").option(
    "overwriteSchema", "true"
).saveAsTable(FEATURES_TABLE)

print(f"features_rides rows: {feat.count():,}")
print("columns:", feat.columns)
display(feat.limit(5))

# COMMAND ----------

# MAGIC %md ✅ Continue with **`05_train_eta`** and **`06_train_surge`**.
