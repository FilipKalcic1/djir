-- ──────────────────────────────────────────────────────────────
-- Djir v1.0 → v1.1. Idempotent: running it again changes nothing.
--
-- How to run: psql "$DATABASE_URL" -f db/migrations/001_v1_1.sql, or paste it
-- into the Neon SQL editor. (The app's HTTP driver cannot run multi-statement
-- scripts.) v1.1 replaces the booking API, so take v1.0 builds offline, run
-- this, then deploy v1.1.
--
--  * created_at becomes TIMESTAMPTZ. v1.0 wrote CURRENT_TIMESTAMP in Neon's
--    default UTC session, so the stored wall-clock values are UTC (R76).
--  * fare_price: v1.0 stored cents in this euro column (R17). Every legacy
--    row is converted exactly once, recorded in schema_migrations.
--  * New for v1.1: payment_intent_id, paid_at, scheduled_at, pickup_minutes,
--    cancelled_at, cancel_requested_at, reconciled_at; a CHECK on
--    payment_status; the history index. Already on v1.1? Run it again (it is
--    idempotent) before deploying an API that reads a column added here since.
--  * v1.0 stored whatever payment_status a request sent: any value outside
--    the CHECK becomes 'failed' first (a NOTICE gives the count), so the
--    CHECK can never abort the migration.
--  * created_at and driver_id become NOT NULL, as in schema.sql, unless a
--    legacy row holds a NULL: then the column stays nullable (with a NOTICE).
-- ──────────────────────────────────────────────────────────────

BEGIN;
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'rides'
        AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE rides ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
  END IF;

  -- The ledger row is inserted only once, so the conversion runs only once.
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = current_schema() AND table_name = 'rides') THEN
    INSERT INTO schema_migrations (version) VALUES ('001_v1_1') ON CONFLICT DO NOTHING;
    IF FOUND THEN
      UPDATE rides SET fare_price = fare_price / 100;
    END IF;
  END IF;
END $$;

ALTER TABLE rides ADD COLUMN IF NOT EXISTS payment_intent_id VARCHAR(255) UNIQUE;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS paid_at        TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS scheduled_at   TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS pickup_minutes SMALLINT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS reconciled_at  TIMESTAMPTZ;
ALTER TABLE rides ALTER COLUMN created_at SET DEFAULT now();

DO $$
DECLARE
  unknown_statuses integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE table_schema = current_schema() AND table_name = 'rides'
                   AND constraint_name = 'rides_payment_status_check') THEN
    UPDATE rides SET payment_status = 'failed'
      WHERE payment_status NOT IN ('pending', 'paid', 'failed', 'refunded');
    GET DIAGNOSTICS unknown_statuses = ROW_COUNT;
    IF unknown_statuses > 0 THEN
      RAISE NOTICE '% ride(s) had an unknown payment_status and are now failed', unknown_statuses;
    END IF;
    ALTER TABLE rides ADD CONSTRAINT rides_payment_status_check
      CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM rides WHERE created_at IS NULL) THEN
    RAISE NOTICE 'rides.created_at has NULLs, so it stays nullable';
  ELSE
    ALTER TABLE rides ALTER COLUMN created_at SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM rides WHERE driver_id IS NULL) THEN
    RAISE NOTICE 'rides.driver_id has NULLs, so it stays nullable';
  ELSE
    ALTER TABLE rides ALTER COLUMN driver_id SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS rides_user_created_idx ON rides (user_id, created_at DESC);

COMMIT;
