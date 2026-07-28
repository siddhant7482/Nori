import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp ships native binaries and tesseract.js loads WASM plus worker
  // scripts from disk at runtime. Bundling either breaks those lookups, so
  // they must stay external and be required from node_modules as-is.
  serverExternalPackages: ["sharp", "tesseract.js"],

  experimental: {
    serverActions: {
      // Receipt photos from a modern phone camera routinely exceed the 1 MB
      // default. Kept in step with MAX_UPLOAD_BYTES.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
