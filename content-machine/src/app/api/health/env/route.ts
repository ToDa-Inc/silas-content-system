import { connection } from "next/server";

/**
 * Quick check that Supabase env vars reach the serverless runtime (Vercel).
 * Open: GET /api/health/env — no secrets returned.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  await connection();

  const e = process.env;
  const url = e["SUPABASE_URL"] || e["NEXT_PUBLIC_SUPABASE_URL"] || "";
  const key = e["SUPABASE_ANON_KEY"] || e["NEXT_PUBLIC_SUPABASE_ANON_KEY"] || "";
  const ok = Boolean(url.length > 8 && key.length > 10);

  return Response.json({
    supabaseConfigured: ok,
    vercelEnv: e["VERCEL_ENV"] ?? null,
    hint: ok
      ? null
      : "Vercel → Project → Environment Variables: add SUPABASE_URL + SUPABASE_ANON_KEY (or NEXT_PUBLIC_*). Enable Production and Preview, save, redeploy.",
  });
}
