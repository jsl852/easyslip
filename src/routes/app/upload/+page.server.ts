import { fail } from "@sveltejs/kit";
import { txnTypes, type TxnType } from "$lib/accounting/types";
import { listAccounts } from "$lib/server/books";
import { getDb } from "$lib/server/db/client";
import { listDocuments, retryDocument, saveBatch } from "$lib/server/documents";
import { publicError } from "$lib/server/errors";
import { enqueueExtraction } from "$lib/server/queue";
import { workspaceOf } from "$lib/server/workspace";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const workspace = workspaceOf(locals);
  const db = getDb();
  const accounts = await listAccounts(db, workspace.company.id);
  const documents = await listDocuments(db, workspace.company.id);
  return {
    accounts: accounts.filter((account) => account.active && account.isSettlement),
    documents
  };
};

export const actions: Actions = {
  upload: async (event) => {
    const workspace = workspaceOf(event.locals);
    const form = await event.request.formData();
    const txnType = String(form.get("txnType") ?? "");
    const settlementAccountId = String(form.get("settlementAccountId") ?? "");
    const files = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
    if (!(txnTypes as readonly string[]).includes(txnType)) return fail(400, { message: "Choose expense, purchase, or sales." });
    try {
      const saved = await saveBatch(getDb(), {
        companyId: workspace.company.id,
        userId: workspace.userId,
        txnType: txnType as TxnType,
        settlementAccountId,
        files
      });
      enqueueExtraction(workspace.company.id);
      return { message: `Queued ${saved.count} document${saved.count === 1 ? "" : "s"}. You can keep working while they are read.` };
    } catch (error) {
      return fail(400, { message: publicError(error, "The batch could not be saved.") });
    }
  },
  retry: async (event) => {
    const workspace = workspaceOf(event.locals);
    const id = String((await event.request.formData()).get("id") ?? "");
    try {
      await retryDocument(getDb(), workspace.company.id, id);
      enqueueExtraction(workspace.company.id);
      return { message: "Document queued again." };
    } catch (error) {
      return fail(400, { message: publicError(error, "Could not retry that document.") });
    }
  }
};
