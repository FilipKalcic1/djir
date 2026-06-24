"""
Generate the Djir ride-event dataset and write it to disk.

Outputs (under ml-platform/data/):
  * rides.parquet      — the full Silver/feature table (with labels)
  * rides.csv          — same, CSV for quick eyeballing / Databricks upload
  * rides_raw.parquet  — the Bronze-style raw events (no labels/derived demand)

Usage:
    python scripts/generate_data.py --days 120 --target 65000
"""

from __future__ import annotations

import argparse
import os
import sys

# Make `djir_ml` importable when run from ml-platform/ or scripts/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from djir_ml import simulate  # noqa: E402
from djir_ml.config import (  # noqa: E402
    DATA_DIR,
    RAW_EVENTS_FILE,
    RIDES_TABLE_FILE,
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=120)
    ap.add_argument("--target", type=int, default=65_000, help="approx number of rides")
    ap.add_argument("--start", type=str, default="2025-01-01")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", type=str, default=DATA_DIR)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    print(f"Generating ~{args.target:,} rides over {args.days} days from {args.start} …")
    df = simulate.generate(
        n_days=args.days, start_date=args.start, target_rides=args.target, seed=args.seed
    )

    full_path = os.path.join(args.out, RIDES_TABLE_FILE)
    csv_path = os.path.join(args.out, "rides.csv")
    raw_path = os.path.join(args.out, RAW_EVENTS_FILE)

    df.to_parquet(full_path, index=False)
    df.to_csv(csv_path, index=False)
    df[simulate.RAW_EVENT_COLUMNS].to_parquet(raw_path, index=False)

    cancelled = int((df["payment_status"] == "cancelled").sum())
    print(f"  rows:            {len(df):,}")
    print(f"  date range:      {df['requested_at'].min()}  →  {df['requested_at'].max()}")
    print(f"  cancelled rides: {cancelled:,} ({cancelled / len(df) * 100:.1f}%)")
    print(f"  avg fare (paid): €{df['fare_amount_eur'].mean():.2f}")
    print(f"  avg surge:       {df['surge_multiplier'].mean():.2f}×")
    print(f"  wrote: {full_path}")
    print(f"  wrote: {csv_path}")
    print(f"  wrote: {raw_path}")


if __name__ == "__main__":
    main()
