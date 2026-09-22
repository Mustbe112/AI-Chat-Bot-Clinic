-- Run this in the Supabase SQL editor if Prisma migrate is not used.
-- Creates the user_activity table for the activity pipeline.

CREATE TABLE IF NOT EXISTS user_activity (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT,
  event      TEXT NOT NULL,
  path       TEXT,
  meta       JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user
  ON user_activity (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_activity_session
  ON user_activity (session_id, created_at DESC);
