import { sql, and, eq } from "drizzle-orm";
import { enqueueExtraction } from "$lib/server/queue";
import { getDb } from "$lib/server/db/client";
import { documents, transactions } from "$lib/server/db/schema";
import { workspaceOf } from "$lib/server/workspace";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  const workspace = workspaceOf(locals);
  enqueueExtraction(workspace.company.id);
  const db = getDb();
  const [review] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.companyId, workspace.company.id), eq(transactions.reviewStatus, "needs_review")));
  const [queued] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documents)
    .where(and(eq(documents.companyId, workspace.company.id), sql`${documents.status} in ('queued', 'processing')`));
  return {
    workspace,
    counts: { review: review?.count ?? 0, queued: queued?.count ?? 0 }
  };
};
