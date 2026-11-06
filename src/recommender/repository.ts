import type { DB } from "../db.js";
import { inferTopicsFromBio } from "./bio.js";
import type { CircleCandidate, LeaderRef, TopicRef, TopicSignal, UserContext } from "./types.js";

/**
 * All SQL lives here. The scoring code is pure functions over these plain objects,
 * which keeps it unit-testable and lets us swap SQLite for Postgres / a feature store later.
 */
export class Repository {
  constructor(private readonly db: DB) {}

  /** The dataset is a snapshot; "now" for recency math defaults to the latest event in it. */
  dataClock(): string {
    const row = this.db
      .prepare(`SELECT MAX(t) AS t FROM (SELECT MAX(last_activity_at) AS t FROM circles
                UNION ALL SELECT MAX(created_at) FROM posts)`)
      .get() as unknown as { t: string | null };
    return row.t ?? new Date().toISOString();
  }

  topics(): TopicRef[] {
    return this.db.prepare("SELECT id, slug, label FROM topics ORDER BY id").all() as unknown as TopicRef[];
  }

  userExists(userId: number): boolean {
    return !!this.db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId);
  }

  loadUser(userId: number): UserContext | null {
    const u = this.db
      .prepare(`SELECT id, first_name, location, bio, joined_at, profile_completeness FROM users WHERE id = ?`)
      .get(userId) as
      | { id: number; first_name: string; location: string | null; bio: string | null; joined_at: string; profile_completeness: number }
      | undefined;
    if (!u) return null;

    const stated = this.db
      .prepare(`SELECT t.id, t.slug, t.label FROM user_topic_interests i JOIN topics t ON t.id = i.topic_id
                WHERE i.user_id = ? ORDER BY t.id`)
      .all(userId) as unknown as TopicRef[];

    const myCircles = this.db
      .prepare(`SELECT c.id, c.name, t.id AS topic_id, t.slug, t.label
                FROM memberships m JOIN circles c ON c.id = m.circle_id LEFT JOIN topics t ON t.id = c.topic_id
                WHERE m.user_id = ?`)
      .all(userId) as unknown as { id: number; name: string; topic_id: number | null; slug: string | null; label: string | null }[];

    const signals: TopicSignal[] = stated.map((topic) => ({ topic, source: "stated", weight: 1 }));
    const seen = new Set(stated.map((t) => t.id));

    // Bio phrases → topics. Weaker than a stated interest; only adds topics not already stated.
    for (const hit of inferTopicsFromBio(u.bio, this.topics())) {
      if (seen.has(hit.topic.id)) continue;
      seen.add(hit.topic.id);
      signals.push({ topic: hit.topic, source: "bio", weight: 0.6, viaPhrase: hit.phrase });
    }
    // Topics of Circles the member already chose to join → implicit interest.
    for (const c of myCircles) {
      if (c.topic_id === null || seen.has(c.topic_id)) continue;
      seen.add(c.topic_id);
      signals.push({
        topic: { id: c.topic_id, slug: c.slug!, label: c.label! },
        source: "membership",
        weight: 0.5,
        viaCircle: { id: c.id, name: c.name },
      });
    }

    // Co-membership: for each other circle, how many of "my circle-mates" are in it.
    const co = this.db
      .prepare(`SELECT m2.circle_id AS circle_id, COUNT(DISTINCT m2.user_id) AS n
                FROM memberships mine
                JOIN memberships mates ON mates.circle_id = mine.circle_id AND mates.user_id <> mine.user_id
                JOIN memberships m2 ON m2.user_id = mates.user_id
                WHERE mine.user_id = ?
                GROUP BY m2.circle_id`)
      .all(userId) as unknown as { circle_id: number; n: number }[];

    return {
      id: u.id,
      firstName: u.first_name,
      location: u.location,
      bio: u.bio,
      joinedAt: u.joined_at,
      profileCompleteness: u.profile_completeness,
      statedTopicIds: new Set(stated.map((t) => t.id)),
      memberCircleIds: new Set(myCircles.map((c) => c.id)),
      topicSignals: signals,
      coMemberCounts: new Map(co.map((r) => [r.circle_id, r.n])),
    };
  }

  /**
   * Every Circle with the features the scorer needs. At 40 rows we load them all; at production
   * scale this becomes a topic-indexed candidate query + precomputed circle features (see DESIGN.md).
   */
  loadCandidates(user: UserContext, asOf: string): CircleCandidate[] {
    const windowStart = new Date(Date.parse(asOf) - 30 * 86_400_000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT c.*, t.slug AS topic_slug, t.label AS topic_label, s.seats_left, s.is_full,
                COALESCE(e.posts, 0) AS eng_posts, COALESCE(e.engagement, 0) AS eng_total
         FROM circles c
         JOIN circle_stats s ON s.circle_id = c.id
         LEFT JOIN topics t ON t.id = c.topic_id
         LEFT JOIN (
           SELECT circle_id, COUNT(*) AS posts, SUM(reaction_count + comment_count + save_count) AS engagement
           FROM posts WHERE created_at > ? AND created_at <= ? GROUP BY circle_id
         ) e ON e.circle_id = c.id
         ORDER BY c.id`,
      )
      .all(windowStart, asOf) as unknown as any[];

    const tagRows = this.db
      .prepare(`SELECT ct.circle_id, t.id, t.slug, t.label FROM circle_tags ct JOIN topics t ON t.id = ct.topic_id`)
      .all() as unknown as (TopicRef & { circle_id: number })[];
    const tags = new Map<number, TopicRef[]>();
    for (const r of tagRows) {
      const list = tags.get(r.circle_id) ?? [];
      list.push({ id: r.id, slug: r.slug, label: r.label });
      tags.set(r.circle_id, list);
    }

    const leaderRows = this.db
      .prepare(`SELECT m.circle_id, u.first_name, u.job_title FROM memberships m JOIN users u ON u.id = m.user_id
                WHERE m.role = 'leader' ORDER BY m.joined_at`)
      .all() as unknown as { circle_id: number; first_name: string; job_title: string | null }[];
    const leaders = new Map<number, LeaderRef[]>();
    for (const r of leaderRows) {
      const list = leaders.get(r.circle_id) ?? [];
      list.push({ firstName: r.first_name, jobTitle: r.job_title });
      leaders.set(r.circle_id, list);
    }

    // Members (excluding the user) who share ≥1 of the user's stated interests, per circle.
    const peers = new Map<number, number>();
    if (user.statedTopicIds.size > 0) {
      const ids = [...user.statedTopicIds];
      const peerRows = this.db
        .prepare(
          `SELECT m.circle_id, COUNT(DISTINCT m.user_id) AS n FROM memberships m
           JOIN user_topic_interests i ON i.user_id = m.user_id
           WHERE m.user_id <> ? AND i.topic_id IN (${ids.map(() => "?").join(",")})
           GROUP BY m.circle_id`,
        )
        .all(user.id, ...ids) as unknown as { circle_id: number; n: number }[];
      for (const r of peerRows) peers.set(r.circle_id, r.n);
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      coverImageUrl: r.cover_image_url,
      topic: r.topic_id ? { id: r.topic_id, slug: r.topic_slug, label: r.topic_label } : null,
      tags: tags.get(r.id) ?? [],
      format: r.format,
      access: r.access,
      joinPolicy: r.join_policy,
      maxMembers: r.max_members,
      memberCount: r.member_count,
      seatsLeft: r.seats_left,
      isFull: r.is_full === 1,
      createdAt: r.created_at,
      lastActivityAt: r.last_activity_at,
      posts30d: r.feed_posts_30d,
      chat30d: r.chat_messages_30d,
      engagementPerPost30d: r.eng_posts > 0 ? r.eng_total / r.eng_posts : 0,
      leaders: leaders.get(r.id) ?? [],
      membersSharingInterests: peers.get(r.id) ?? 0,
    }));
  }
}
