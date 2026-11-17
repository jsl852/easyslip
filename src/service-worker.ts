/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from "$service-worker";

// Shell cache only. Install stores hashed JS/CSS plus static public files
// (icons, favicon, offline.html). Nothing fetched at runtime is written to Cache Storage.
//
// Not cached, and not served from cache:
// - /app, including receipt files (/app/documents/:id/file) and report downloads
// - /setup, /auth, /signout
// - SvelteKit __data requests
// - POST/PUT/PATCH/DELETE (sign-in and uploads)
// - cross-origin responses, including fonts
//
// Private and personalized navigations are network-only with cache: "no-store".
// If that fetch fails, a navigation shows /offline.html. Other failures return 503
// with no saved body. See src/lib/pwa/cache-policy.ts for the same path rules.

const sw = globalThis as unknown as ServiceWorkerGlobalScope;

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

const CACHE = `easyslip-shell-${version}`;
const PRECACHED = [...build, ...files].filter((path) => !isPrivatePath(path));

sw.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHED))
      .then(() => sw.skipWaiting())
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => sw.clients.claim())
  );
});

sw.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" && request.method !== "HEAD") return;
  const url = new URL(request.url);
  const action = cacheAction(request.method, url, sw.location.origin, PRECACHED);
  if (action === "bypass") return;
  if (action === "precache") {
    event.respondWith(fromPrecache(request));
    return;
  }
  event.respondWith(networkOnly(request));
});

async function fromPrecache(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  return fetch(request);
}

async function networkOnly(request: Request): Promise<Response> {
  try {
    return await fetch(request, { cache: "no-store" });
  } catch {
    if (request.mode === "navigate") {
      const cache = await caches.open(CACHE);
      const offline = await cache.match("/offline.html");
      if (offline) return offline;
    }
    return new Response("Offline", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}
