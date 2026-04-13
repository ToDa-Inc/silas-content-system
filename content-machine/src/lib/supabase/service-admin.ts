import "server-only";

import { createClient } from "@supabase/supabase-js";
import { newProfileApiKey } from "@/lib/ids";

/**
 * Load or create `profiles.api_key` with the service role (bypasses RLS).
 * Call only after `auth.getUser()` has established `userId` for this request.
 */
export async function resolveProfileApiKeyForServer(userId: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !key) {
    return null;
  }
  const admin = createClient(url, key);
  const { data, error } = await admin
    .from("profiles")
    .select("api_key")
    .eq("id", userId)
    .maybeSingle();
  if (!error && data) {
    const raw = data.api_key;
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }
  const fresh = newProfileApiKey();
  const { error: upErr } = await admin.from("profiles").upsert(
    { id: userId, api_key: fresh },
    { onConflict: "id" },
  );
  if (upErr) {
    return null;
  }
  return fresh;
}
