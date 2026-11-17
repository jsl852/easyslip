import { fail } from "@sveltejs/kit";
import { matchKeyword } from "$lib/accounting/keywords";
import { createRule, deleteRule, listCategories, listRules, setRuleActive } from "$lib/server/books";
import { getDb } from "$lib/server/db/client";
import { publicError } from "$lib/server/errors";
import { workspaceOf } from "$lib/server/workspace";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const workspace = workspaceOf(locals);
  const db = getDb();
  const [rules, categories] = await Promise.all([
    listRules(db, workspace.company.id),
    listCategories(db, workspace.company.id)
  ]);
  return { rules, categories: categories.filter((category) => category.active) };
};

export const actions: Actions = {
  create: async (event) => {
    const workspace = workspaceOf(event.locals);
    const form = await event.request.formData();
    try {
      await createRule(getDb(), {
        companyId: workspace.company.id,
        userId: workspace.userId,
        pattern: String(form.get("pattern") ?? ""),
        categoryId: String(form.get("categoryId") ?? ""),
        priority: Number(form.get("priority") ?? 0)
      });
      return { message: "Rule added. It overrides the model the next time a document is read." };
    } catch (error) {
      return fail(400, { message: publicError(error, "The rule could not be added.") });
    }
  },
  toggle: async (event) => {
    const workspace = workspaceOf(event.locals);
    const form = await event.request.formData();
    await setRuleActive(getDb(), {
      companyId: workspace.company.id,
      id: String(form.get("id") ?? ""),
      active: form.get("active") === "true"
    });
    return { message: "Rule updated." };
  },
  remove: async (event) => {
    const workspace = workspaceOf(event.locals);
    const id = String((await event.request.formData()).get("id") ?? "");
    await deleteRule(getDb(), { companyId: workspace.company.id, id });
    return { message: "Rule removed." };
  },
  test: async (event) => {
    const workspace = workspaceOf(event.locals);
    const sample = String((await event.request.formData()).get("sample") ?? "");
    const rules = await listRules(getDb(), workspace.company.id);
    const categoryId = matchKeyword(
      rules.map((rule) => ({ ...rule, active: rule.active })),
      sample
    );
    const matched = rules.find((rule) => rule.categoryId === categoryId);
    return { sample, matched: matched ? matched.categoryName : "No rule matched" };
  }
};
