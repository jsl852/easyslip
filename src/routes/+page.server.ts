import { redirect } from "@sveltejs/kit";
import { launchDestination } from "$lib/pwa/launch";
import { loadWorkspace } from "$lib/server/workspace";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, url, locals }) => {
  const data = await parent();
  const signedIn = Boolean(data.session);
  if (url.searchParams.get("source") !== "pwa" || !signedIn) return { signedIn };
  const session = await locals.auth();
  const userId = session?.user?.id;
  const hasCompany = userId ? Boolean(await loadWorkspace(userId)) : false;
  const destination = launchDestination("pwa", Boolean(userId), hasCompany);
  if (destination) throw redirect(303, destination);
  return { signedIn };
};
