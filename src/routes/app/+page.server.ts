import { dashboard } from "$lib/server/books";
import { getDb } from "$lib/server/db/client";
import { loadLedger } from "$lib/server/reports";
import { workspaceOf } from "$lib/server/workspace";
import { fiscalPeriodStart, hongKongToday, monthStart } from "$lib/accounting/dates";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const workspace = workspaceOf(locals);
  const today = hongKongToday();
  const from = monthStart(today);
  const db = getDb();
  const snapshot = await dashboard(db, workspace.company.id, from, today);
  const { statements } = await loadLedger(db, workspace.company.id, from, today);
  const yearFrom = fiscalPeriodStart(today, workspace.company.fiscalYearStartMonth);
  return {
    today,
    from,
    yearFrom,
    snapshot,
    netIncomeCents: statements.profitAndLoss.netIncomeCents,
    balanceCheckCents: statements.balanceSheet.balanceCheckCents,
    journalsBalanced: statements.totals.balanced
  };
};
