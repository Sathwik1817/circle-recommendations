# How I used AI on this take-home

The brief encourages AI tools, so here is how I used them and where I overrode them.

**Used AI for:** scaffolding (Express/SQLite boilerplate, the test harness), a first pass at data profiling scripts, drafting the scoring functions and test cases, and a review of this doc.

**What I decided or changed after reviewing the output**
- **Profiling before modeling.** I checked how member locations are distributed inside Circles. They're random, so I left location out of the ranking instead of adding a signal that only looks like personalization.
- **Co-membership was overpowering real matches.** In the first version, "people from your Circles are here" (driven by a single shared person) outranked Circles tagged with a member's only stated interest. For user 23, the slots after #22 went to negotiation and feedback Circles instead of promotion-tagged ones. I raised tag matches from 0.4 to 0.5, capped co-membership at 0.25 with a minimum of 2 shared people, and labeled social-only results as `explore` instead of `match`.
- **Identity Circles.** Running every user showed the scorer recommending *Working Mothers United* to members who never chose that topic, because of a tag overlap. I added an explicit opt-in rule for identity Circles. This is a product and mission call, not a tuning tweak.
- **Duplicates of Circles she's already in.** The sweep also caught "Negotiation Circle" being recommended to someone already in "The Negotiation Table". I added a `similar_to_joined` exclusion.
- **Explanation honesty.** Copy said "Matches your interest" for tag-only matches. I split it into "All about X" (primary topic) and "Often discusses X" (tag), so we never overclaim.
- **The clock.** Using wall-clock time made every Circle look inactive, because the data is a snapshot. I pinned "now" to the dataset clock and made it overridable.

**How I verified:** the invariant tests run every member in the dataset (never full, inactive, unlisted, or already joined; no duplicate pairs; no jargon in the copy; deterministic results). I also ran `npm run recommend -- all` to read the lists by eye, and measured exposure concentration (the most-recommended Circle appears in 45% of lists; balancing that is listed as future work).
