import request from "supertest";
import { describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

const { app } = setup();

describe("HTTP API contract", () => {
  it("GET /health reports ok and the dataset clock", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", data_clock: expect.stringMatching(/^2026-09-2/) });
  });

  it("returns the documented response shape", async () => {
    const res = await request(app).get("/users/7/recommendations");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ user: { id: 7, first_name: "Priya" }, strategy: "personalized", as_of: expect.any(String) });
    const r = res.body.recommendations[0];
    expect(r).toMatchObject({
      rank: 1,
      circle: { id: expect.any(Number), name: expect.any(String), format: expect.any(String), join_policy: expect.any(String) },
      match_type: expect.stringMatching(/^(match|explore)$/),
      explanation: expect.any(String),
      reasons: expect.any(Array),
      similar_circles: expect.any(Array),
    });
    expect(res.body.debug).toBeUndefined();
  });

  it("honors ?limit", async () => {
    const res = await request(app).get("/users/7/recommendations?limit=3");
    expect(res.body.recommendations).toHaveLength(3);
  });

  it("adds score breakdowns and exclusions with ?debug=true", async () => {
    const res = await request(app).get("/users/7/recommendations?debug=true");
    expect(res.body.recommendations[0].score).toHaveProperty("relevance");
    expect(res.body.debug.excluded.length).toBeGreaterThan(0);
  });

  it("re-evaluates activity relative to ?as_of (a stale snapshot shouldn't recommend dead Circles)", async () => {
    const res = await request(app).get("/users/7/recommendations?as_of=2027-06-01T00:00:00Z");
    expect(res.status).toBe(200);
    expect(res.body.recommendations).toHaveLength(0);
  });

  it.each([
    ["/users/9999/recommendations", 404, "user_not_found"],
    ["/users/abc/recommendations", 400, "invalid_user_id"],
    ["/users/0/recommendations", 400, "invalid_user_id"],
    ["/users/7/recommendations?limit=0", 400, "invalid_query"],
    ["/users/7/recommendations?limit=500", 400, "invalid_query"],
    ["/users/7/recommendations?limit=abc", 400, "invalid_query"],
    ["/users/7/recommendations?as_of=yesterday", 400, "invalid_query"],
    ["/nope", 404, "not_found"],
  ])("GET %s → %i", async (path, status, error) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(error);
  });
});
