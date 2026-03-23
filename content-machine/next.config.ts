import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

// Monorepo: parent folder has its own package-lock.json; Turbopack otherwise resolves
// `@import "tailwindcss"` from silas-content-system/ (no tailwind there). Force app node_modules.
const appRoot = path.dirname(fileURLToPath(import.meta.url));
const tailwindPkg = path.join(appRoot, "node_modules", "tailwindcss");
const tailwindPostcss = path.join(appRoot, "node_modules", "@tailwindcss", "postcss");

const nextConfig: NextConfig = {
  turbopack: {
    root: appRoot,
    resolveAlias: {
      tailwindcss: tailwindPkg,
      "@tailwindcss/postcss": tailwindPostcss,
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
