import Link from "next/link";
import { redirect } from "next/navigation";
import { Camera } from "lucide-react";
import { Sidebar } from "@/components/app-shell/sidebar";
import { MobileNav } from "@/components/app-shell/mobile-nav";
import { UserMenu } from "@/components/app-shell/user-menu";
import { Logo } from "@/components/nori/logo";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The middleware only checks that a cookie exists. This is the real gate.
  const session = await auth();
  if (!session?.user?.id || !session.user.workspaceId) {
    redirect("/signin?callbackUrl=/app");
  }

  const reviewCount = await prisma.receipt.count({
    where: {
      workspaceId: session.user.workspaceId,
      status: "NEEDS_REVIEW",
    },
  });

  const userMenu = (
    <UserMenu
      name={session.user.name}
      email={session.user.email}
      image={session.user.image}
    />
  );

  return (
    <div className="min-h-full">
      <Sidebar reviewCount={reviewCount} userMenu={userMenu} />

      {/* Mobile top bar — the sidebar's logo slot has nowhere to live below lg */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-xl lg:hidden">
        <Link href="/app">
          <Logo />
        </Link>
        <Button size="sm" variant="ghost" className="gap-1.5" asChild>
          <Link href="/app/capture">
            <Camera className="size-4" aria-hidden />
            Capture
          </Link>
        </Button>
      </header>

      {/* pb-24 clears the bottom tab bar; lg:pb-0 drops it once the bar is gone */}
      <main className="pb-24 lg:pb-0 lg:pl-60">
        <div className="mx-auto max-w-6xl px-5 py-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>

      <MobileNav />
    </div>
  );
}
