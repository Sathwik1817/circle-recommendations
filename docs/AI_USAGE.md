# How I used AI on this take-home

The brief encourages using AI tools, so here is how I used them and where I overrided them.

Used AI for Express/SQLite boilerplate, test harness, a first pass at the data profiling scripts, drafting the scoring functions and test cases, and reviewing this document.

What I adopted after viewing the output?

Profiling before modeling. I checked how the member locations are distributed inside circles, which turned out to be random so I left location out of the ranking instead of adding a signal that only looks like personalization.

Co-membership was overpowering real matches. In the first version "people from your circles are here" was winning even when it came from a single shared person, and it ranked above circles tagged with the member's only stated interest. For user 23 the slots after #22 went to negotiation and feedback circles instead of the promotion tagged ones. So I raised tag matches from 0.4 to 0.5, capped co-membership at 0.25 with a minimum of 2 shared people and labeled the social only results as explore instead of match.

Identity circles. When I ran it for every user, the scorer was recommending Working Mothers United to members who never chose that topic, just because of a tag overlap. I added an explicit opt-in rule for identity circles, which is more of a product and mission call than a tuning change.

Duplicates of circles she is already in. The same sweep caught Negotiation Circle being recommended to someone who is already in The Negotiation Table, so I added a similar_to_joined exclusion.

Honest explanations. The copy said "Matches your interest" even for tag only matches. I split it into "All about X" for the primary topic and "Often discusses X" for tags so it never overclaims.

The clock. Using the current time made every circle look inactive since the data is a snapshot. I pinned "now" to the latest timestamp in the dataset and made it overridable with as_of.

How did I verify it?

The invariant tests run for every member in the dataset and check that nothing returned is full, inactive, unlisted or already joined, that there are no duplicate pairs, no jargon in the copy and that the results are deterministic. I also ran npm run recommend -- all to read through the lists myself and measured how concentrated the recommendations are. The most recommended circle shows up in 45% of the lists, balancing that is listed as future work in the design doc.
