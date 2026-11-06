import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { DB } from "./db.js";
import { CONFIG } from "./recommender/config.js";
import { Recommender } from "./recommender/index.js";
import { Repository } from "./recommender/repository.js";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(CONFIG.maxLimit).optional(),
  as_of: z.iso.datetime({ offset: true }).optional(),
  debug: z.enum(["true", "false", "1", "0"]).optional().transform((v) => v === "true" || v === "1"),
});
const UserIdSchema = z.coerce.number().int().positive();

export function createApp(db: DB) {
  const repo = new Repository(db);
  const recommender = new Recommender(repo);
  const app = express();
  app.disable("x-powered-by");

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", data_clock: repo.dataClock() });
  });

  /**
   * GET /users/:userId/recommendations?limit=5&debug=true&as_of=2026-09-21T00:00:00Z
   * Ranked Circles the member should join, each with a member-facing explanation.
   */
  app.get("/users/:userId/recommendations", (req: Request, res: Response) => {
    const id = UserIdSchema.safeParse(req.params.userId);
    if (!id.success) return void res.status(400).json({ error: "invalid_user_id", message: "userId must be a positive integer" });
    const q = QuerySchema.safeParse(req.query);
    if (!q.success) {
      return void res.status(400).json({ error: "invalid_query", issues: q.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    const result = recommender.recommend(id.data, { limit: q.data.limit, asOf: q.data.as_of, debug: q.data.debug });
    if (!result) return void res.status(404).json({ error: "user_not_found", message: `No user with id ${id.data}` });
    res.json(result);
  });

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  });
  return app;
}
