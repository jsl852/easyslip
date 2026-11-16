import { fail, redirect } from "@sveltejs/kit";
import { hongKongToday } from "$lib/accounting/dates";
import { createManualTransaction, listAccounts, listCategories } from "$lib/server/books";
import { getDb } from "$lib/server/db/client";
import { publicError } from "$lib/server/errors";
import { workspaceOf } from "$lib/server/workspace";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const workspace = workspaceOf(locals);
  const db = getDb();
  const [accounts, categories] = await Promise.all([
    listAccounts(db, workspace.company.id),
    listCategories(db, workspace.company.id)
  ]);
  return {
    today: hongKongToday(),
    accounts: accounts.filter((account) => account.active && account.isSettlement),
    categories: categories.filter((category) => category.active)
  };
};

export const actions: Actions = {
  default: async (event) => {
    const workspace = workspaceOf(event.locals);
    const form = await event.request.formData();
    const values = {
      type: String(form.get("type") ?? ""),
      settlementAccountId: String(form.get("settlementAccountId") ?? ""),
      categoryId: String(form.get("categoryId") ?? ""),
      txnDate: String(form.get("txnDate") ?? ""),
      merchant: String(form.get("merchant") ?? ""),
      description: String(form.get("description") ?? ""),
      amount: String(form.get("amount") ?? "")
    };
    try {
      const id = await getDb().transaction(async (tx) =>
        createManualTransaction(tx, { companyId: workspace.company.id, userId: workspace.userId, ...values })
      );
      throw redirect(303, `/app/transactions/${id}`);
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 303) throw error;
      return fail(400, { message: publicError(error, "The line could not be posted."), values });
    }
  }
};
