import { fail, redirect } from "@sveltejs/kit";
import { txnTypes, type TxnType } from "$lib/accounting/types";
import {
  dismissExpenseRelation,
  getExpense,
  listAccounts,
  listCategories,
  listExpenses,
  mergeExpenses,
  splitReceiptFromExpense,
  updateTransaction
} from "$lib/server/books";
import { getDb } from "$lib/server/db/client";
import { retryDocument, saveBatch } from "$lib/server/documents";
import { publicError } from "$lib/server/errors";
import { enqueueExtraction } from "$lib/server/queue";
import { workspaceOf } from "$lib/server/workspace";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params }) => {
  const workspace = workspaceOf(locals);
  const db = getDb();
  const detail = await getExpense(db, workspace.company.id, params.id);
  if (!detail) throw redirect(303, "/app/review");
  const [accounts, categories, expenses] = await Promise.all([
    listAccounts(db, workspace.company.id),
    listCategories(db, workspace.company.id),
    listExpenses(db, workspace.company.id)
  ]);
  return {
    detail,
    accounts: accounts.filter((account) => account.active && account.isSettlement),
    categories: categories.filter((category) => category.active || category.id === detail.expense.categoryId),
    mergeTargets: expenses
      .filter((expense) => expense.id !== detail.expense.id)
      .slice(0, 40)
      .map((expense) => ({
        id: expense.id,
        txnDate: expense.txnDate,
        description: expense.description,
        amount: expense.amount
      }))
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
      reviewStatus: intent === "approve" ? ("approved" as const) : ("needs_review" as const)
    };
    try {
      await getDb().transaction(async (tx) => {
        await updateTransaction(tx, { companyId: workspace.company.id, userId: workspace.userId, ...values });
      });
    } catch (error) {
      return fail(400, { message: publicError(error, "The journal lines could not be rewritten."), values });
    }
    if (intent === "approve") {
      const detail = await getExpense(getDb(), workspace.company.id, event.params.id);
      if (detail?.nextReviewId) throw redirect(303, `/app/transactions/${detail.nextReviewId}`);
      throw redirect(303, "/app/review");
    }
    return { message: "Journal lines updated. The expense stays in review until you approve it." };
  },
  attach: async (event) => {
    const workspace = workspaceOf(event.locals);
    const form = await event.request.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
    const detail = await getExpense(getDb(), workspace.company.id, event.params.id);
    if (!detail) return fail(404, { message: "Expense not found." });
    if (!(txnTypes as readonly string[]).includes(detail.expense.type)) {
      return fail(400, { message: "This expense cannot take another receipt." });
    }
    try {
      await saveBatch(getDb(), {
        companyId: workspace.company.id,
        userId: workspace.userId,
        txnType: detail.expense.type as TxnType,
        settlementAccountId: detail.expense.settlementAccountId,
        expenseId: detail.expense.id,
        files
      });
      enqueueExtraction(workspace.company.id);
      return { message: "Receipt attached. It will be read without posting a second expense." };
    } catch (error) {
      return fail(400, { message: publicError(error, "The receipt could not be attached.") });
    }
  },
  merge: async (event) => {
    const workspace = workspaceOf(event.locals);
    const sourceId = String((await event.request.formData()).get("sourceId") ?? "");
    try {
      await getDb().transaction(async (tx) => {
        await mergeExpenses(tx, {
          companyId: workspace.company.id,
          userId: workspace.userId,
          targetId: event.params.id,
          sourceId
        });
      });
      return { message: "Receipts merged onto this expense. The other journal entry was removed." };
    } catch (error) {
      return fail(400, { message: publicError(error, "Those expenses could not be merged.") });
    }
  },
  split: async (event) => {
    const workspace = workspaceOf(event.locals);
    const receiptId = String((await event.request.formData()).get("receiptId") ?? "");
    try {
      const createdId = await getDb().transaction(async (tx) =>
        splitReceiptFromExpense(tx, {
          companyId: workspace.company.id,
          userId: workspace.userId,
          expenseId: event.params.id,
          receiptId
        })
      );
      throw redirect(303, `/app/transactions/${createdId}`);
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 303) throw error;
      return fail(400, { message: publicError(error, "That receipt could not be split off.") });
    }
  },
  dismiss: async (event) => {
    const workspace = workspaceOf(event.locals);
    const relationId = String((await event.request.formData()).get("relationId") ?? "");
    try {
      await dismissExpenseRelation(getDb(), { companyId: workspace.company.id, relationId });
      return { message: "Suggestion dismissed. The expenses stay separate." };
    } catch (error) {
      return fail(400, { message: publicError(error, "Could not dismiss that suggestion.") });
    }
  },
  retry: async (event) => {
    const workspace = workspaceOf(event.locals);
    const id = String((await event.request.formData()).get("id") ?? "");
    try {
      await retryDocument(getDb(), workspace.company.id, id);
      enqueueExtraction(workspace.company.id);
      return { message: "Receipt queued again." };
    } catch (error) {
      return fail(400, { message: publicError(error, "Could not retry that receipt.") });
    }
  }
};
