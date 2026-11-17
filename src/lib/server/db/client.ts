import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type QueryClient = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

let client: ReturnType<typeof postgres> | null = null;
let database: Database | null = null;

export function sslFor(url: string): "require" | false {
  const mode = process.env.DATABASE_SSL?.trim().toLowerCase();
  if (mode === "disable" || mode === "false" || mode === "off") return false;
  if (mode === "require" || mode === "true") return "require";
  if (/sslmode=(require|verify-full|verify-ca|prefer)/i.test(url)) return "require";
  return false;
}

export function getDb(): Database {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!database || !client) {
    client = postgres(url, { max: 10, ssl: sslFor(url), connect_timeout: 15 });
    database = drizzle(client, { schema });
  }
  return database;
}

export async function closeDb(): Promise<void> {
  await client?.end({ timeout: 5 });
  client = null;
  database = null;
}
