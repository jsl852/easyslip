import { fail, redirect } from "@sveltejs/kit";
import { getTransaction, listAccounts, listCategories, updateTransaction } from "$lib/server/books";
import { getDb } from "$lib/server/db/client";
import { publicError } from "$lib/server/errors";
import { workspaceOf } from "$lib/server/workspace";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params }) => {
  const workspace = workspaceOf(locals);
  const db = getDb();
  const detail = await getTransaction(db, workspace.company.id, params.id);
  if (!detail) throw redirect(303, "/app/review");
  const [accounts, categories] = await Promise.all([
    listAccounts(db, workspace.company.id),
    listCategories(db, workspace.company.id)
  ]);
  return {
    detail,
    accounts: accounts.filter((account) => account.active && account.isSettlement),
    categories: categories.filter((category) => category.active || category.id === detail.transaction.categoryId)
  };
};

export const actions: Actions = {
  default: async (event) => {
    const workspace = workspaceOf(event.locals);
    const form = await event.request.formData();
    const intent = String(form.get("intent") ?? "save");
    const values = {
      id: event.params.id,
      type: String(form.get("type") ?? ""),
      settlementAccountId: String(form.get("settlementAccountId") ?? ""),
      categoryId: String(form.get("categoryId") ?? ""),
      txnDate: String(form.get("txnDate") ?? ""),
      merchant: String(form.get("merchant") ?? ""),
      description: String(form.get("description") ?? ""),
      amount: String(form.get("amount") ?? ""),
      reviewStatus: intent === "approve" ? "approved" as const : "needs_review" as const
    };
    try {
      await getDb().transaction(async (tx) => {
        await updateTransaction(tx, { companyId: workspace.company.id, userId: workspace.userId, ...values });
      });
    } catch (error) {
      return fail(400, { message: publicError(error, "The journal lines could not be rewritten."), values });
    }
    if (intent === "approve") {
      const detail = await getTransaction(getDb(), workspace.company.id, event.params.id);
      if (detail?.nextReviewId) throw redirect(303, `/app/transactions/${detail.nextReviewId}`);
      throw redirect(303, "/app/review");
    }
    return { message: "Journal lines updated. The entry stays in review until you approve it." };
  }
};
