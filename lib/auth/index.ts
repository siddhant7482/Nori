import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { env, hasGoogleAuth } from "@/lib/env";
import { verifyPassword, loginSchema } from "./password";
import { activeWorkspaceFor, ensureWorkspace } from "@/lib/workspace";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      workspaceId: string;
      role: "OWNER" | "ADMIN" | "MEMBER";
    } & DefaultSession["user"];
  }
}

// v5 moved the JWT type here; augmenting "next-auth/jwt" silently does
// nothing and leaves every token field typed as unknown.
declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    workspaceId?: string;
    role?: "OWNER" | "ADMIN" | "MEMBER";
  }
}

/**
 * A real Argon2id hash of a value nobody can supply.
 *
 * Verified against when an account does not exist, so a missing email burns
 * the same CPU time as a wrong password. Without it, sign-in latency is a
 * reliable oracle for which addresses are registered.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG";

/**
 * JWT sessions, not database sessions.
 *
 * Auth.js v5's Credentials provider only supports the JWT strategy, and
 * email/password sign-in was a requirement. The trade-off, accepted
 * deliberately: there is no server-side revocation, so a password change does
 * not invalidate already-issued sessions and there is no "sign out
 * everywhere". Adding it later is one `tokenVersion` column on User plus one
 * comparison in the jwt callback.
 *
 * The Prisma adapter stays installed so OAuth account linking persists users
 * and accounts properly wherever a provider is configured.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });

        if (!user?.passwordHash) {
          await verifyPassword(DUMMY_HASH, password);
          return null;
        }

        const ok = await verifyPassword(user.passwordHash, password);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),

    // Registered only when credentials are actually present, so the sign-in
    // page can hide the button rather than offer one that errors.
    ...(hasGoogleAuth
      ? [
          Google({
            clientId: env.AUTH_GOOGLE_ID!,
            clientSecret: env.AUTH_GOOGLE_SECRET!,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      if (!token.id) return token;

      // Resolved once at sign-in and carried in the token. Doing it per
      // request would add a database round trip to every page load.
      if (!token.workspaceId) {
        const ws = await activeWorkspaceFor(token.id);
        if (ws) {
          token.workspaceId = ws.workspace.id;
          token.role = ws.role;
        } else if (token.email) {
          // OAuth sign-ups come through the adapter and never touch the
          // registration path, so they arrive with no workspace at all.
          const created = await ensureWorkspace({
            id: token.id,
            name: token.name,
            email: token.email,
          });
          token.workspaceId = created.workspace.id;
          token.role = created.role;
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.workspaceId = token.workspaceId ?? "";
        session.user.role = token.role ?? "MEMBER";
      }
      return session;
    },
  },
});
