import { redirect } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import type { Workspace } from "$lib/types";
import { getDb } from "./db/client";
import { companies, memberships, users } from "./db/schema";

export function workspaceOf(locals: App.Locals): Workspace {
  if (!locals.workspace) throw redirect(303, "/setup");
  return locals.workspace;
}

export async function loadWorkspace(userId: string): Promise<Workspace | null> {
  const [row] = await getDb()
    .select({
      role: memberships.role,
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      company: {
        id: companies.id,
        name: companies.name,
        locale: companies.locale,
        baseCurrency: companies.baseCurrency,
        fiscalYearStartMonth: companies.fiscalYearStartMonth
      }
    })
    .from(memberships)
    .innerJoin(companies, eq(memberships.companyId, companies.id))
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.userId, userId))
    .limit(1);
  if (!row) return null;
  return {
    userId: row.userId,
    userName: row.userName,
    userEmail: row.userEmail,
    role: row.role,
    company: row.company
  };
}
