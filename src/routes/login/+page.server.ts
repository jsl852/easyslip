import { redirect } from "@sveltejs/kit";
import { authSecret, devLoginState, googleConfigured, signIn } from "$lib/server/auth";
import type { Actions, PageServerLoad } from "./$types";

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) return "/app";
  return value;
}

export const load: PageServerLoad = async (event) => {
  const redirectTo = safeNext(event.url.searchParams.get("redirectTo"));
  if (authSecret()) {
    const session = await event.locals.auth();
    if (session?.user?.id) throw redirect(303, redirectTo);
  }
  return {
    redirectTo,
    configured: Boolean(authSecret()),
    google: googleConfigured(),
    devLogin: devLoginState(),
    error: event.url.searchParams.get("error")
  };
};

export const actions: Actions = { default: signIn };
