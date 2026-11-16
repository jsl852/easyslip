import { txnTypes, type TxnType } from "$lib/accounting/types";
import { listTransactions } from "$lib/server/books";
import { getDb } from "$lib/server/db/client";
import { workspaceOf } from "$lib/server/workspace";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const workspace = workspaceOf(locals);
  const requested = url.searchParams.get("type");
  const type = requested && (txnTypes as readonly string[]).includes(requested) ? (requested as TxnType) : undefined;
  const rows = await listTransactions(getDb(), workspace.company.id, type);
  return { type: type ?? "all", rows };
};
