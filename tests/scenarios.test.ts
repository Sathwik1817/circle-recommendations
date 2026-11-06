/**
 * The four planted scenarios from the dataset README, exercised through the real HTTP API.
 */
import request from "supertest";
import { describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

const { app } = setup();
const get = (userId: number, qs = "") => request(app).get(`/users/${userId}/recommendations${qs}`);
const ids = (body: any): number[] => body.recommendations.map((r: any) => r.circle.id);

describe("Cold start — user 42 (no interests, no memberships, empty profile)", () => {
  it("still returns a full, sensible list using the cold-start strategy", async () => {
    const res = await get(42);
    expect(res.status).toBe(200);
    expect(res.body.strategy).toBe("cold_start");
    expect(res.body.recommendations).toHaveLength(5);
  });

  it("spans different topics rather than five of the same thing", async () => {
    const res = await get(42);
    const topics = res.body.recommendations.map((r: any) => r.circle.topic?.slug);
    expect(new Set(topics).size).toBe(topics.length);
  });

  it("favors low-friction first Circles and nudges her to complete her profile", async () => {
    const res = await get(42);
    const open = res.body.recommendations.filter((r: any) => r.circle.join_policy === "open").length;
    expect(open).toBeGreaterThanOrEqual(4);
    expect(res.body.tips.length).toBeGreaterThan(0);
    for (const r of res.body.recommendations) {
      expect(r.match_type).toBe("explore");
      expect(r.explanation).toMatch(/great first Circle/);
    }
  });

  it("does not guess at identity-based or topic-less Circles for a member we know nothing about", async () => {
    const res = await get(42, "?limit=20");
    for (const id of [19, 29, 18, 27, 28]) expect(ids(res.body)).not.toContain(id);
  });
});

describe("Obvious matches — user 7 (leadership-skills + public-speaking)", () => {
  it("puts Women Who Lead (#5) and Speak Up Circle (#6) in the top 3", async () => {
    const res = await get(7);
    expect(res.body.strategy).toBe("personalized");
    const top3 = ids(res.body).slice(0, 3);
    expect(top3).toContain(5);
    expect(top3).toContain(6);
  });

  it("explains each match in terms of her own interests", async () => {
    const res = await get(7);
    const byId = Object.fromEntries(res.body.recommendations.map((r: any) => [r.circle.id, r]));
    expect(byId[5].explanation).toMatch(/leadership skills/);
    expect(byId[6].explanation).toMatch(/public speaking/);
    expect(byId[6].explanation).toMatch(/leadership skills/); // #6 is tagged with both of her interests
  });

  it("covers both of her interests in the top 2", async () => {
    const res = await get(7);
    const topics = res.body.recommendations.slice(0, 2).map((r: any) => r.circle.topic.slug);
    expect(new Set(topics)).toEqual(new Set(["leadership-skills", "public-speaking"]));
  });
});

describe("Duplicate Circles — user 15 (negotiation; #10/#11/#12 near-identical)", () => {
  it("returns exactly one of the three near-identical Negotiation Circles", async () => {
    const res = await get(15, "?limit=20");
    const dupes = ids(res.body).filter((id) => [10, 11, 12].includes(id));
    expect(dupes).toHaveLength(1);
  });

  it("ranks that representative near the top and offers the others as alternatives", async () => {
    const res = await get(15);
    const rep = res.body.recommendations.find((r: any) => [10, 11, 12].includes(r.circle.id));
    expect(rep.rank).toBeLessThanOrEqual(2);
    const alts = rep.similar_circles.map((s: any) => s.id).sort();
    expect(alts).toEqual([10, 11, 12].filter((id) => id !== rep.circle.id));
  });

  it("also serves her second interest (confidence)", async () => {
    const res = await get(15);
    expect(res.body.recommendations.slice(0, 3).some((r: any) => r.circle.topic?.slug === "confidence")).toBe(true);
  });
});

describe("Full / inactive — user 23 (getting-promoted)", () => {
  it("ranks the healthy alternative, Level Up Collective (#22), first", async () => {
    const res = await get(23);
    expect(ids(res.body)[0]).toBe(22);
  });

  it("never returns the full (#20) or inactive (#21) Circles, at any list length", async () => {
    const res = await get(23, "?limit=20");
    expect(ids(res.body)).not.toContain(20);
    expect(ids(res.body)).not.toContain(21);
  });

  it("exposes why they were excluded in debug mode", async () => {
    const res = await get(23, "?debug=true");
    const ex = Object.fromEntries(res.body.debug.excluded.map((e: any) => [e.circle_id, e.reasons]));
    expect(ex[20]).toContain("full");
    expect(ex[21]).toContain("inactive");
  });
});
