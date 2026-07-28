import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CATEGORIES } from "@/lib/categories";

type Tx = Prisma.TransactionClient | PrismaClient;

/** "Jane Doe" -> "jane-doe-k3f9x". Random suffix avoids collisions. */
function slugify(input: string): string {
  const base =
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "workspace";
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Creates a personal workspace, its owner membership, and the seeded category
 * set for a brand-new user.
 *
 * Must run inside the same transaction as the user insert. A user with no
 * workspace can sign in but every scoped query returns nothing, which presents
 * as a silently empty app rather than as an error — the worst kind of bug to
 * diagnose from a support message.
 */
export async function bootstrapWorkspace(
  tx: Tx,
  user: { id: string; name?: string | null; email: string },
  currency = "GBP",
) {
  const label = user.name?.trim() || user.email.split("@")[0];

  const workspace = await tx.workspace.create({
    data: {
      name: `${label}'s workspace`,
      slug: slugify(label),
      personal: true,
      currency,
      members: {
        create: { userId: user.id, role: "OWNER" },
      },
      categories: {
        create: CATEGORIES.map((c, i) => ({
          slug: c.slug,
          name: c.name,
          icon: c.icon,
          chart: c.chart,
          isSystem: true,
          sortOrder: i,
        })),
      },
    },
  });

  return workspace;
}

/**
 * The active workspace for a user.
 *
 * v1 has no switcher, so this is simply their first membership. It exists as
 * a function rather than an inlined query so that adding a switcher later
 * means changing one place.
 */
export async function activeWorkspaceFor(userId: string) {
  const membership = await prisma.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { workspace: true },
  });
  return membership
    ? { workspace: membership.workspace, role: membership.role }
    : null;
}

/**
 * Self-heals a user who somehow has no workspace.
 *
 * Reachable if an OAuth sign-in created the user through the adapter without
 * going through the registration path. Cheap insurance against the silently
 * empty app described above.
 */
export async function ensureWorkspace(user: {
  id: string;
  name?: string | null;
  email: string;
}) {
  const existing = await activeWorkspaceFor(user.id);
  if (existing) return existing;

  const workspace = await prisma.$transaction((tx) =>
    bootstrapWorkspace(tx, user),
  );
  return { workspace, role: "OWNER" as const };
}
