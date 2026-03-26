import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

function supabasePublicFromEnv(): { url: string; key: string } {
  // Bracket keys: avoids some bundlers inlining `process.env.FOO` as undefined when FOO is only set on the host (e.g. Vercel).
  const e = process.env;
  const url = e["SUPABASE_URL"] || e["NEXT_PUBLIC_SUPABASE_URL"] || "";
  const key = e["SUPABASE_ANON_KEY"] || e["NEXT_PUBLIC_SUPABASE_ANON_KEY"] || "";
  return { url, key };
}

export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = supabasePublicFromEnv();
  if (!url || !key) {
    throw new Error(
      "Missing Supabase URL or anon key. Local: set SUPABASE_URL + SUPABASE_ANON_KEY in repo `.env` / `backend/.env`. Vercel: Project → Settings → Environment Variables — add the same for Production and Preview (use NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY if you prefer). See repo `.env.example`.",
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
