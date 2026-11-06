import { describe, expect, it } from "vitest";
import { inferTopicsFromBio } from "../src/recommender/bio.js";
import { diversify, isNearDuplicate, nameStems } from "../src/recommender/diversify.js";
import { joinList, recencyPhrase } from "../src/recommender/explain.js";
import { availability, healthScore, isInactive } from "../src/recommender/signals.js";
import type { CircleCandidate, ScoredCircle } from "../src/recommender/types.js";

const ASOF = "2026-09-21T00:00:00.000Z";
const T = (id: number, slug: string) => ({ id, slug, label: slug });
const circle = (over: Partial<CircleCandidate> = {}): CircleCandidate => ({
  id: 1, name: "Test Circle", slug: "test", description: "d", coverImageUrl: null, topic: T(1, "negotiation"), tags: [],
  format: "virtual", access: "public", joinPolicy: "open", maxMembers: null, memberCount: 10, seatsLeft: null,
  isFull: false, createdAt: ASOF, lastActivityAt: "2026-09-20T00:00:00.000Z", posts30d: 10, chat30d: 100,
  engagementPerPost30d: 8, leaders: [], membersSharingInterests: 0, ...over,
});

describe("activity / availability", () => {
  it("treats long-silent or near-silent Circles as inactive", () => {
    expect(isInactive(circle(), ASOF)).toBe(false);
    expect(isInactive(circle({ lastActivityAt: "2026-02-06T00:00:00.000Z", posts30d: 0, chat30d: 3 }), ASOF)).toBe(true);
    expect(isInactive(circle({ posts30d: 0, chat30d: 2 }), ASOF)).toBe(true);
    expect(isInactive(circle({ lastActivityAt: null }), ASOF)).toBe(true);
  });

  it("scores busier, fresher Circles higher", () => {
    const busy = healthScore(circle(), ASOF);
    const quiet = healthScore(circle({ posts30d: 2, chat30d: 10, engagementPerPost30d: 1, lastActivityAt: "2026-09-05T00:00:00.000Z" }), ASOF);
    expect(busy).toBeGreaterThan(quiet);
    expect(busy).toBeLessThanOrEqual(1);
  });

  it("handles uncapped, roomy and full Circles", () => {
    expect(availability(circle({ seatsLeft: null }))).toBe(1);
    expect(availability(circle({ seatsLeft: 0 }))).toBe(0);
    expect(availability(circle({ seatsLeft: 1 }))).toBeLessThan(availability(circle({ seatsLeft: 6 })));
  });
});

describe("near-duplicate detection", () => {
  it("matches name stems across word forms", () => {
    expect(nameStems("Negotiate Like a Leader")).toContain("negot");
    expect(nameStems("The Negotiation Table")).toContain("negot");
  });

  it("flags same-topic, same-stem Circles but not same-topic Circles with distinct identities", () => {
    const a = circle({ id: 10, name: "Negotiation Circle" });
    const b = circle({ id: 11, name: "The Negotiation Table" });
    const lead1 = circle({ id: 5, name: "Women Who Lead", topic: T(2, "leadership-skills") });
    const lead2 = circle({ id: 35, name: "Board-Ready Women", topic: T(2, "leadership-skills") });
    const other = circle({ id: 99, name: "Negotiation Circle", topic: T(3, "confidence") });
    expect(isNearDuplicate(a, b)).toBe(true);
    expect(isNearDuplicate(lead1, lead2)).toBe(false);
    expect(isNearDuplicate(a, other)).toBe(false); // different topic
    expect(isNearDuplicate(a, circle({ topic: null, name: "Negotiation" }))).toBe(false);
  });

  it("diversify keeps the best of a duplicate cluster and lists the rest as similar", () => {
    const mk = (c: CircleCandidate, total: number): ScoredCircle => ({
      circle: c, reasons: [], score: { relevance: 0, health: 0, peerFit: 0, availability: 0, welcome: 0, formatFit: 0, total },
    });
    const out = diversify([
      mk(circle({ id: 10, name: "Negotiation Circle" }), 0.9),
      mk(circle({ id: 11, name: "The Negotiation Table" }), 0.8),
      mk(circle({ id: 12, name: "Negotiate Like a Leader" }), 0.85),
      mk(circle({ id: 13, name: "Confident Voices", topic: T(4, "confidence") }), 0.5),
    ], 5);
    expect(out.map((o) => o.circle.id)).toEqual([10, 13]);
    expect(out[0]!.similar.map((s) => s.id).sort()).toEqual([11, 12]);
  });
});

describe("bio inference", () => {
  const topics = ["negotiation", "confidence", "career-breaks", "leadership-skills"].map((s, i) => T(i + 1, s));
  it("pulls conservative topic hints from free text", () => {
    const hits = inferTopicsFromBio("Prepping for a big comp conversation and want to build confidence around it.", topics);
    expect(hits.map((h) => h.topic.slug).sort()).toEqual(["confidence", "negotiation"]);
    expect(inferTopicsFromBio("Career changer, ex-consultant, now in tech.", topics)).toEqual([]);
    expect(inferTopicsFromBio(null, topics)).toEqual([]);
  });
});

describe("copy helpers", () => {
  it("formats lists and recency for humans", () => {
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b"])).toBe("a and b");
    expect(joinList(["a", "b", "c"])).toBe("a, b, and c");
    expect(recencyPhrase("2026-09-20T18:00:00.000Z", ASOF)).toBe("active today");
    expect(recencyPhrase("2026-09-19T12:00:00.000Z", ASOF)).toBe("active yesterday");
    expect(recencyPhrase("2026-09-01T00:00:00.000Z", ASOF)).toBe("last active 20 days ago");
  });
});
