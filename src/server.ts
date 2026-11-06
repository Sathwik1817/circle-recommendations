import { createApp } from "./app.js";
import { DEFAULT_DB_PATH, getDb } from "./db.js";

const port = Number(process.env.PORT ?? 3000);
const db = getDb(DEFAULT_DB_PATH); // seeds automatically on first run
createApp(db).listen(port, () => {
  console.log(`Circle recommendations API listening on http://localhost:${port}`);
  console.log(`Try: curl "http://localhost:${port}/users/7/recommendations"`);
});
