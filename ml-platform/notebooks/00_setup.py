# Databricks notebook source
# MAGIC %md
# MAGIC # 00 · Setup — catalog, schema & shared library
# MAGIC
# MAGIC Run this **once** before the rest of the pipeline. It:
# MAGIC 1. creates the Unity Catalog `djir.lakehouse` namespace and a landing Volume,
# MAGIC 2. puts the shared `djir_ml` package (cloned with this repo into Databricks
# MAGIC    Repos / Git folders) on the Python path,
# MAGIC 3. lands the synthetic ride history as files for the Bronze layer to ingest.
# MAGIC
# MAGIC > **Why a shared package?** The exact same `djir_ml` code (zone table,
# MAGIC > pricing physics, feature builder, training logic) runs here *and* in the
# MAGIC > local pipeline *and* in the FastAPI serving layer — one source of truth,
# MAGIC > no copy-paste drift.

# COMMAND ----------

# MAGIC %md ### Put `djir_ml` on the path
# MAGIC Auto-detects the repo checkout from this notebook's path; override `ML_PLATFORM`
# MAGIC manually if your repo lives somewhere unusual.

# COMMAND ----------

import os
import sys

try:
    nb_path = (
        dbutils.notebook.entry_point.getDbutils()
        .notebook().getContext().notebookPath().get()
    )
    # /Repos/<user>/djir/ml-platform/notebooks/00_setup  ->  ml-platform dir
    ML_PLATFORM = "/Workspace" + "/".join(nb_path.split("/")[:-2])
except Exception:
    ML_PLATFORM = "/Workspace/Repos/<your-user>/djir/ml-platform"  # <-- edit me

if ML_PLATFORM not in sys.path:
    sys.path.insert(0, ML_PLATFORM)

from djir_ml import config, simulate  # noqa: E402

print("ml-platform path :", ML_PLATFORM)
print("catalog.schema   :", f"{config.UC_CATALOG}.{config.UC_SCHEMA}")

# COMMAND ----------

# MAGIC %md ### Create the catalog, schema and landing Volume

# COMMAND ----------

CATALOG = config.UC_CATALOG
SCHEMA = config.UC_SCHEMA
VOLUME = "landing"
LANDING_PATH = f"/Volumes/{CATALOG}/{SCHEMA}/{VOLUME}/rides"

spark.sql(f"CREATE CATALOG IF NOT EXISTS {CATALOG}")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{SCHEMA}")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {CATALOG}.{SCHEMA}.{VOLUME}")
dbutils.fs.mkdirs(LANDING_PATH)
print("landing path:", LANDING_PATH)

# COMMAND ----------

# MAGIC %md ### Land the synthetic ride history as files
# MAGIC In a real deployment these files would arrive from the mobile backend
# MAGIC (one per micro-batch). Here we generate ~65k rides once and split them into
# MAGIC daily files so the Bronze Auto Loader has something realistic to stream.

# COMMAND ----------

import pandas as pd

try:
    existing = list(dbutils.fs.ls(LANDING_PATH))
except Exception:
    existing = []

if not existing:
    pdf = simulate.generate()                      # ~65k rides, all columns
    pdf["requested_at"] = pd.to_datetime(pdf["requested_at"]).astype(str)
    for day, chunk in pdf.groupby("date"):
        # write one newline-delimited JSON file per day to the Volume
        out = f"{LANDING_PATH}/rides_{day}.json"
        with open(out, "w") as fh:
            fh.write(chunk.to_json(orient="records", lines=True))
    print(f"Landed {pdf['date'].nunique()} daily files, {len(pdf):,} rides total.")
else:
    print(f"Landing zone already has {len(existing)} files — skipping generation.")

# COMMAND ----------

# MAGIC %md
# MAGIC ✅ Setup complete. Continue with **`01_ingest_bronze`**.
