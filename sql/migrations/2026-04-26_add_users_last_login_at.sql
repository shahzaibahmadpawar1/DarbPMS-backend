-- Migration: add users.last_login_at for login baseline tracking
-- Safe to run multiple times.

ALTER TABLE users
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_last_login_at
ON users(last_login_at);

-- Optional: backfill existing users so dashboards have a baseline immediately.
-- Uncomment if desired.
-- UPDATE users
-- SET last_login_at = COALESCE(last_login_at, NOW());

-- Verify result
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'last_login_at';
