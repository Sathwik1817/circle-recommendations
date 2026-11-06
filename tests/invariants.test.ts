/**
 * Properties that must hold for EVERY member in the dataset, not just the planted ones.
 */
import { describe, expect, it } from "vitest";
import { isNearDuplicate } from "../src/recommender/diversify.js";
import { isInactive } from "../src/recommender/signals.js";
import { setup } from "./helpers.js";

const { db, repo, recommender } = setup();
const userIds = (db.prepare("SELECT id FROM users ORDER BY id").all() as unknown as { id: number }[]).map((r) => r.id);
const asOf = repo.dataClock();

describe.each(userIds)("user %i", (userId) => {
  const res = recommender.recommend(userId, { limit: 10 })!;
  const user = repo.loadUser(userId)!;
  const circles = new Map(repo.loadCandidates(user, asOf).map((c) => [c.id, c]));
  const recs = res.recommendations;

  it("gets a non-empty, correctly ranked list with unique Circles", () => {
    expect(recs.length).toBeGreaterThanOrEqual(5);
    expect(recs.map((r) => r.rank)).toEqual(recs.map((_, i) => i + 1));
    expect(new Set(recs.map((r) => r.circle.id)).size).toBe(recs.length);
  });

  it("never recommends a Circle she's in, or one that is full, inactive, or unlisted", () => {
    for (const r of recs) {
      const c = circles.get(r.circle.id)!;
      expect(user.memberCircleIds.has(c.id)).toBe(false);
      expect(c.isFull).toBe(false);
      expect(isInactive(c, asOf)).toBe(false);
      expect(c.access).toBe("public");
    }
  });

  it("never shows two near-duplicate Circles, or a near-duplicate of one she's already in", () => {
    const picked = recs.map((r) => circles.get(r.circle.id)!);
    const joined = [...user.memberCircleIds].map((id) => circles.get(id)!);
    for (let i = 0; i < picked.length; i++) {
      for (let j = i + 1; j < picked.length; j++) expect(isNearDuplicate(picked[i]!, picked[j]!)).toBe(false);
      for (const m of joined) expect(isNearDuplicate(m, picked[i]!)).toBe(false);
    }
  });

  it("gives every result a member-facing explanation with no internal jargon or scores", () => {
    for (const r of recs) {
      expect(r.explanation.length).toBeGreaterThan(20);
      expect(r.explanation).not.toMatch(/score|relevance|0\.\d|undefined|null|NaN/i);
      expect(r.score).toBeUndefined(); // scores only appear with ?debug=true
    }
  });

  it("is deterministic", () => {
    const again = recommender.recommend(userId, { limit: 10 })!;
    expect(again.recommendations.map((r) => r.circle.id)).toEqual(recs.map((r) => r.circle.id));
  });
});
