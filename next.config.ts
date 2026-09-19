import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Deployed by copying .next/standalone onto the node and running it under
   * systemd — no Docker, no `next start`. Same shape as the hub and Vault. */
  output: "standalone",
  poweredByHeader: false,
  /* Nori shows a bank account. Nothing may frame it, nothing it links to
   * learns where the click came from, and the browser never guesses a
   * content type. The camera stays available to Nori itself, for
   * photographing receipts later. */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
