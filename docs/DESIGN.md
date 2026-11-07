# Technical Design — Circle Recommendations

**What I built.** `GET /users/:id/recommendations` returns a ranked list of Circles for a member, each with a short, member-facing reason. Stack: TypeScript, Express 5, and SQLite via Node’s built-in `node:sqlite` (no native dependencies), seeded from the provided JSON. 534 tests cover the planted scenarios, the API contract, and invariants for all 100 members. Each request runs four steps: **filter → score → diversify → explain**.

1. **Filter (product rules, not weights).** A Circle is dropped if she's already in it, or if it is **full**, **inactive** (no activity in 45 days, or almost none in 30), **unlisted**, or a near-duplicate of a Circle she's in. A full or dead Circle is a broken promise however well it matches. **Identity Circles** (working motherhood, being the only one) are shown only if she picked that topic herself; we never infer identity.
2. **Score (weights in `config.ts`).** *Relevance 55%:* her primary topic = 1.0, tag-only = 0.5. Signals are discounted by how much we trust them: stated interest 1.0 > bio keyword 0.6 > topic of a Circle she's in 0.5. "People from your Circles are here" is capped low. *Health 25%:* posts, chat, engagement per post, recency, all saturating so big Circles don't swamp small ones. *Peer fit, format, availability:* the rest. **Cold start** (user 42) switches to "great first Circle" weights: active, open to join, virtual-friendly.
3. **Diversify.** A greedy re-rank. Near-duplicates (same topic + shared name stem: #10/#11/#12) fold into one slot and are returned as `similar_circles`. Each extra pick on a topic already shown is multiplied by 0.7, so the list spans her interests.
4. **Explain.** Template copy from facts she can verify: *"Covers two of your interests: public speaking and leadership skills. Very active: 8 posts and 54 chat messages in the last 30 days."* No scores, nothing negative about a Circle.

**Signals I chose not to use.** Location: Circles have none, and member locations within a Circle are random in this data. Industry and job title: no link to topics, only bias risk. Profile completeness: it describes the member, not the fit, so it drives a profile tip instead.

**Tradeoffs**
- **Explainable heuristics instead of a learned model.** There are no outcome labels yet, and every reason shown must be true.
- **Templates instead of an LLM.** Predictable, instant, and nothing can be made up.
- **"Now" = the dataset's latest timestamp**, overridable with `?as_of=`. Against today's wall clock, every Circle in this snapshot would look dead.
- **Name-stem duplicate detection.** Crude but transparent; it keeps "Women Who Lead" and "Board-Ready Women" distinct.
- **Scoring all 40 Circles in memory** is fine at this size and doesn't scale, which is the next section.

**For production scale**
- **Postgres, same schema.** Pull a few hundred candidates through the topic and co-membership indexes, then score. Turn Circle stats into a table refreshed by feed and chat events.
- **Redis cache per member,** refreshed when she joins a Circle, edits her interests, or a Circle fills up. Nightly precompute for email digests.
- **Embeddings (pgvector)** for bios and Circle descriptions, replacing the keyword rules and the duplicate heuristic.
- **Spread exposure by open seats.** Today one Circle appears in 45% of lists, which would fill popular Circles and starve small ones.
- **Close the loop.** Log impressions, joins, and 30-day retention, A/B test the weights, then learn to rank, keeping these rules as features and as a fallback. Guardrail: zero recommendations to full or inactive Circles.

**With more time:** meeting-time and time-zone fit, an offline evaluation on held-out joins, "not for me" feedback, request-approval rates, OpenAPI and Docker.
