// The service worker copies the marked block verbatim. Tests fail if the copies drift.
// Cached: hashed build assets and public static files (icons, favicon, offline page).
// Not cached: private pages, receipt files, report downloads, SvelteKit __data, auth, or sign-out.
// Private and personalized navigations are network-only. A failed private navigation shows the offline page.

// @cache-policy start
const PRIVATE_PREFIXES = ["/app", "/setup", "/auth", "/signout"] as const;

function isPrivatePath(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (path.includes("__data")) return true;
  return PRIVATE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function cacheAction(
  method: string,
  url: URL,
  origin: string,
  precached: readonly string[]
): "precache" | "network-only" | "public-network" | "bypass" {
  if (url.origin !== origin) return "bypass";
  if (method !== "GET" && method !== "HEAD") return "network-only";
  if (isPrivatePath(url.pathname)) return "network-only";
  if (precached.includes(url.pathname)) return "precache";
  if (url.pathname === "/" || url.pathname === "/login" || url.pathname === "/offline.html") return "public-network";
  return "network-only";
}
// @cache-policy end

export { PRIVATE_PREFIXES, cacheAction, isPrivatePath };

export function applyResponseCacheHeaders(pathname: string, headers: Headers): void {
  if (pathname === "/manifest.webmanifest") {
    headers.set("Content-Type", "application/manifest+json; charset=utf-8");
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    return;
  }
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (isPrivatePath(path) || path === "/" || path === "/login") {
    headers.set("Cache-Control", "private, no-store");
  }
}
