import { fail } from "@sveltejs/kit";
import { createAccount, listAccounts, updateAccount } from "$lib/server/books";
import { getDb } from "$lib/server/db/client";
import { isUniqueViolation, publicError } from "$lib/server/errors";
import { workspaceOf } from "$lib/server/workspace";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const workspace = workspaceOf(locals);
  return { accounts: await listAccounts(getDb(), workspace.company.id) };
};

export const actions: Actions = {
  create: async (event) => {
    const workspace = workspaceOf(event.locals);
    const form = await event.request.formData();
    try {
      await createAccount(getDb(), {
        companyId: workspace.company.id,
        userId: workspace.userId,
        code: String(form.get("code") ?? ""),
        name: String(form.get("name") ?? ""),
        type: String(form.get("type") ?? ""),
        subtype: String(form.get("subtype") ?? ""),
        plGroup: String(form.get("plGroup") ?? ""),
        currency: String(form.get("currency") ?? "HKD"),
        isSettlement: form.get("isSettlement") === "on",
        employeeLabel: String(form.get("employeeLabel") ?? "")
      });
      return { message: "Account added." };
    } catch (error) {
      return fail(400, {
        message: isUniqueViolation(error) ? "That account code is already used." : publicError(error, "The account could not be added.")
      });
    }
  },
  update: async (event) => {
    const workspace = workspaceOf(event.locals);
    const form = await event.request.formData();
    try {
      await updateAccount(getDb(), {
        companyId: workspace.company.id,
        userId: workspace.userId,
        id: String(form.get("id") ?? ""),
        name: String(form.get("name") ?? ""),
        active: form.get("active") === "on",
        isSettlement: form.get("isSettlement") === "on"
      });
      return { message: "Account updated." };
    } catch (error) {
      return fail(400, { message: publicError(error, "The account could not be updated.") });
    }
  }
};
