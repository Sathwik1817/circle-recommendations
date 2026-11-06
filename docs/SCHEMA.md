# Database schema

Source of truth: [`db/schema.sql`](../db/schema.sql). SQLite locally, written to port to Postgres unchanged (apart from types like `TIMESTAMPTZ`).

```
topics ─┬─< user_topic_interests >── users ──< memberships >── circles ──< posts
        └─< circle_tags >───────────────────────────────────────┘   │
        └───────────────────────────── circles.topic_id ────────────┘
                                      circle_stats (VIEW over circles + memberships)
```

| Table | Key | Why it looks like this |
| --- | --- | --- |
| `topics` | `id`, unique `slug` | The shared taxonomy. Everything joins on `topic_id`, never on free-text slugs. |
| `users` | `id` | Profile fields as given. `profile_completeness` is stored because the product computes it, but it isn't used for ranking. |
| `user_topic_interests` | PK `(user_id, topic_id)` | A join table, not a JSON array. It's the hot path: "topics I care about" uses the PK, "people who care about topic X" uses `idx_uti_topic`. |
| `circles` | `id`, unique `slug` | `topic_id` is a nullable FK (some Circles have no topic). `max_members` NULL = uncapped. `CHECK`s on the enums. The **activity aggregates** (`feed_posts_30d`, `chat_messages_30d`, `last_activity_at`) are **denormalized on purpose**: feed/chat services write them, and every recommendation request reads them. |
| `circle_tags` | PK `(circle_id, topic_id)` | Raw tags are normalized to the taxonomy and de-duplicated (the source data repeats some tags). `idx_circle_tags_topic` covers tag-based candidate lookup. |
| `memberships` | PK `(user_id, circle_id)` | The PK gives uniqueness and answers "my Circles". `idx_memberships_circle(circle_id, role)` covers "members/leaders of Circle X" and the co-membership self-join. Leaders are `role='leader'`, not a separate table, which matches the product. |
| `posts` | `id` | From `activity.json`. `idx_posts_circle_created(circle_id, created_at)` makes "engagement in the last 30 days per Circle" an index range scan. |
| `circle_stats` (view) | — | `seats_left`, `is_full`, `leader_count`. These **derived** rules are defined once in SQL, so the API and any future job agree on what "full" means. In production it becomes a materialized table. |

**Indexing decisions worth calling out**
- Composite PKs on the two join tables double as the forward index. Each has one reverse index, and nothing more.
- `idx_circles_topic` and `idx_circle_tags_topic` support **candidate generation by topic**. That's what replaces "score every Circle" once there are 170k of them.
- `idx_circles_access_activity(access, last_activity_at)` supports the eligibility pre-filter ("public and active recently") as a range scan.
- I didn't add indexes on `users` profile columns: nothing queries by them.

**What I'd change for production:** `TIMESTAMPTZ` instead of ISO text. A `circle_activity_daily` rollup table fed by events, instead of the denormalized counters. `pgvector` columns for Circle and bio embeddings. A `recommendation_impressions` table (user, circle, rank, reasons, served_at) to measure outcomes and train on.
