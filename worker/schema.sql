-- High scores for consequence.games. One table for every game.
-- Apply with: npx wrangler d1 execute consequence-scores --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game       TEXT    NOT NULL,          -- e.g. 'snail'
  name       TEXT    NOT NULL,          -- 3 letters, A-Z
  score      INTEGER NOT NULL,          -- computed by the worker, never taken from the client
  elapsed    REAL    NOT NULL,          -- seconds survived
  detail     TEXT,                      -- JSON the game sent (e.g. loot counts), for review
  ip_hash    TEXT    NOT NULL,          -- salted SHA-256 of the IP, used only for rate limiting
  created_at INTEGER NOT NULL           -- ms since epoch
);

CREATE INDEX IF NOT EXISTS scores_game_score ON scores (game, score DESC);
CREATE INDEX IF NOT EXISTS scores_game_time  ON scores (game, created_at);
CREATE INDEX IF NOT EXISTS scores_ip_time    ON scores (ip_hash, created_at);
