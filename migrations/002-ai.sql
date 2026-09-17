CREATE TABLE matches_v2 (
 id TEXT PRIMARY KEY, black_id TEXT REFERENCES users(id), white_id TEXT REFERENCES users(id),
 winner_id TEXT, reason TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL,
 payload TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'online' CHECK(mode IN ('online','ai'))
) STRICT;
INSERT INTO matches_v2 SELECT *, 'online' FROM matches;
DROP TABLE matches;
ALTER TABLE matches_v2 RENAME TO matches;
CREATE INDEX matches_black ON matches(black_id,ended_at DESC);
CREATE INDEX matches_white ON matches(white_id,ended_at DESC);
CREATE INDEX matches_mode ON matches(mode,ended_at DESC);
