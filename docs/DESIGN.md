# Technical Design — Circle Recommendations

**What it is.** `GET /users/:id/recommendations` returns a ranked list of Circles a member should join, each with a one-line, member-facing reason. TypeScript + Express 5 + SQLite (Node’s built-in `node:sqlite`, so there are no native dependencies), seeded automatically from the provided JSON. 534 tests cover the four planted scenarios, the API contract, and invariants for all 100 members.

## How a request is ranked: filter → score → diversify → explain

1. **Hard filters (product rules, not weights).** A Circle is dropped if she's already in it, it's **full** (`member_count ≥ max_members`), it's **inactive** (no activity in 45 days, or <1 post and <5 chat messages in 30 days), it's **unlisted**, or it's a **near-duplicate of a Circle she's already in**. Sending someone who wants support to a full or dead Circle breaks a promise, however good the topic match looks. That's why these are filters and not penalties. **Identity Circles** (working motherhood, being the only one) are shown only when she picked that topic herself. We never infer them from tags or bios. Topic-less community Circles are shown only when people from her Circles are in them.
2. **Score (0–1 blend, weights in `config.ts`).** *Relevance 55%*: a primary-topic match counts 1.0, a tag-only match 0.5, extra matched interests add a bonus. Signals are weighted by how much we trust them: stated interest 1.0 > bio keywords 0.6 > topics of Circles she already joined 0.5. Co-membership ("people from your Circles are here") is capped at 0.25 and needs ≥2 people, so on its own it never beats a real interest match. *Health 25%*: posts, chat volume, engagement per post, and recency with a 10-day half-life. Every term is a saturating curve, so one huge Circle can't drown out the others. *Peer fit 8%*: the share of members who share her interests. *Format fit / availability / welcome*: the rest.
3. **Diversify.** A greedy re-rank. Near-duplicates (same topic + shared name stem, e.g. "Negotiation Circle" / "The Negotiation Table" / "Negotiate Like a Leader") collapse into one slot, and the others come back as `similar_circles`. She still sees the options without three slots being spent on one idea. Each further pick on the same topic is multiplied by 0.7, so the list spans her interests.
4. **Explain.** Templated copy built only from facts she can check (her interests, her Circles, visible activity), e.g. *"Covers two of your interests: public speaking and leadership skills. Very active: 8 posts and 54 chat messages in the last 30 days, active yesterday."* It never shows scores and never says anything negative about a Circle.

**Cold start** (user 42: no interests, memberships, or profile). We switch to a "great first Circle" blend: health 50%, welcome 25% (open to join, has a description, cover image, and leader), and format 15% (virtual/hybrid preferred, since we don't know where she lives). Diversity gives her a sampler of topics, plus a tip to pick interests. Members with no stated interests but some history use the **inferred** strategy (bio + memberships + co-membership).

## Signals I deliberately did *not* use
- **Location.** Circles have no location, and member locations within a Circle are uniformly random in this data (I checked). Geo-matching would be noise dressed up as personalization.
- **Industry / job title / company.** No relationship to Circle topics in this dataset. Using them would add bias risk with no signal behind it.
- **`profile_completeness`.** It describes the member, not the fit, so it drives a profile-completion tip instead of the ranking.

## Key tradeoffs
- **Heuristic, explainable scoring instead of a learned model.** We have no outcome labels (joins, retention), and the reasons have to be true. Every point of score traces back to a sentence the member can read.
- **Template explanations instead of an LLM.** Deterministic, zero latency, no risk of hallucinating a reason. An LLM could later rewrite the tone, limited to the same structured `reasons[]`.
- **Time is pinned to the dataset's clock** (`max(last_activity_at)`), with an override via `?as_of=` or `AS_OF`. With today's wall-clock time, every Circle in the snapshot would look dead. In production, `as_of = now()`.
- **Name-stem duplicate detection** is crude but transparent, and it correctly leaves "Women Who Lead" and "Board-Ready Women" as distinct Circles. The production version would use embedding similarity.
- **Scoring all 40 Circles in memory** is fine at this size. The next section covers how this changes at scale.

## Production scale (millions of members, 170k+ Circles)
- **Postgres** with the same schema. Candidate generation comes from indexed lookups (`circles(topic_id)`, `circle_tags(topic_id)`, co-membership), capped at a few hundred candidates, then scored in-process. `circle_stats` and the activity aggregates become a materialized table refreshed by feed/chat events.
- **Cache** each member's list in Redis, refreshed when she joins a Circle, edits her interests, or a Circle fills up. Precompute lists nightly for inactive members, for email digests.
- **Embeddings** for Circle name/description and member bio (pgvector). They replace the keyword rules, power duplicate detection, and enable semantic matching.
- **Capacity- and exposure-aware ranking.** Today the Elevation Circle shows up in 45% of lists. At scale that would fill popular Circles and starve small ones, so recommendations should be spread in proportion to open seats and leader capacity.
- **Close the loop.** Log impressions, clicks, join requests, accepts, and 30-day retention. A/B test weights, then train a learning-to-rank model with these heuristics as features and fallback. Track guardrail metrics: share of recommendations to full or inactive Circles (must be 0), and topic coverage.
- **Missing data I'd ask for:** Circle location or time zone and meeting cadence, language, leader responsiveness, and request-approval rates. Recommending a `request` Circle whose leader never approves anyone is its own kind of dead end.

**With more time:** exposure balancing, meeting-time and time-zone fit, an offline evaluation harness (precision@k on held-out joins), an OpenAPI spec, Docker, and member feedback ("not for me") as a negative signal.
