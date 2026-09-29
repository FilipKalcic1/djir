-- ──────────────────────────────────────────────────────────────
-- Djir — database schema (PostgreSQL / Neon), for a fresh database.
-- Safe to run more than once. Upgrading a v1.0 database? Run
-- db/migrations/001_v1_1.sql instead.
-- ──────────────────────────────────────────────────────────────

-- A fresh database gets the v1.1 shape below, so 001_v1_1 is recorded as
-- applied — but only when THIS run is about to create `rides`. Run by mistake
-- on a v1.0 database (whose `rides` exists), it records nothing, so the
-- migration's one-time cents → euros fix still runs later.
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = current_schema() AND table_name = 'rides') THEN
    INSERT INTO schema_migrations (version) VALUES ('001_v1_1') ON CONFLICT DO NOTHING;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS drivers (
    id                 SERIAL PRIMARY KEY,
    first_name         VARCHAR(50) NOT NULL,
    last_name          VARCHAR(50) NOT NULL,
    profile_image_url  TEXT,
    car_image_url      TEXT,
    car_seats          INTEGER NOT NULL CHECK (car_seats > 0),
    rating             NUMERIC(2, 1) CHECK (rating >= 0 AND rating <= 5),
    UNIQUE (first_name, last_name)
);

CREATE TABLE IF NOT EXISTS rides (
    ride_id                SERIAL PRIMARY KEY,
    origin_address         VARCHAR(255) NOT NULL,
    destination_address    VARCHAR(255) NOT NULL,
    origin_latitude        NUMERIC(10, 7) NOT NULL,
    origin_longitude       NUMERIC(10, 7) NOT NULL,
    destination_latitude   NUMERIC(10, 7) NOT NULL,
    destination_longitude  NUMERIC(10, 7) NOT NULL,
    ride_time              INTEGER NOT NULL,         -- trip minutes, pickup → destination
    pickup_minutes         SMALLINT,                 -- driver → pickup minutes, fixed at booking
    fare_price             NUMERIC(10, 2) NOT NULL,  -- euros
    payment_status         VARCHAR(20) NOT NULL
                           CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
    payment_intent_id      VARCHAR(255) UNIQUE,
    paid_at                TIMESTAMPTZ,              -- when the payment succeeded
    driver_id              INTEGER NOT NULL REFERENCES drivers(id),
    user_id                VARCHAR(50) NOT NULL,     -- Clerk user id
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    scheduled_at           TIMESTAMPTZ,              -- null = ride now
    cancelled_at           TIMESTAMPTZ,
    cancel_requested_at    TIMESTAMPTZ,              -- a refund was asked for; set until its outcome is known
    reconciled_at          TIMESTAMPTZ               -- last time reconcile asked Stripe (pending rows, open cancels)
);

CREATE INDEX IF NOT EXISTS rides_user_created_idx ON rides (user_id, created_at DESC);

-- ── Sample drivers ────────────────────────────────────────────
-- Seed data so the map has drivers out of the box. The car images are
-- placeholders: replace them with your own whenever you like.
INSERT INTO drivers (first_name, last_name, profile_image_url, car_image_url, car_seats, rating) VALUES
    ('James',  'Wilson',   'https://randomuser.me/api/portraits/men/32.jpg',   'https://placehold.co/320x180/png?text=Sedan', 4, 4.8),
    ('David',  'Brown',    'https://randomuser.me/api/portraits/men/45.jpg',   'https://placehold.co/320x180/png?text=SUV',   6, 4.6),
    ('Michael','Johnson',  'https://randomuser.me/api/portraits/men/12.jpg',   'https://placehold.co/320x180/png?text=Hatch', 4, 4.9),
    ('Robert', 'Garcia',   'https://randomuser.me/api/portraits/men/76.jpg',   'https://placehold.co/320x180/png?text=Van',   7, 4.5),
    ('Daniel', 'Martinez', 'https://randomuser.me/api/portraits/men/8.jpg',    'https://placehold.co/320x180/png?text=Coupe', 2, 4.7)
ON CONFLICT (first_name, last_name) DO NOTHING;
