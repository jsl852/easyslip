import { fail } from "@sveltejs/kit";
import { createCategory, listAccounts, listCategories, updateCategory } from "$lib/server/books";
import { getDb } from "$lib/server/db/client";
import { isUniqueViolation, publicError } from "$lib/server/errors";
import { workspaceOf } from "$lib/server/workspace";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const workspace = workspaceOf(locals);
  const db = getDb();
  const [categories, accounts] = await Promise.all([
    listCategories(db, workspace.company.id),
    listAccounts(db, workspace.company.id)
  ]);
  return {
    categories,
    accounts: accounts.filter((account) => account.type === "revenue" || account.type === "expense")
  };
};

export const actions: Actions = {
  create: async (event) => {
    const workspace = workspaceOf(event.locals);
    const form = await event.request.formData();
    try {
      await createCategory(getDb(), {
        companyId: workspace.company.id,
        userId: workspace.userId,
        name: String(form.get("name") ?? ""),
        kind: String(form.get("kind") ?? ""),
        accountId: String(form.get("accountId") ?? "")
      });
      return { message: "Category added." };
    } catch (error) {
      return fail(400, {
        message: isUniqueViolation(error) ? "That category name is already used." : publicError(error, "The category could not be added.")
      });
    }
  },
  update: async (event) => {
    const workspace = workspaceOf(event.locals);
    const form = await event.request.formData();
    try {
      await updateCategory(getDb(), {
        companyId: workspace.company.id,
        userId: workspace.userId,
        id: String(form.get("id") ?? ""),
        name: String(form.get("name") ?? ""),
        kind: String(form.get("kind") ?? ""),
        accountId: String(form.get("accountId") ?? ""),
        active: form.get("active") === "on"
      });
      return { message: "Category updated." };
    } catch (error) {
      return fail(400, { message: publicError(error, "The category could not be updated.") });
    }
  }
};
