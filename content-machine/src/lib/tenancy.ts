import type { SupabaseClient } from "@supabase/supabase-js";

/** Org + client slugs for FastAPI headers and routes — from Supabase, not .env. */
export type ResolvedTenancy = {
  orgSlug: string;
  clientSlug: string;
};

/**
 * Resolve from the logged-in user's first org membership + a client in that org.
 * `preferredClientSlug`: cookie / UI selection when it matches a client in the org.
 * Returns null if the user has no organization_members row (needs onboarding).
 *
 * Uses two queries instead of `organizations(slug)` embed — nested selects can come back
 * empty under some RLS/PostgREST edge cases even when membership exists, which broke
 * workspace detection ("create workspace" while already onboarded).
 */
export async function resolveTenancy(
  supabase: SupabaseClient,
  userId: string | null | undefined,
  preferredClientSlug?: string | null,
): Promise<ResolvedTenancy | null> {
  if (!userId) {
    return null;
  }

  const { data: mem, error: memErr } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (memErr || !mem?.org_id) {
    return null;
  }

  const { data: orgRow, error: orgErr } = await supabase
    .from("organizations")
    .select("slug")
    .eq("id", mem.org_id)
    .maybeSingle();

  if (orgErr || !orgRow?.slug) {
    return null;
  }

  const orgSlugResolved = orgRow.slug;

  const preferred = preferredClientSlug?.trim();
  if (preferred) {
    const { data: byPref } = await supabase
      .from("clients")
      .select("slug")
      .eq("org_id", mem.org_id)
      .eq("slug", preferred)
      .maybeSingle();
    if (byPref?.slug) {
      return { orgSlug: orgSlugResolved, clientSlug: byPref.slug };
    }
  }

  const { data: cli } = await supabase
    .from("clients")
    .select("slug")
    .eq("org_id", mem.org_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!cli?.slug) {
    return { orgSlug: orgSlugResolved, clientSlug: "" };
  }

  return { orgSlug: orgSlugResolved, clientSlug: cli.slug };
}
