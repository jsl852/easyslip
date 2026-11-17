/** Where a Home Screen launch should go. Null keeps the visitor on the site root. */
export function launchDestination(source: string | null, signedIn: boolean, hasCompany: boolean): string | null {
  if (source !== "pwa") return null;
  if (!signedIn) return null;
  return hasCompany ? "/app" : "/setup";
}
