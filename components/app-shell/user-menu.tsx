import { LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({
  name,
  email,
  image,
}: {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}) {
  const label = name?.trim() || email || "Account";
  const initials = label
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto w-full justify-start gap-2.5 px-2 py-2"
        >
          <Avatar className="size-7">
            {image && <AvatarImage src={image} alt="" />}
            <AvatarFallback className="bg-primary/12 text-[0.625rem] font-medium text-primary">
              {initials || "N"}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-medium">{label}</span>
            <span className="block truncate text-xs text-muted-foreground">
              Personal workspace
            </span>
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium">{label}</span>
          {email && (
            <span className="block truncate text-xs text-muted-foreground">
              {email}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/app/settings">
            <Settings className="size-4" aria-hidden />
            Settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <form
          action={async () => {
            "use server";
            await signOut({ redirect: false });
            redirect("/signin");
          }}
        >
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
