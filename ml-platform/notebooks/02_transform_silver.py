# Databricks notebook source
# MAGIC %md
# MAGIC # 02 · Silver — clean, validate & conform
# MAGIC
# MAGIC Silver turns raw Bronze events into a trustworthy, analytics-ready table:
# MAGIC
# MAGIC * enforce types and a stable schema,
# MAGIC * **drop cancelled rides** and rows with missing duration/fare (≈3.5% of
# MAGIC   Bronze — the data-quality work this layer exists for),
# MAGIC * range-check distance / fare / surge and de-duplicate on `ride_id`,
# MAGIC * keep only completed, paid trips downstream.
# MAGIC
# MAGIC A Delta `CHECK` constraint guards the surge range so bad data can never be
# MAGIC appended silently.

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
BRONZE_TABLE = f"{CATALOG}.{SCHEMA}.bronze_rides"
SILVER_TABLE = f"{CATALOG}.{SCHEMA}.silver_rides"
spark.sql(f"USE CATALOG {CATALOG}"); spark.sql(f"USE SCHEMA {SCHEMA}")

# COMMAND ----------

from pyspark.sql import functions as F
from pyspark.sql import Window

bronze = spark.table(BRONZE_TABLE)
raw_count = bronze.count()

silver = (
    bronze
    # ── type enforcement ────────────────────────────────────────────────────
    .withColumn("requested_at", F.to_timestamp("requested_at"))
    .withColumn("trip_distance_km", F.col("trip_distance_km").cast("double"))
    .withColumn("duration_min", F.col("duration_min").cast("double"))
    .withColumn("fare_amount_eur", F.col("fare_amount_eur").cast("double"))
    .withColumn("surge_multiplier", F.col("surge_multiplier").cast("double"))
    .withColumn("hour_of_day", F.col("hour_of_day").cast("int"))
    .withColumn("day_of_week", F.col("day_of_week").cast("int"))
    # ── data-quality filters ────────────────────────────────────────────────
    .filter(F.col("payment_status") == "paid")
    .filter(F.col("duration_min").isNotNull() & F.col("fare_amount_eur").isNotNull())
    .filter(F.col("trip_distance_km") > 0)
    .filter(F.col("fare_amount_eur") > 0)
    .filter(F.col("surge_multiplier").between(config.SURGE_MIN, config.SURGE_MAX))
)

# ── de-duplicate on ride_id (keep earliest ingested) ────────────────────────
w = Window.partitionBy("ride_id").orderBy(F.col("_ingested_at").asc())
silver = (
    silver.withColumn("_rn", F.row_number().over(w))
    .filter(F.col("_rn") == 1)
    .drop("_rn")
)

clean_count = silver.count()
print(f"Bronze rows      : {raw_count:,}")
print(f"Silver rows      : {clean_count:,}")
print(f"Dropped (quality): {raw_count - clean_count:,} "
      f"({(raw_count - clean_count) / raw_count * 100:.1f}%)")

# COMMAND ----------

# MAGIC %md ### Write Silver + add a guard constraint

# COMMAND ----------

(
    silver.write.format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .saveAsTable(SILVER_TABLE)
)

# A CHECK constraint so future appends can never violate the surge range.
try:
    spark.sql(
        f"ALTER TABLE {SILVER_TABLE} ADD CONSTRAINT surge_range "
        f"CHECK (surge_multiplier >= {config.SURGE_MIN} AND surge_multiplier <= {config.SURGE_MAX})"
    )
except Exception as e:
    print("Constraint already present or skipped:", str(e)[:120])

display(spark.table(SILVER_TABLE).limit(5))

# COMMAND ----------

# MAGIC %md ✅ Continue with **`03_aggregate_gold`**.
