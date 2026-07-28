import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Tenant isolation.
 *
 * THE RULE: no query filters by userId alone. Everything is scoped by the
 * workspaceId taken from the SESSION, never from a request body or query
 * string. A client-supplied workspace id is an IDOR waiting to happen, and
 * what leaks here is someone's complete financial history.
 *
 * Route handlers and server components should reach for these helpers rather
 * than importing `prisma` directly.
 */

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = "You must be signed in.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export type Scope = {
  userId: string;
  workspaceId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
};

/** Resolves the caller's scope, or throws. */
export async function requireScope(): Promise<Scope> {
  const session = await auth();
  const user = session?.user;

  if (!user?.id || !user.workspaceId) {
    throw new UnauthorizedError();
  }

  return {
    userId: user.id,
    workspaceId: user.workspaceId,
    role: user.role,
  };
}

/** Nullable variant, for pages that render differently when signed out. */
export async function getScope(): Promise<Scope | null> {
  try {
    return await requireScope();
  } catch {
    return null;
  }
}

/**
 * Runs `fn` with the caller's scope and the Prisma client.
 *
 * The indirection is the point: it makes "which workspace am I reading?"
 * impossible to forget, because the answer is the first argument.
 */
export async function scoped<T>(
  fn: (scope: Scope, db: typeof prisma) => Promise<T>,
): Promise<T> {
  const scope = await requireScope();
  return fn(scope, prisma);
}

/**
 * Asserts that a workspace id arriving from the client matches the session.
 *
 * Use wherever an id genuinely has to be accepted from outside — never trust
 * it on its own.
 */
export function assertWorkspace(scope: Scope, candidate: string | null | undefined) {
  if (candidate && candidate !== scope.workspaceId) {
    throw new UnauthorizedError("That workspace is not yours.");
  }
}
