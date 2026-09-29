-- Databricks notebook source
-- MAGIC %md
-- MAGIC # 08 · Analytics — Databricks SQL dashboard
-- MAGIC
-- MAGIC Queries over the Gold tables. Pin each result as a visualization on a
-- MAGIC Databricks SQL dashboard:
-- MAGIC
-- MAGIC | Query | Suggested chart |
-- MAGIC |---|---|
-- MAGIC | Daily revenue & rides | dual-axis line |
-- MAGIC | Demand heatmap | heatmap (zone × hour) |
-- MAGIC | Surge by hour | bar |
-- MAGIC | Weather impact | bar |
-- MAGIC | Top OD flows | table / sankey |
-- MAGIC | Zone leaderboard | table |

-- COMMAND ----------

USE CATALOG djir;
USE SCHEMA lakehouse;

-- COMMAND ----------

-- MAGIC %md ### KPI headline — revenue, rides, average fare & surge

-- COMMAND ----------

SELECT
  COUNT(*)                              AS days,
  SUM(rides)                            AS total_rides,
  ROUND(SUM(revenue_eur), 0)            AS total_revenue_eur,
  ROUND(SUM(revenue_eur) / SUM(rides), 2) AS avg_fare_eur,
  ROUND(SUM(avg_surge * rides) / SUM(rides), 3) AS avg_surge  -- per ride, not per day
FROM gold_daily_kpis;

-- COMMAND ----------

-- MAGIC %md ### Daily revenue & ride volume (line chart)

-- COMMAND ----------

SELECT date, rides, revenue_eur, avg_fare_eur, avg_surge
FROM gold_daily_kpis
ORDER BY date;

-- COMMAND ----------

-- MAGIC %md ### Demand heatmap — rides by zone × hour (heatmap: x=hour, y=zone, color=rides)

-- COMMAND ----------

SELECT pickup_zone, hour_of_day, SUM(rides) AS rides
FROM gold_zone_hourly
GROUP BY pickup_zone, hour_of_day
ORDER BY pickup_zone, hour_of_day;

-- COMMAND ----------

-- MAGIC %md ### Average surge by hour of day (bar) — see the rush-hour peaks

-- COMMAND ----------

SELECT
  hour_of_day,
  ROUND(SUM(avg_surge * rides) / SUM(rides), 3) AS avg_surge,
  SUM(rides) AS rides
FROM gold_zone_hourly
GROUP BY hour_of_day
ORDER BY hour_of_day;

-- COMMAND ----------

-- MAGIC %md ### Zone leaderboard — revenue & surge by pickup zone

-- COMMAND ----------

SELECT
  pickup_zone,
  SUM(rides)                                   AS rides,
  ROUND(SUM(revenue_eur), 0)                   AS revenue_eur,
  ROUND(SUM(avg_surge * rides) / SUM(rides), 3) AS avg_surge,
  ROUND(SUM(avg_duration_min * rides) / SUM(rides), 1) AS avg_duration_min
FROM gold_zone_hourly
GROUP BY pickup_zone
ORDER BY revenue_eur DESC;

-- COMMAND ----------

-- MAGIC %md ### Top 15 origin → destination flows

-- COMMAND ----------

SELECT pickup_zone, dropoff_zone, rides, avg_distance_km, avg_fare_eur
FROM gold_zone_flows
ORDER BY rides DESC
LIMIT 15;

-- COMMAND ----------

-- MAGIC %md ### Weather impact on surge & demand (bar)
-- MAGIC Reads Silver directly so weather is available at ride grain.

-- COMMAND ----------

SELECT
  weather_condition,
  COUNT(*)                          AS rides,
  ROUND(AVG(surge_multiplier), 3)   AS avg_surge,
  ROUND(AVG(duration_min), 1)       AS avg_duration_min,
  ROUND(AVG(fare_amount_eur), 2)    AS avg_fare_eur
FROM silver_rides
GROUP BY weather_condition
ORDER BY avg_surge DESC;
