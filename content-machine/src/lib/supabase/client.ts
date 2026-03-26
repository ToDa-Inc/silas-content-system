import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  // Direct `process.env.NEXT_PUBLIC_*` so Next can inline; `process.env` + bracket keys leaves `process` in the browser bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase URL/anon key. Local: repo `.env` / `backend/.env`. Vercel: Environment Variables + enable Preview if you use preview URLs. GET /api/health/env to verify.",
    );
  }
  return createBrowserClient(url, key);
}
