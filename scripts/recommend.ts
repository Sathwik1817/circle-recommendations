/**
 * CLI for eyeballing results without starting the server.
 *   npm run recommend -- 7            # one user
 *   npm run recommend -- 7 15 23 42   # the planted scenarios
 *   npm run recommend -- all          # one line per user (sanity sweep)
 */
import { getDb } from "../src/db.js";
import { Recommender } from "../src/recommender/index.js";
import { Repository } from "../src/recommender/repository.js";

const db = getDb(":memory:");
const rec = new Recommender(new Repository(db));
const args = process.argv.slice(2);
const ids = args[0] === "all"
  ? (db.prepare("SELECT id FROM users ORDER BY id").all() as unknown as { id: number }[]).map((r) => r.id)
  : (args.length ? args : ["7", "15", "23", "42"]).map(Number);

for (const id of ids) {
  const r = rec.recommend(id, { debug: args[0] !== "all" });
  if (!r) { console.log(`user ${id}: not found`); continue; }
  if (args[0] === "all") {
    console.log(`${String(id).padStart(3)} ${r.strategy.padEnd(12)} ${r.recommendations.map((x) => `#${x.circle.id}${x.match_type === "explore" ? "*" : ""}`).join(" ")}`);
    continue;
  }
  console.log(`\n=== user ${id} (${r.user.first_name}) — strategy: ${r.strategy} ===`);
  console.log("signals:", r.debug!.user_signals.map((s) => `${s.topic}[${s.source}]`).join(", ") || "(none)");
  for (const x of r.recommendations) {
    const sim = x.similar_circles.length ? `  (+ similar: ${x.similar_circles.map((s) => `#${s.id}`).join(", ")})` : "";
    console.log(` ${x.rank}. #${x.circle.id} ${x.circle.name} [${x.match_type}] score=${x.score!.total} div=${x.score!.diversified}${sim}`);
    console.log(`    ${x.explanation}`);
  }
  console.log(" excluded:", r.debug!.excluded.map((e) => `#${e.circle_id}:${e.reasons.join("+")}`).join(" "));
}
