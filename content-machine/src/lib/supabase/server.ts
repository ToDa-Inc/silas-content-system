import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

function supabasePublicFromEnv(): { url: string; key: string } {
  // RSC runs on Node: repo-root `.env` is loaded in next.config (dotenv) → SUPABASE_* is set.
  // NEXT_PUBLIC_* comes from the same source via next.config `env` (client + some server paths).
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key =
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return { url, key };
}

export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = supabasePublicFromEnv();
  if (!url || !key) {
    throw new Error(
      "Missing Supabase URL/anon key — set SUPABASE_URL and SUPABASE_ANON_KEY in repo-root `.env` (see `.env.example`).",
    );
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          /* ignore when called from a Server Component that cannot set cookies */
        }
      },
    },
  });
}
