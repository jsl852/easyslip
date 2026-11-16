import { listJournal } from "$lib/server/books";
import { getDb } from "$lib/server/db/client";
import { toCents } from "$lib/accounting/money";
import { workspaceOf } from "$lib/server/workspace";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const workspace = workspaceOf(locals);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const docType = url.searchParams.get("docType") ?? "";
  const lines = await listJournal(getDb(), workspace.company.id, { from, to, docType });
  const debit = lines.reduce((sum, line) => sum + toCents(line.debit), 0);
  const credit = lines.reduce((sum, line) => sum + toCents(line.credit), 0);
  return { from, to, docType, lines, debit, credit, balanced: debit === credit };
};
