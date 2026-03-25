import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase URL/anon key — set SUPABASE_URL and SUPABASE_ANON_KEY (repo `.env` or `config/.env`). next.config maps them for the browser.",
    );
  }
  return createBrowserClient(url, key);
}
