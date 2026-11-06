import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_DB_PATH = process.env.DB_PATH ?? join(ROOT, "db", "circles.db");
const DATA_DIR = join(ROOT, "data");

/**
 * Node's built-in SQLite driver (node:sqlite, Node 22.13+): zero native dependencies, so
 * `npm install` never needs a compiler or a prebuilt binary download on the reviewer's machine.
 */
export type DB = DatabaseSync;

export function openDb(path: string = DEFAULT_DB_PATH): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return db;
}

/** Minimal transaction helper (node:sqlite has no db.transaction()). */
export function inTransaction<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function applySchema(db: DB): void {
  db.exec(readFileSync(join(ROOT, "db", "schema.sql"), "utf8"));
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(join(DATA_DIR, file), "utf8")) as T;

interface TopicRow { id: number; slug: string; label: string; domain: string }
interface UserRow {
  id: number; first_name: string; last_name: string; has_photo: boolean; bio: string | null;
  job_title: string | null; company: string | null; industry: string | null; location: string | null;
  joined_at: string; topic_interests: string[]; profile_completeness: number;
}
interface CircleRow {
  id: number; name: string; slug: string; description: string | null; topic: string | null; tags: string[];
  cover_image_url: string | null; format: string; access: string; join_policy: string;
  max_members: number | null; member_count: number; created_at: string; last_activity_at: string;
  feed_posts_30d: number; chat_messages_30d: number;
}
interface MembershipRow { user_id: number; circle_id: number; role: string; joined_at: string }
interface PostRow {
  id: number; circle_id: number; author_user_id: number; body: string; reaction_count: number;
  comment_count: number; save_count: number; created_at: string;
}

/** Idempotent: wipes and reloads all tables from data/*.json in one transaction. */
export function seed(db: DB): Record<string, number> {
  applySchema(db);
  const topics = readJson<TopicRow[]>("topics.json");
  const users = readJson<UserRow[]>("users.json");
  const circles = readJson<CircleRow[]>("circles.json");
  const memberships = readJson<MembershipRow[]>("memberships.json");
  const posts = readJson<PostRow[]>("activity.json");
  const topicId = new Map(topics.map((t) => [t.slug, t.id]));
  const tid = (slug: string) => {
    const id = topicId.get(slug);
    if (id === undefined) throw new Error(`Unknown topic slug in seed data: ${slug}`);
    return id;
  };

  inTransaction(db, () => {
    for (const t of ["posts", "memberships", "circle_tags", "circles", "user_topic_interests", "users", "topics"]) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
    const insTopic = db.prepare("INSERT INTO topics (id, slug, label, domain) VALUES (?, ?, ?, ?)");
    for (const t of topics) insTopic.run(t.id, t.slug, t.label, t.domain);

    const insUser = db.prepare(`INSERT INTO users (id, first_name, last_name, has_photo, bio, job_title, company,
      industry, location, joined_at, profile_completeness) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const insInterest = db.prepare("INSERT OR IGNORE INTO user_topic_interests (user_id, topic_id) VALUES (?, ?)");
    for (const u of users) {
      insUser.run(u.id, u.first_name, u.last_name, u.has_photo ? 1 : 0, u.bio, u.job_title, u.company,
        u.industry, u.location, u.joined_at, u.profile_completeness);
      for (const s of u.topic_interests) insInterest.run(u.id, tid(s));
    }

    const insCircle = db.prepare(`INSERT INTO circles (id, name, slug, description, topic_id, cover_image_url, format,
      access, join_policy, max_members, member_count, created_at, last_activity_at, feed_posts_30d, chat_messages_30d)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insTag = db.prepare("INSERT OR IGNORE INTO circle_tags (circle_id, topic_id) VALUES (?, ?)");
    for (const c of circles) {
      insCircle.run(c.id, c.name, c.slug, c.description, c.topic ? tid(c.topic) : null, c.cover_image_url, c.format,
        c.access, c.join_policy, c.max_members, c.member_count, c.created_at, c.last_activity_at,
        c.feed_posts_30d, c.chat_messages_30d);
      for (const s of c.tags) insTag.run(c.id, tid(s)); // tags can repeat in the raw data; dedupe here
    }

    const insM = db.prepare("INSERT OR IGNORE INTO memberships (user_id, circle_id, role, joined_at) VALUES (?,?,?,?)");
    for (const m of memberships) insM.run(m.user_id, m.circle_id, m.role, m.joined_at);

    const insP = db.prepare(`INSERT INTO posts (id, circle_id, author_user_id, body, reaction_count, comment_count,
      save_count, created_at) VALUES (?,?,?,?,?,?,?,?)`);
    for (const p of posts) insP.run(p.id, p.circle_id, p.author_user_id, p.body, p.reaction_count,
      p.comment_count, p.save_count, p.created_at);
  });
  return { topics: topics.length, users: users.length, circles: circles.length, memberships: memberships.length, posts: posts.length };
}

/** Open the DB, seeding it first if it does not exist yet (one-command local setup). */
export function getDb(path: string = DEFAULT_DB_PATH): DB {
  const fresh = path === ":memory:" || !existsSync(path);
  const db = openDb(path);
  if (fresh) seed(db);
  else applySchema(db);
  return db;
}
