-- Idle-based retention: last_seen is bumped on writes and (at most once a day) on reads.
ALTER TABLE profiles ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0;
UPDATE profiles SET last_seen = updated_at;
CREATE INDEX idx_profiles_last_seen ON profiles (last_seen);
