import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyResponseCacheHeaders, cacheAction, isPrivatePath } from "../src/lib/pwa/cache-policy";
import { launchDestination } from "../src/lib/pwa/launch";
import { webAppManifest } from "../src/lib/pwa/manifest";

function policyBlock(source: string): string {
  const start = source.indexOf("// @cache-policy start");
  const end = source.indexOf("// @cache-policy end");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end).replaceAll("\r\n", "\n").trim();
}

function pngSize(path: string) {
  const buf = readFileSync(path);
  expect([...buf.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("private cache policy", () => {
  const origin = "https://easyslip-2t92.onrender.com";
  const precached = ["/icons/icon-192.png", "/offline.html", "/favicon.svg", "/_app/immutable/app.js"];

  it("keeps the service worker copy of the path rules identical", () => {
    const lib = readFileSync("src/lib/pwa/cache-policy.ts", "utf8");
    const worker = readFileSync("src/service-worker.ts", "utf8");
    expect(policyBlock(worker)).toBe(policyBlock(lib));
    expect(worker).not.toMatch(/\.put\s*\(/);
    expect(worker).toContain("cache.addAll");
    expect(worker).toContain('cache: "no-store"');
    expect(worker).toContain('request.method !== "GET" && request.method !== "HEAD"');
  });

  it("fails closed on workspace, receipt, report, auth, and data requests", () => {
    const privatePaths = [
      "/app",
      "/app/",
      "/app/upload",
      "/app/documents/abc/file",
      "/app/reports/abc/download",
      "/setup",
      "/auth/session",
      "/auth/callback/google",
      "/signout",
      "/login/__data.json",
      "/app/upload/__data.json"
    ];
    for (const path of privatePaths) {
      expect(isPrivatePath(path), path).toBe(true);
      const action = cacheAction("GET", new URL(path, origin), origin, [...precached, path]);
      expect(action, path).toBe("network-only");
    }
    expect(cacheAction("POST", new URL("/app/upload", origin), origin, precached)).toBe("network-only");
    expect(cacheAction("POST", new URL("/login", origin), origin, precached)).toBe("network-only");
  });

  it("precaches only the public shell and leaves other origins alone", () => {
    expect(cacheAction("GET", new URL("/icons/icon-192.png", origin), origin, precached)).toBe("precache");
    expect(cacheAction("GET", new URL("/offline.html", origin), origin, precached)).toBe("precache");
    expect(cacheAction("GET", new URL("/", origin), origin, precached)).toBe("public-network");
    expect(cacheAction("GET", new URL("/login", origin), origin, precached)).toBe("public-network");
    expect(cacheAction("GET", new URL("/health", origin), origin, precached)).toBe("network-only");
    expect(cacheAction("GET", new URL("/manifest.webmanifest", origin), origin, precached)).toBe("network-only");
    expect(cacheAction("GET", new URL("https://fonts.bunny.net/css", origin), origin, precached)).toBe("bypass");
    expect(isPrivatePath("/application")).toBe(false);
    expect(isPrivatePath("/_app/immutable/app.js")).toBe(false);
    expect(cacheAction("GET", new URL("/_app/immutable/app.js", origin), origin, ["/_app/immutable/app.js"])).toBe("precache");
  });

  it("marks private and personalized responses no-store, and types the manifest", () => {
    const receipt = new Headers();
    applyResponseCacheHeaders("/app/documents/abc/file", receipt);
    expect(receipt.get("Cache-Control")).toBe("private, no-store");

    const home = new Headers();
    applyResponseCacheHeaders("/", home);
    expect(home.get("Cache-Control")).toBe("private, no-store");

    const manifest = new Headers();
    applyResponseCacheHeaders("/manifest.webmanifest", manifest);
    expect(manifest.get("Content-Type")).toContain("application/manifest+json");
    expect(manifest.get("Cache-Control")).toContain("must-revalidate");

    const health = new Headers({ "Cache-Control": "custom" });
    applyResponseCacheHeaders("/health", health);
    expect(health.get("Cache-Control")).toBe("custom");
  });
});

describe("home screen launch", () => {
  it("opens the workspace when a signed-in member already has a company", () => {
    expect(launchDestination("pwa", true, true)).toBe("/app");
  });

  it("opens company setup when a signed-in member has no company", () => {
    expect(launchDestination("pwa", true, false)).toBe("/setup");
  });

  it("stays on the site root until someone is signed in", () => {
    expect(launchDestination("pwa", false, false)).toBeNull();
    expect(launchDestination("pwa", false, true)).toBeNull();
    expect(launchDestination(null, true, true)).toBeNull();
    expect(launchDestination("browser", true, true)).toBeNull();
  });
});

describe("web app manifest and icons", () => {
  it("describes a standalone EasySlip app", () => {
    const manifest = webAppManifest();
    expect(manifest.name).toBe("EasySlip");
    expect(manifest.short_name).toBe("EasySlip");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/?source=pwa");
    expect(manifest.scope).toBe("/");
    expect(manifest.background_color).toBe("#f3efe4");
    expect(manifest.theme_color).toBe("#0f5f5a");
    expect(new Set(manifest.icons.map((icon) => icon.purpose))).toEqual(new Set(["any", "maskable"]));
  });

  it("ships standard, maskable, and Apple touch icons", () => {
    expect(pngSize("static/icons/icon-192.png")).toEqual({ width: 192, height: 192 });
    expect(pngSize("static/icons/icon-512.png")).toEqual({ width: 512, height: 512 });
    expect(pngSize("static/icons/icon-maskable-192.png")).toEqual({ width: 192, height: 192 });
    expect(pngSize("static/icons/icon-maskable-512.png")).toEqual({ width: 512, height: 512 });
    expect(pngSize("static/icons/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
    expect(pngSize("static/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
    const standard = readFileSync("static/icons/icon-512.png");
    const maskable = readFileSync("static/icons/icon-maskable-512.png");
    expect(standard.equals(maskable)).toBe(false);
  });

  it("advertises the installed app from the document shell", () => {
    const html = readFileSync("src/app.html", "utf8");
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain('name="theme-color" content="#0f5f5a"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="EasySlip"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    const route = readFileSync("src/routes/manifest.webmanifest/+server.ts", "utf8");
    expect(route).toContain("webAppManifest");
    expect(route).toContain("application/manifest+json");
  });
});

describe("mobile upload markup", () => {
  it("offers the rear camera and a separate library or file picker", () => {
    const page = readFileSync("src/routes/app/upload/+page.svelte", "utf8");
    const inputs = [...page.matchAll(/<input[^>]*type="file"[^>]*>/g)].map((match) => match[0]);
    expect(inputs).toHaveLength(2);
    const camera = inputs.find((input) => input.includes('capture="environment"'));
    const library = inputs.find((input) => !input.includes("capture"));
    expect(camera).toBeTruthy();
    expect(camera).toContain('accept="image/*"');
    expect(camera).not.toContain("multiple");
    expect(library).toBeTruthy();
    expect(library).toContain("multiple");
    expect(library).toContain("application/pdf");
    expect(page).toContain("upload-dock");
  });
});
