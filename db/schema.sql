-- Circle Recommendations — relational schema (SQLite dialect, Postgres-portable).
-- Design notes live in docs/SCHEMA.md. Short version:
--   * Normalized core tables mirror the domain (users, circles, memberships, posts, topics).
--   * Many-to-many "tag" style data (user interests, circle tags) gets join tables, not JSON
--     columns, so we can index and join on topic_id — that is the hot path for candidate generation.
--   * Activity aggregates the product already maintains (feed_posts_30d, chat_messages_30d,
--     last_activity_at) stay denormalized on circles: they are what a feed/chat service would
--     write, and the recommender reads them on every request.
--   * Derived signals (is the circle full? engagement per post?) live in a VIEW, so the rule is
--     defined once and can be materialized later without changing callers.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS topics (
  id      INTEGER PRIMARY KEY,
  slug    TEXT NOT NULL UNIQUE,
  label   TEXT NOT NULL,
  domain  TEXT NOT NULL DEFAULT 'content'
);

CREATE TABLE IF NOT EXISTS users (
  id                    INTEGER PRIMARY KEY,
  first_name            TEXT NOT NULL,
  last_name             TEXT NOT NULL,
  has_photo             INTEGER NOT NULL DEFAULT 0 CHECK (has_photo IN (0, 1)),
  bio                   TEXT,
  job_title             TEXT,
  company               TEXT,
  industry              TEXT,
  location              TEXT,
  joined_at             TEXT NOT NULL,            -- ISO-8601 UTC
  profile_completeness  REAL NOT NULL DEFAULT 0 CHECK (profile_completeness BETWEEN 0 AND 1)
);

-- Stated interests (user picked these topics). PK doubles as the user->topics index.
CREATE TABLE IF NOT EXISTS user_topic_interests (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id  INTEGER NOT NULL REFERENCES topics(id),
  PRIMARY KEY (user_id, topic_id)
);
-- Reverse lookup: "who is interested in topic X" (peer-fit signal, audience sizing).
CREATE INDEX IF NOT EXISTS idx_uti_topic ON user_topic_interests(topic_id);

CREATE TABLE IF NOT EXISTS circles (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL UNIQUE,
  description        TEXT,
  topic_id           INTEGER REFERENCES topics(id),   -- primary topic; nullable by design
  cover_image_url    TEXT,
  format             TEXT NOT NULL CHECK (format IN ('in_person', 'virtual', 'hybrid')),
  access             TEXT NOT NULL CHECK (access IN ('public', 'unlisted')),
  join_policy        TEXT NOT NULL CHECK (join_policy IN ('open', 'request')),
  max_members        INTEGER CHECK (max_members IS NULL OR max_members > 0), -- NULL = uncapped
  member_count       INTEGER NOT NULL DEFAULT 0 CHECK (member_count >= 0),
  created_at         TEXT NOT NULL,
  -- Denormalized activity aggregates (written by feed/chat pipelines, read on every request)
  last_activity_at   TEXT,
  feed_posts_30d     INTEGER NOT NULL DEFAULT 0,
  chat_messages_30d  INTEGER NOT NULL DEFAULT 0
);
-- Candidate generation: "circles about topic X".
CREATE INDEX IF NOT EXISTS idx_circles_topic ON circles(topic_id);
-- Eligibility pre-filter: discoverable circles ordered by freshness.
CREATE INDEX IF NOT EXISTS idx_circles_access_activity ON circles(access, last_activity_at);

-- Free-form secondary tags, normalized to the topic taxonomy.
CREATE TABLE IF NOT EXISTS circle_tags (
  circle_id  INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  topic_id   INTEGER NOT NULL REFERENCES topics(id),
  PRIMARY KEY (circle_id, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_circle_tags_topic ON circle_tags(topic_id);

CREATE TABLE IF NOT EXISTS memberships (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  circle_id  INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('member', 'leader')),
  joined_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, circle_id)          -- "my circles" + uniqueness in one index
);
-- "Members of circle X" (leaders, peer fit, co-membership).
CREATE INDEX IF NOT EXISTS idx_memberships_circle ON memberships(circle_id, role);

CREATE TABLE IF NOT EXISTS posts (
  id              INTEGER PRIMARY KEY,
  circle_id       INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  author_user_id  INTEGER NOT NULL REFERENCES users(id),
  body            TEXT NOT NULL,
  reaction_count  INTEGER NOT NULL DEFAULT 0,
  comment_count   INTEGER NOT NULL DEFAULT 0,
  save_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
-- Engagement rollups over a time window per circle.
CREATE INDEX IF NOT EXISTS idx_posts_circle_created ON posts(circle_id, created_at);

-- Derived, single-source-of-truth signals. In production this becomes a materialized
-- view / nightly-refreshed table (see docs/DESIGN.md).
DROP VIEW IF EXISTS circle_stats;
CREATE VIEW circle_stats AS
SELECT
  c.id AS circle_id,
  CASE WHEN c.max_members IS NULL THEN NULL ELSE c.max_members - c.member_count END AS seats_left,
  CASE WHEN c.max_members IS NOT NULL AND c.member_count >= c.max_members THEN 1 ELSE 0 END AS is_full,
  (SELECT COUNT(*) FROM memberships m WHERE m.circle_id = c.id AND m.role = 'leader') AS leader_count
FROM circles c;
