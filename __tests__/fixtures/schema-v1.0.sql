-- ──────────────────────────────────────────────────────────────
-- Djir — database schema (PostgreSQL / Neon)
-- Run this once against your database (e.g. in the Neon SQL Editor).
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    email       VARCHAR(100) UNIQUE NOT NULL,
    clerk_id    VARCHAR(50)  UNIQUE NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS drivers (
    id                 SERIAL PRIMARY KEY,
    first_name         VARCHAR(50) NOT NULL,
    last_name          VARCHAR(50) NOT NULL,
    profile_image_url  TEXT,
    car_image_url      TEXT,
    car_seats          INTEGER NOT NULL CHECK (car_seats > 0),
    rating             NUMERIC(2, 1) CHECK (rating >= 0 AND rating <= 5)
);

CREATE TABLE IF NOT EXISTS rides (
    ride_id                SERIAL PRIMARY KEY,
    origin_address         VARCHAR(255) NOT NULL,
    destination_address    VARCHAR(255) NOT NULL,
    origin_latitude        NUMERIC(10, 7) NOT NULL,
    origin_longitude       NUMERIC(10, 7) NOT NULL,
    destination_latitude   NUMERIC(10, 7) NOT NULL,
    destination_longitude  NUMERIC(10, 7) NOT NULL,
    ride_time              INTEGER NOT NULL,
    fare_price             NUMERIC(10, 2) NOT NULL,
    payment_status         VARCHAR(20) NOT NULL,
    driver_id              INTEGER REFERENCES drivers(id),
    user_id                VARCHAR(50) NOT NULL,
    created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Sample drivers ────────────────────────────────────────────
-- Seed data so the home screen shows available drivers out of the box.
-- Replace the image URLs with your own assets whenever you like.
INSERT INTO drivers (first_name, last_name, profile_image_url, car_image_url, car_seats, rating) VALUES
    ('James',  'Wilson',   'https://randomuser.me/api/portraits/men/32.jpg',   'https://placehold.co/320x180/png?text=Sedan', 4, 4.8),
    ('David',  'Brown',    'https://randomuser.me/api/portraits/men/45.jpg',   'https://placehold.co/320x180/png?text=SUV',   6, 4.6),
    ('Michael','Johnson',  'https://randomuser.me/api/portraits/men/12.jpg',   'https://placehold.co/320x180/png?text=Hatch', 4, 4.9),
    ('Robert', 'Garcia',   'https://randomuser.me/api/portraits/men/76.jpg',   'https://placehold.co/320x180/png?text=Van',   7, 4.5),
    ('Daniel', 'Martinez', 'https://randomuser.me/api/portraits/men/8.jpg',    'https://placehold.co/320x180/png?text=Coupe', 2, 4.7);
