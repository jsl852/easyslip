import { redirect, type Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import { env } from "$env/dynamic/private";
import { applyResponseCacheHeaders } from "$lib/pwa/cache-policy";
import { handle as authenticationHandle } from "$lib/server/auth";
import { loadWorkspace } from "$lib/server/workspace";

function syncPrivateEnv() {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && value.length > 0 && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

const syncHandle: Handle = async ({ event, resolve }) => {
  syncPrivateEnv();
  return resolve(event);
};

const authorizationHandle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  const needsUser = path === "/app" || path.startsWith("/app/") || path === "/setup" || path.startsWith("/setup/");
  if (!needsUser) return resolve(event);

  const session = await event.locals.auth();
  const userId = session?.user?.id;
  if (!userId) {
    const next = `${path}${event.url.search}`;
    throw redirect(303, `/login?redirectTo=${encodeURIComponent(next)}`);
  }

  const workspace = await loadWorkspace(userId);
  if (path === "/setup" || path.startsWith("/setup/")) {
    if (workspace) throw redirect(303, "/app");
    return resolve(event);
  }

  if (!workspace) throw redirect(303, "/setup");
  event.locals.workspace = workspace;
  return resolve(event);
};

const cacheHeaderHandle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  applyResponseCacheHeaders(event.url.pathname, response.headers);
  return response;
};

export const handle = sequence(cacheHeaderHandle, syncHandle, authenticationHandle, authorizationHandle);
