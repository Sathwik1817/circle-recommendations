import { createApp } from "../src/app.js";
import { getDb } from "../src/db.js";
import { Recommender } from "../src/recommender/index.js";
import { Repository } from "../src/recommender/repository.js";

/** Fresh in-memory DB seeded from data/*.json — tests never touch the dev database. */
export function setup() {
  const db = getDb(":memory:");
  const repo = new Repository(db);
  return { db, repo, recommender: new Recommender(repo), app: createApp(db) };
}
