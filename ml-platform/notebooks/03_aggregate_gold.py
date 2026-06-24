# Databricks notebook source
# MAGIC %md
# MAGIC # 03 · Gold — business aggregates
# MAGIC
# MAGIC Gold tables are small, fast and shaped for the dashboard and ops:
# MAGIC
# MAGIC | Table | Grain | Powers |
# MAGIC |---|---|---|
# MAGIC | `gold_zone_hourly` | zone × hour × weekday | demand heatmap, surge map |
# MAGIC | `gold_daily_kpis`  | day | revenue / rides / surge trend |
# MAGIC | `gold_zone_flows`  | pickup → dropoff | origin-destination flows |

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
spark.sql(f"USE CATALOG {CATALOG}"); spark.sql(f"USE SCHEMA {SCHEMA}")

# COMMAND ----------

from pyspark.sql import functions as F

silver = spark.table(SILVER_TABLE)

# ── Gold 1: zone × hour × weekday demand + pricing ──────────────────────────
gold_zone_hourly = (
    silver.groupBy("pickup_zone", "hour_of_day", "day_of_week")
    .agg(
        F.count("*").alias("rides"),
        F.round(F.avg("fare_amount_eur"), 2).alias("avg_fare_eur"),
        F.round(F.sum("fare_amount_eur"), 2).alias("revenue_eur"),
        F.round(F.avg("surge_multiplier"), 3).alias("avg_surge"),
        F.round(F.avg("duration_min"), 2).alias("avg_duration_min"),
        F.round(F.avg("trip_distance_km"), 2).alias("avg_distance_km"),
    )
)
gold_zone_hourly.write.format("delta").mode("overwrite").option(
    "overwriteSchema", "true"
).saveAsTable(f"{CATALOG}.{SCHEMA}.gold_zone_hourly")

# ── Gold 2: daily KPIs ──────────────────────────────────────────────────────
gold_daily_kpis = (
    silver.groupBy("date")
    .agg(
        F.count("*").alias("rides"),
        F.round(F.sum("fare_amount_eur"), 2).alias("revenue_eur"),
        F.round(F.avg("fare_amount_eur"), 2).alias("avg_fare_eur"),
        F.round(F.avg("surge_multiplier"), 3).alias("avg_surge"),
        F.round(F.avg("duration_min"), 2).alias("avg_duration_min"),
        F.countDistinct("user_id").alias("active_users"),
        F.countDistinct("driver_id").alias("active_drivers"),
    )
    .orderBy("date")
)
gold_daily_kpis.write.format("delta").mode("overwrite").option(
    "overwriteSchema", "true"
).saveAsTable(f"{CATALOG}.{SCHEMA}.gold_daily_kpis")

# ── Gold 3: origin → destination flows ──────────────────────────────────────
gold_zone_flows = (
    silver.groupBy("pickup_zone", "dropoff_zone")
    .agg(
        F.count("*").alias("rides"),
        F.round(F.avg("trip_distance_km"), 2).alias("avg_distance_km"),
        F.round(F.avg("fare_amount_eur"), 2).alias("avg_fare_eur"),
    )
)
gold_zone_flows.write.format("delta").mode("overwrite").option(
    "overwriteSchema", "true"
).saveAsTable(f"{CATALOG}.{SCHEMA}.gold_zone_flows")

print("Gold tables written: gold_zone_hourly, gold_daily_kpis, gold_zone_flows")

# COMMAND ----------

# MAGIC %md ### Peek: busiest zone-hours by average surge

# COMMAND ----------

display(
    spark.table(f"{CATALOG}.{SCHEMA}.gold_zone_hourly")
    .orderBy(F.desc("avg_surge"))
    .limit(10)
)

# COMMAND ----------

# MAGIC %md ✅ Continue with **`04_feature_engineering`**.
