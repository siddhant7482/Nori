import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Nori — receipts, read automatically",
    template: "%s · Nori",
  },
  description:
    "Photograph a receipt. Nori reads it, categorises it, and files it — you just confirm.",
};

export const viewport: Viewport = {
  themeColor: "#0a0f0e",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `dark` is pinned: v1 ships dark-only. Light tokens exist in
    // globals.css so adding a toggle later is a one-line change here.
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col scrollbar-subtle">
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
