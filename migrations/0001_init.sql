-- One row per shared profile. `blob` is AES-GCM ciphertext; the server never sees plaintext or keys.
CREATE TABLE profiles (
  id         TEXT PRIMARY KEY,      -- derived from the read secret (22 chars base64url)
  write_hash TEXT NOT NULL,         -- sha256(hex) of the write token
  rev        INTEGER NOT NULL,      -- bumped on every write; used for compare-and-set
  blob       TEXT NOT NULL,         -- base64url(iv || ciphertext)
  active     INTEGER NOT NULL DEFAULT 0,  -- 1 once the client has ever reported weigh-ins (sticky)
  created_at INTEGER NOT NULL,      -- ms since epoch, set by the Worker
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_profiles_created ON profiles (created_at);
