import { fail, redirect } from "@sveltejs/kit";
import { createCompanyForUser } from "$lib/server/books";
import { getDb } from "$lib/server/db/client";
import { publicError } from "$lib/server/errors";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  const session = await event.locals.auth();
  return { email: session?.user?.email ?? "" };
};

export const actions: Actions = {
  default: async (event) => {
    const session = await event.locals.auth();
    const userId = session?.user?.id;
    if (!userId) throw redirect(303, "/login");
    const name = String((await event.request.formData()).get("name") ?? "");
    try {
      await getDb().transaction(async (tx) => {
        await createCompanyForUser(tx, { userId, name });
      });
    } catch (error) {
      return fail(400, { message: publicError(error, "The company could not be created."), name });
    }
    throw redirect(303, "/app");
  }
};
