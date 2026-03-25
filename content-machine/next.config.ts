import type { NextConfig } from "next";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(appRoot, "..");

// Same cascade as the Python API: root .env → config/.env → app overrides.
dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, "config", ".env"), override: true });
dotenv.config({ path: path.join(appRoot, ".env.local"), override: true });

// Next only inlines NEXT_PUBLIC_* from .env files into the browser. We keep a single
// source of truth (SUPABASE_* / CONTENT_API_URL) and inject public aliases here.
const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnon =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const contentApiBase =
  process.env.NEXT_PUBLIC_CONTENT_API_URL ||
  process.env.CONTENT_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "";

// Monorepo: parent folder has its own package-lock.json; Turbopack otherwise resolves
// `@import "tailwindcss"` from monorepo root without tailwind — force app node_modules.
const tailwindPkg = path.join(appRoot, "node_modules", "tailwindcss");
const tailwindPostcss = path.join(appRoot, "node_modules", "@tailwindcss", "postcss");

const backendOrigin =
  process.env.CONTENT_API_URL ||
  process.env.NEXT_PUBLIC_CONTENT_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://127.0.0.1:8787";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/backend/:path*",
        destination: `${backendOrigin.replace(/\/$/, "")}/:path*`,
      },
    ];
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnon,
    ...(contentApiBase
      ? { NEXT_PUBLIC_CONTENT_API_URL: contentApiBase }
      : {}),
  },
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
