import { eq } from "drizzle-orm";
import { getDb, type QueryClient } from "./db/client";
import { users } from "./db/schema";

export async function upsertUser(
  input: { email: string; name?: string | null; image?: string | null },
  db: QueryClient = getDb()
) {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    const name = input.name?.trim() || existing.name;
    const image = input.image ?? existing.image;
    if (name !== existing.name || image !== existing.image) {
      const [updated] = await db
        .update(users)
        .set({ name, image })
        .where(eq(users.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }
  const [created] = await db
    .insert(users)
    .values({
      email,
      name: input.name?.trim() || email.split("@")[0],
      image: input.image ?? null
    })
    .returning();
  return created;
}
