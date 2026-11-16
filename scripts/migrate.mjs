import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

function sslFor(connection) {
  const mode = process.env.DATABASE_SSL?.trim().toLowerCase();
  if (mode === "disable" || mode === "false" || mode === "off") return false;
  if (mode === "require" || mode === "true") return "require";
  if (/sslmode=(require|verify-full|verify-ca|prefer)/i.test(connection)) return "require";
  return false;
}

const sql = postgres(url, { max: 1, ssl: sslFor(url), connect_timeout: 20 });
const db = drizzle(sql);

try {
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("Migrations applied.");
} finally {
  await sql.end({ timeout: 5 });
}
