import { fail, redirect } from "@sveltejs/kit";
import { fiscalPeriodStart, hongKongToday, isIsoDate } from "$lib/accounting/dates";
import { getDb } from "$lib/server/db/client";
import { publicError } from "$lib/server/errors";
import { createReport, listReports, loadLedger } from "$lib/server/reports";
import { workspaceOf } from "$lib/server/workspace";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const workspace = workspaceOf(locals);
  const today = hongKongToday();
  const fallbackFrom = fiscalPeriodStart(today, workspace.company.fiscalYearStartMonth);
  const requestedFrom = url.searchParams.get("from") ?? "";
  const requestedTo = url.searchParams.get("to") ?? "";
  const periodFrom = isIsoDate(requestedFrom) ? requestedFrom : fallbackFrom;
  const periodTo = isIsoDate(requestedTo) ? requestedTo : today;
  const db = getDb();
  const ledger = periodFrom <= periodTo ? await loadLedger(db, workspace.company.id, periodFrom, periodTo) : null;
  const jobs = await listReports(db, workspace.company.id);
  return { periodFrom, periodTo, statements: ledger?.statements ?? null, lineCount: ledger?.journal.length ?? 0, jobs };
};

export const actions: Actions = {
  default: async (event) => {
    const workspace = workspaceOf(event.locals);
    const form = await event.request.formData();
    const periodFrom = String(form.get("from") ?? "");
    const periodTo = String(form.get("to") ?? "");
    try {
      const job = await createReport(getDb(), {
        companyId: workspace.company.id,
        companyName: workspace.company.name,
        currency: workspace.company.baseCurrency,
        userId: workspace.userId,
        periodFrom,
        periodTo
      });
      throw redirect(303, `/app/reports/${job.id}/download`);
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 303) throw error;
      return fail(400, { message: publicError(error, "The workbook could not be built."), periodFrom, periodTo });
    }
  }
};
