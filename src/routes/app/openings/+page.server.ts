import { fail } from "@sveltejs/kit";
import { toCents } from "$lib/accounting/money";
import { createOpening, deleteOpening, listAccounts, listOpenings } from "$lib/server/books";
import { getDb } from "$lib/server/db/client";
import { publicError } from "$lib/server/errors";
import { workspaceOf } from "$lib/server/workspace";
import { hongKongToday } from "$lib/accounting/dates";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const workspace = workspaceOf(locals);
  const db = getDb();
  const [rows, accounts] = await Promise.all([
    listOpenings(db, workspace.company.id),
    listAccounts(db, workspace.company.id)
  ]);
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of [...rows].sort((a, b) => a.asOf.localeCompare(b.asOf) || a.createdAt.getTime() - b.createdAt.getTime())) {
    latest.set(row.accountId, row);
  }
  const net = [...latest.values()].reduce((sum, row) => sum + toCents(row.debitBalance), 0);
  return { rows, accounts, net, today: hongKongToday() };
};

export const actions: Actions = {
  create: async (event) => {
    const workspace = workspaceOf(event.locals);
    const form = await event.request.formData();
    try {
      await createOpening(getDb(), {
        companyId: workspace.company.id,
        userId: workspace.userId,
        accountId: String(form.get("accountId") ?? ""),
        asOf: String(form.get("asOf") ?? ""),
        side: String(form.get("side") ?? ""),
        amount: String(form.get("amount") ?? ""),
        note: String(form.get("note") ?? "")
      });
      return { message: "Opening balance saved. Reports dated on or after this date will use it." };
    } catch (error) {
      return fail(400, { message: publicError(error, "The opening balance could not be saved.") });
    }
  },
  remove: async (event) => {
    const workspace = workspaceOf(event.locals);
    const id = String((await event.request.formData()).get("id") ?? "");
    await deleteOpening(getDb(), { companyId: workspace.company.id, id });
    return { message: "Opening balance removed." };
  }
};
