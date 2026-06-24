# Databricks notebook source
# MAGIC %md
# MAGIC # 01 · Bronze — raw ride events → Delta
# MAGIC
# MAGIC The Bronze layer is a faithful, append-only copy of what landed: every ride
# MAGIC event exactly as the mobile backend emitted it, plus ingestion metadata. No
# MAGIC cleaning, no filtering — that is the Silver layer's job.
# MAGIC
# MAGIC We ingest with **Auto Loader** (`cloudFiles`) so the same code handles the
# MAGIC first back-fill and every future incremental file, exactly-once, with schema
# MAGIC tracking. A plain batch read is shown at the bottom as a simpler alternative.

# COMMAND ----------

import os
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
LANDING_PATH = f"/Volumes/{CATALOG}/{SCHEMA}/landing/rides"
SCHEMA_PATH = f"/Volumes/{CATALOG}/{SCHEMA}/landing/_bronze_schema"
CHECKPOINT = f"/Volumes/{CATALOG}/{SCHEMA}/landing/_bronze_checkpoint"
BRONZE_TABLE = f"{CATALOG}.{SCHEMA}.bronze_rides"

spark.sql(f"USE CATALOG {CATALOG}")
spark.sql(f"USE SCHEMA {SCHEMA}")

# COMMAND ----------

# MAGIC %md ### Stream raw JSON → Bronze with Auto Loader
# MAGIC `availableNow=True` drains all currently-landed files and then stops, so the
# MAGIC notebook behaves like an incremental batch job you can also schedule.

# COMMAND ----------

from pyspark.sql import functions as F

bronze_stream = (
    spark.readStream.format("cloudFiles")
    .option("cloudFiles.format", "json")
    .option("cloudFiles.schemaLocation", SCHEMA_PATH)
    .option("cloudFiles.inferColumnTypes", "true")
    .load(LANDING_PATH)
    # Ingestion metadata — provenance you almost always want in Bronze.
    .withColumn("_ingested_at", F.current_timestamp())
    .withColumn("_source_file", F.col("_metadata.file_path"))
)

(
    bronze_stream.writeStream.format("delta")
    .option("checkpointLocation", CHECKPOINT)
    .option("mergeSchema", "true")
    .trigger(availableNow=True)
    .toTable(BRONZE_TABLE)
    .awaitTermination()
)

print("Bronze ingest complete.")

# COMMAND ----------

# MAGIC %md ### Inspect the Bronze table

# COMMAND ----------

bronze = spark.table(BRONZE_TABLE)
print(f"Bronze rows: {bronze.count():,}")
display(bronze.orderBy(F.rand()).limit(5))

# COMMAND ----------

# MAGIC %md
# MAGIC #### Batch alternative (no streaming)
# MAGIC ```python
# MAGIC bronze = (
# MAGIC     spark.read.json(LANDING_PATH)
# MAGIC     .withColumn("_ingested_at", F.current_timestamp())
# MAGIC )
# MAGIC bronze.write.format("delta").mode("overwrite").saveAsTable(BRONZE_TABLE)
# MAGIC ```
# MAGIC
# MAGIC ✅ Continue with **`02_transform_silver`**.
