CREATE TABLE users (
 id TEXT PRIMARY KEY, account TEXT NOT NULL UNIQUE COLLATE NOCASE,
 nickname TEXT NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL,
 created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE rooms (code TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
CREATE TABLE seats (
 user_id TEXT PRIMARY KEY REFERENCES users(id), room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE
) STRICT;
CREATE TABLE invitations (
 id TEXT PRIMARY KEY, sender TEXT NOT NULL REFERENCES users(id), recipient TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX one_outgoing ON invitations(sender) WHERE status='pending';
CREATE UNIQUE INDEX one_pair ON invitations(sender,recipient) WHERE status='pending';
CREATE TABLE matches (
 id TEXT PRIMARY KEY, black_id TEXT NOT NULL REFERENCES users(id), white_id TEXT NOT NULL REFERENCES users(id),
 winner_id TEXT, reason TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL,
 payload TEXT NOT NULL
) STRICT;
CREATE INDEX matches_black ON matches(black_id,ended_at DESC);
CREATE INDEX matches_white ON matches(white_id,ended_at DESC);
CREATE TABLE notifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id), message TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX notification_user ON notifications(user_id,id DESC);
CREATE TABLE operations (
 user_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,id)
) STRICT;
CREATE TABLE metadata (key TEXT PRIMARY KEY,value INTEGER NOT NULL) STRICT;
INSERT INTO metadata VALUES ('revision',0);
