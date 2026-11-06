import { DEFAULT_DB_PATH, openDb, seed } from "../src/db.js";

const db = openDb(DEFAULT_DB_PATH);
const counts = seed(db);
console.log(`Seeded ${DEFAULT_DB_PATH}:`, counts);
db.close();
