import { fail } from "@sveltejs/kit";
import { updateCompany } from "$lib/server/books";
import { getDb } from "$lib/server/db/client";
import { publicError } from "$lib/server/errors";
import { workspaceOf } from "$lib/server/workspace";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  return { workspace: workspaceOf(locals) };
};

export const actions: Actions = {
  default: async (event) => {
    const workspace = workspaceOf(event.locals);
    const form = await event.request.formData();
    try {
      await updateCompany(getDb(), {
        companyId: workspace.company.id,
        userId: workspace.userId,
        name: String(form.get("name") ?? ""),
        fiscalYearStartMonth: Number(form.get("fiscalYearStartMonth") ?? 1)
      });
      return { message: "Company settings saved." };
    } catch (error) {
      return fail(400, { message: publicError(error, "Settings could not be saved.") });
    }
  }
};
