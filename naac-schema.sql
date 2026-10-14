-- This database stores anonymous installation totals, never student profiles or scan records.
CREATE TABLE IF NOT EXISTS naac_publishers (
  publisher_hash TEXT PRIMARY KEY NOT NULL CHECK(length(publisher_hash) = 64),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS naac_institution_totals (
  publisher_hash TEXT NOT NULL REFERENCES naac_publishers(publisher_hash) ON DELETE CASCADE,
  institution_id TEXT NOT NULL,
  contributing_profiles INTEGER NOT NULL CHECK(contributing_profiles BETWEEN 0 AND 1000),
  completed_quests INTEGER NOT NULL CHECK(completed_quests BETWEEN 0 AND 1000000),
  items_handled INTEGER NOT NULL CHECK(items_handled BETWEEN 0 AND 1000000),
  estimated_kg REAL NOT NULL CHECK(estimated_kg BETWEEN 0 AND 1000000),
  estimated_co2_kg REAL NOT NULL CHECK(estimated_co2_kg BETWEEN 0 AND 1000000),
  reported_diverted_kg REAL NOT NULL CHECK(reported_diverted_kg BETWEEN 0 AND 1000000),
  assumed_diverted_kg REAL NOT NULL CHECK(assumed_diverted_kg BETWEEN 0 AND 1000000),
  PRIMARY KEY(publisher_hash, institution_id)
);
CREATE TABLE IF NOT EXISTS naac_write_quota (
  bucket_key TEXT PRIMARY KEY NOT NULL,
  requests INTEGER NOT NULL,
  limit_value INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK(requests BETWEEN 1 AND limit_value)
);
CREATE INDEX IF NOT EXISTS naac_quota_expiry ON naac_write_quota(expires_at);
