import { json } from "@sveltejs/kit";
import { sql } from "drizzle-orm";
import { getDb } from "$lib/server/db/client";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async () => {
  try {
    await getDb().execute(sql`select 1`);
    return new Response("ok", { status: 200 });
  } catch {
    return json({ ok: false }, { status: 503 });
  }
};
