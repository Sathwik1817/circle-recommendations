# Lean In Circle Recommendations API

Recommends Circles a member should join, ranked, with a short, member-facing explanation for each.

- **Design doc (1 page):** [`docs/DESIGN.md`](docs/DESIGN.md)
- **Database schema + rationale:** [`db/schema.sql`](db/schema.sql) · [`docs/SCHEMA.md`](docs/SCHEMA.md)
- **Planted-scenario output:** [`docs/SAMPLE_OUTPUT.md`](docs/SAMPLE_OUTPUT.md)
- **How I worked with AI:** [`docs/AI_USAGE.md`](docs/AI_USAGE.md)

## Quick start

Requires **Node.js 22.13+** (`node -v`; Node 24 LTS recommended). Nothing else is needed: the app uses Node’s built-in `node:sqlite`, so there are no native modules to compile and no database server to run.

```bash
npm install
npm start            # seeds db/circles.db from data/*.json on first run, serves on :3000
```

```bash
curl "http://localhost:3000/users/7/recommendations"
curl "http://localhost:3000/users/23/recommendations?debug=true"   # + score breakdown and exclusions
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | 534 tests: planted scenarios, API contract, invariants for all 100 users, unit tests |
| `npm run recommend` | Prints readable results for the planted users (7, 15, 23, 42) without starting the server |
| `npm run recommend -- all` | One line per user, as a sanity sweep |
| `npm run seed` | Rebuilds `db/circles.db` from `data/*.json` (idempotent) |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run dev` | Server with reload on file changes |

Environment variables: `PORT` (default 3000), `DB_PATH` (default `db/circles.db`), `AS_OF` (see below).

## API

### `GET /users/:userId/recommendations`

| Query param | Default | Notes |
| --- | --- | --- |
| `limit` | 5 | 1–20 |
| `debug` | false | Adds per-result `score` breakdowns, the user's inferred signals, and every excluded Circle with its reasons |
| `as_of` | dataset clock | ISO datetime used as "now" for recency math (see below) |

```jsonc
{
  "user": { "id": 23, "first_name": "Grace" },
  "strategy": "personalized",            // personalized | inferred | cold_start
  "as_of": "2026-09-21T00:00:00.000Z",
  "recommendations": [
    {
      "rank": 1,
      "circle": { "id": 22, "name": "Level Up Collective", "topic": { "slug": "getting-promoted", "label": "Getting promoted" },
                  "format": "hybrid", "join_policy": "request", "member_count": 14, "max_members": 20, "seats_left": 6,
                  "leader": { "first_name": "Aisha", "job_title": "Engineering Manager" }, "...": "..." },
      "match_type": "match",               // match = fits her interests; explore = popular / social proof
      "explanation": "All about getting promoted, one of your interests. Very active: 8 posts and 144 chat messages in the last 30 days, active today. 2 of 14 members share your interests.",
      "reasons": [ { "type": "interest", "text": "..." }, { "type": "activity", "text": "..." }, "..." ],
      "similar_circles": []                // near-duplicates folded into this slot
    }
  ],
  "tips": []                               // e.g. "Pick a few topics…" for cold-start members
}
```

Errors: `400 invalid_user_id | invalid_query`, `404 user_not_found`. Every error has a JSON body.

### `GET /health`
`{ "status": "ok", "data_clock": "2026-09-21T00:00:00.000Z" }`

## How it works (short version)

**Filter → score → diversify → explain.** Full, inactive, unlisted, and already-joined Circles are removed by hard rules. So are near-duplicates of a Circle she's already in, and identity-based Circles she hasn't opted into. The rest get a blended score: topic relevance 55%, Circle health 25%, then peer fit, format fit, and availability. A greedy re-rank folds near-duplicate Circles into one slot (`similar_circles`) and spreads the list across her interests. Explanations are templated from facts the member can verify. Details and tradeoffs: [`docs/DESIGN.md`](docs/DESIGN.md).

### Planted scenarios

| Scenario | User | Result |
| --- | --- | --- |
| Cold start | 42 | `cold_start` strategy: 5 active, mostly open, virtual-friendly Circles on 5 different topics, plus a tip to add interests |
| Obvious matches | 7 | #5 Women Who Lead and #6 Speak Up Circle both in the top 3. #6 is explained as covering *both* of her interests |
| Duplicate Circles | 15 | Only one of #10/#11/#12 is returned (rank 2). The other two appear as `similar_circles` |
| Full / inactive | 23 | #22 Level Up Collective is rank 1. #20 (full) and #21 (inactive) never appear, and `?debug=true` shows why |

### About "now"
The dataset is a snapshot that ends 2026-09-21. Against the real clock, every Circle would look dormant, so by default "now" is the latest activity timestamp in the DB (`/health` shows it). Override it with `?as_of=` or `AS_OF=` (e.g. `?as_of=2027-06-01T00:00:00Z` correctly returns nothing, because every Circle has gone quiet by then). In production this is just `now()`.

## Project layout

```
db/schema.sql                 tables, indexes, circle_stats view
data/                         provided seed JSON, its README, and generator (unchanged except output path)
src/
  server.ts, app.ts           HTTP layer (Express 5, zod validation)
  db.ts                       open / migrate / seed
  recommender/
    repository.ts             all SQL: user context + candidate features
    signals.ts                eligibility rules + scoring components (pure functions)
    diversify.ts              near-duplicate folding + topic-diversity re-rank
    explain.ts                member-facing copy
    bio.ts                    conservative bio keyword → topic hints
    config.ts                 every weight/threshold in one place
    index.ts                  orchestration → response DTO
scripts/                      seed + CLI preview
tests/                        scenarios, invariants (all users), API, unit
```
