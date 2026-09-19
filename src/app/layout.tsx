import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Sans, Unbounded } from "next/font/google";
import "./globals.css";

/* Self-hosted through next/font rather than a <link> to Google. The node
 * sits behind Tailscale and will sometimes have no route to the open
 * internet; a page whose type does not load looks broken for a reason
 * that has nothing to do with it. */
const display = Unbounded({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-display", display: "swap" });
const body = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Nori",
  description: "Money for CommandHQ, payday to payday.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#07231b",
  colorScheme: "light",
  viewportFit: "cover",
};

/* Only the page itself here. The frame, with its ticker full of money,
 * belongs to the signed-in routes in (app)/layout.tsx; the login page
 * must not render any of it. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
