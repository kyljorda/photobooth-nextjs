-- Vintage Strip Club — order + fulfilment schema
-- Run once against your Neon database. Safe to re-run.

CREATE TABLE IF NOT EXISTS orders (
  id                  TEXT PRIMARY KEY,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Customer
  email               TEXT NOT NULL,

  -- Billing / payer address
  billing_name        TEXT NOT NULL,
  billing_line1       TEXT NOT NULL,
  billing_line2       TEXT,
  billing_city        TEXT NOT NULL,
  billing_state       TEXT NOT NULL,
  billing_zip         TEXT NOT NULL,
  billing_country     TEXT NOT NULL DEFAULT 'US',

  -- Where the strip actually goes. Populated only for gift orders;
  -- resolve_ship_* below gives the effective destination either way.
  is_gift             BOOLEAN NOT NULL DEFAULT FALSE,
  ship_name           TEXT,
  ship_line1          TEXT,
  ship_line2          TEXT,
  ship_city           TEXT,
  ship_state          TEXT,
  ship_zip            TEXT,
  ship_country        TEXT,

  -- Product
  background          TEXT NOT NULL,
  filter              TEXT NOT NULL,
  quantity            INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  unit_price_cents    INTEGER NOT NULL,
  shipping_cents      INTEGER NOT NULL DEFAULT 0,
  amount_cents        INTEGER NOT NULL,

  -- Blob references. Never the image bytes themselves — a Postgres row
  -- is the wrong place for a megabyte of JPEG.
  frame_urls          JSONB NOT NULL DEFAULT '[]'::jsonb,
  strip_url           TEXT,

  -- Payment. 'test' is a real, distinct state: it lets the whole
  -- pipeline be exercised end to end without a charge, and makes it
  -- impossible to confuse a test order with a paid one in reporting.
  payment_status      TEXT NOT NULL DEFAULT 'pending'
                        CHECK (payment_status IN ('pending','test','paid','failed','refunded')),
  payment_intent_id   TEXT,
  paid_at             TIMESTAMPTZ,

  -- Fulfilment
  print_status        TEXT NOT NULL DEFAULT 'queued'
                        CHECK (print_status IN ('queued','claimed','printing','printed','failed','dead_letter')),
  print_attempts      INTEGER NOT NULL DEFAULT 0,
  print_job_id        TEXT,
  claimed_at          TIMESTAMPTZ,
  claim_expires_at    TIMESTAMPTZ,
  printed_at          TIMESTAMPTZ,
  last_error          TEXT
);

-- The claim query filters on these three columns; without the index it
-- degrades to a full scan as the table grows.
CREATE INDEX IF NOT EXISTS orders_claimable_idx
  ON orders (payment_status, print_status, created_at);

CREATE INDEX IF NOT EXISTS orders_email_idx ON orders (email);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);

-- One Stripe PaymentIntent must never produce two orders. A partial
-- unique index allows many NULLs while still enforcing uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_intent_idx
  ON orders (payment_intent_id) WHERE payment_intent_id IS NOT NULL;

-- Keep updated_at honest without relying on every caller to set it.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_touch_updated_at ON orders;
CREATE TRIGGER orders_touch_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Convenience view for fulfilment: the effective shipping address,
-- already resolved between billing and gift.
CREATE OR REPLACE VIEW order_shipping AS
SELECT
  id,
  email,
  COALESCE(ship_name,    billing_name)    AS name,
  COALESCE(ship_line1,   billing_line1)   AS line1,
  COALESCE(ship_line2,   billing_line2)   AS line2,
  COALESCE(ship_city,    billing_city)    AS city,
  COALESCE(ship_state,   billing_state)   AS state,
  COALESCE(ship_zip,     billing_zip)     AS zip,
  COALESCE(ship_country, billing_country) AS country,
  is_gift,
  quantity,
  print_status,
  payment_status,
  created_at
FROM orders;
