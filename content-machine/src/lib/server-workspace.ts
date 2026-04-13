import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { ResolvedTenancy } from "@/lib/tenancy";

type WorkspaceOk = {
  ok: true;
  tenancy: ResolvedTenancy | null;
  clients: { slug: string; name: string }[];
};

type WorkspaceNoAdmin = { ok: false; reason: "no_service_role" };

/**
 * Resolve org + active client + full client list using the service role so RLS on
 * `clients` / `organizations` cannot hide rows from Server Components (same trust model
 * as `resolveProfileApiKeyForServer`: `userId` comes from the verified session only).
 */
export async function tryLoadServerWorkspace(
  userId: string,
  preferredClientSlug: string | null,
): Promise<WorkspaceOk | WorkspaceNoAdmin> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !key) {
    return { ok: false, reason: "no_service_role" };
  }

  const admin = createClient(url, key);

  const { data: mem, error: memErr } = await admin
    .from("organization_members")
    .select("org_id")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (memErr || !mem?.org_id) {
    return { ok: true, tenancy: null, clients: [] };
  }

  const { data: orgRow, error: orgErr } = await admin
    .from("organizations")
    .select("slug")
    .eq("id", mem.org_id)
    .maybeSingle();

  if (orgErr || !orgRow?.slug) {
    return { ok: true, tenancy: null, clients: [] };
  }

  const orgSlugResolved = orgRow.slug;

  const { data: rawClients } = await admin
    .from("clients")
    .select("slug, name, created_at")
    .eq("org_id", mem.org_id);

  const rows = rawClients ?? [];
  const withSlug = rows.filter((r) => Boolean(r.slug));

  const clients = [...withSlug]
    .map((r) => ({
      slug: r.slug,
      name: typeof r.name === "string" && r.name.trim() ? r.name : r.slug,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const preferred = preferredClientSlug?.trim();
  let clientSlug = "";
  if (preferred && withSlug.some((r) => r.slug === preferred)) {
    clientSlug = preferred;
  } else {
    const byCreated = [...withSlug].sort((a, b) => {
      const ta = String(a.created_at ?? "");
      const tb = String(b.created_at ?? "");
      return ta.localeCompare(tb);
    });
    clientSlug = byCreated[0]?.slug ?? "";
  }

  return {
    ok: true,
    tenancy: { orgSlug: orgSlugResolved, clientSlug },
    clients,
  };
}
