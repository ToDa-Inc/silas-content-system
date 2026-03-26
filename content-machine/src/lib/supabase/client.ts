import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const e = process.env;
  const url = e["NEXT_PUBLIC_SUPABASE_URL"];
  const key = e["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !key) {
    throw new Error(
      "Missing Supabase URL/anon key. Local: repo `.env` / `backend/.env`. Vercel: Environment Variables + enable Preview if you use preview URLs. GET /api/health/env to verify.",
    );
  }
  return createBrowserClient(url, key);
}
