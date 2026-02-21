-- ============================================================
-- Migration 0001: Initial Schema
-- Cloudflare D1 (SQLite compatible)
-- ============================================================

-- ── Users ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('customer', 'driver', 'merchant', 'admin')),
  name         TEXT NOT NULL,
  phone        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);

-- ── Addresses ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS addresses (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  street     TEXT NOT NULL,
  city       TEXT NOT NULL,
  country    TEXT NOT NULL,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);

-- ── Orders ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT NOT NULL REFERENCES users(id),
  merchant_id   TEXT NOT NULL REFERENCES users(id),
  driver_id     TEXT REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'created'
                  CHECK (status IN ('created','accepted','preparing','picked_up','delivered','cancelled')),
  total_price   REAL NOT NULL,
  pickup_lat    REAL NOT NULL,
  pickup_lng    REAL NOT NULL,
  dropoff_lat   REAL NOT NULL,
  dropoff_lng   REAL NOT NULL,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_customer  ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_merchant  ON orders(merchant_id);
CREATE INDEX IF NOT EXISTS idx_orders_driver    ON orders(driver_id);
CREATE INDEX IF NOT EXISTS idx_orders_status    ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created   ON orders(created_at DESC);

-- ── Order Items ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_items (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ── Driver Status ─────────────────────────────────────────────
-- Mirrors Durable Object state into D1 for dispatch queries.
-- Updated on every location ping from the driver.

CREATE TABLE IF NOT EXISTS driver_status (
  driver_id    TEXT PRIMARY KEY REFERENCES users(id),
  is_available INTEGER NOT NULL DEFAULT 1,   -- 0 = offline, 1 = available
  current_lat  REAL,
  current_lng  REAL,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_driver_status_available ON driver_status(is_available);
