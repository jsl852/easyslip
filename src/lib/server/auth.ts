import { SvelteKitAuth } from "@auth/sveltekit";
import Credentials from "@auth/sveltekit/providers/credentials";
import Google from "@auth/sveltekit/providers/google";
import { createHash, timingSafeEqual } from "node:crypto";
import { upsertUser } from "./users";

const PLACEHOLDER = "replace-with-a-random-string-at-least-32-characters";

export function authSecret(): string | null {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32 || secret === PLACEHOLDER) return null;
  return secret;
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function devLoginState(): "off" | "ready" | "misconfigured" {
  if (process.env.AUTH_DEV_LOGIN !== "true") return "off";
  return (process.env.DEV_LOGIN_PASSWORD ?? "").length >= 8 ? "ready" : "misconfigured";
}

function safeEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

export const { handle, signIn, signOut } = SvelteKitAuth(async () => {
  const providers = [];
  if (googleConfigured()) {
    providers.push(
      Google({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET
      })
    );
  }
  if (devLoginState() === "ready") {
    providers.push(
      Credentials({
        id: "development",
        name: "Development login",
        credentials: {
          email: { label: "Email", type: "email" },
          name: { label: "Name", type: "text" },
          password: { label: "Password", type: "password" }
        },
        authorize: async (credentials) => {
          const email = String(credentials?.email ?? "").trim().toLowerCase();
          const password = String(credentials?.password ?? "");
          const name = String(credentials?.name ?? "").trim();
          const expected = process.env.DEV_LOGIN_PASSWORD ?? "";
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
          if (!safeEqual(password, expected)) return null;
          const user = await upsertUser({ email, name: name || email.split("@")[0] });
          return { id: user.id, email: user.email, name: user.name };
        }
      })
    );
  }

  return {
    providers,
    secret: authSecret() ?? undefined,
    trustHost: true,
    session: { strategy: "jwt" },
    pages: { signIn: "/login", error: "/login" },
    callbacks: {
      async signIn({ user }) {
        if (!user.email) return false;
        await upsertUser({ email: user.email, name: user.name, image: user.image });
        return true;
      },
      async jwt({ token, user }) {
        const email = user?.email ?? token.email;
        if (typeof email === "string") {
          const row = await upsertUser({ email, name: user?.name, image: user?.image });
          token.sub = row.id;
          token.email = row.email;
        }
        return token;
      },
      async session({ session, token }) {
        if (session.user && typeof token.sub === "string") session.user.id = token.sub;
        return session;
      }
    }
  };
});
