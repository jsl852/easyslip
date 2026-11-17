import { authSecret } from "$lib/server/auth";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async (event) => {
  if (!authSecret()) return { session: null, authConfigured: false };
  const session = await event.locals.auth();
  return {
    session: session?.user?.id ? { name: session.user.name ?? null, email: session.user.email ?? null } : null,
    authConfigured: true
  };
};
