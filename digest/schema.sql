-- The digest's D1 database. Only confirmed addresses are stored; unsubscribing deletes the row.
-- Apply: bunx wrangler d1 execute naturefunding-digest --config digest/wrangler.jsonc --file digest/schema.sql [--local|--remote]

CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  -- The finder's `where` value: '' (anywhere), an ISO country code, or 'r:<region>'.
  where_code TEXT NOT NULL DEFAULT '',
  -- The finder's `approach` values, space-separated; '' for any.
  approaches TEXT NOT NULL DEFAULT '',
  -- The consent wording version the person saw (src/consent.ts).
  consent TEXT NOT NULL,
  -- When the person chose these filters (the sign-up the confirm link came from); an older link can't replace them.
  chosen_at TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  -- When the last digest was sent (or claimed for sending): at most one email per 7 days.
  last_sent_at TEXT,
  -- The newest change the last digest could report (the bundle's newest commit); the next one covers changes
  -- after this, or after confirmed_at. Kept apart from last_sent_at so a change deployed late isn't skipped.
  sent_through TEXT
);

-- Sign-up attempts, by a keyed hash of the address, for limits. Rows older than 2 days are deleted daily.
CREATE TABLE IF NOT EXISTS attempts (
  hash TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_hash_at ON attempts (hash, at);
CREATE INDEX IF NOT EXISTS attempts_at ON attempts (at);
