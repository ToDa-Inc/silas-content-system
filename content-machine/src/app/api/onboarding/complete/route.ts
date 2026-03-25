import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { newClientId, newMemberId, newOrgId } from "@/lib/ids";
import { slugify } from "@/lib/slug";
import { ACTIVE_CLIENT_SLUG_COOKIE } from "@/lib/workspace-cookie";

type Body = {
  org_name: string;
  org_slug?: string;
  client_name: string;
  client_slug?: string;
  instagram_handle?: string;
  language?: string;
  niche_summary?: string;
  niche_keywords?: string;
};

function buildNicheConfig(summary: string | undefined, keywordsCsv: string | undefined) {
  const keywords =
    keywordsCsv
      ?.split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const desc = summary?.trim() || "Primary niche from onboarding";
  return [
    {
      id: "onboarding-primary",
      name: "Primary niche",
      description: desc,
      keywords: keywords.length ? keywords : ["content"],
      keywords_de: [] as string[],
      content_angles: [] as string[],
    },
  ];
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "Server missing SUPABASE_SERVICE_ROLE_KEY (repo-root .env)." },
      { status: 501 },
    );
  }

  const supabaseAuth = await createServerClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orgName = body.org_name?.trim();
  const clientName = body.client_name?.trim();
  if (!orgName || !clientName) {
    return NextResponse.json({ error: "org_name and client_name are required." }, { status: 400 });
  }

  const admin = createClient(url, serviceKey);

  const { data: existing } = await admin
    .from("organization_members")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "You already belong to an organization." }, { status: 409 });
  }

  /**
   * organization_members.user_id FK → profiles(id), not auth.users directly.
   * If the auth trigger never ran, membership insert fails and (previously) left an orphan org+client.
   */
  const { error: profileEnsureErr } = await admin.from("profiles").upsert(
    { id: user.id },
    { onConflict: "id" },
  );
  if (profileEnsureErr) {
    return NextResponse.json(
      { error: `Could not ensure profile row: ${profileEnsureErr.message}` },
      { status: 500 },
    );
  }

  let orgSlug = (body.org_slug?.trim() && slugify(body.org_slug)) || slugify(orgName);
  const clientSlug = (body.client_slug?.trim() && slugify(body.client_slug)) || slugify(clientName);

  const ig = body.instagram_handle?.trim().replace(/^@/, "") || null;
  const language = body.language?.trim() === "en" ? "en" : "de";
  const nicheConfig = buildNicheConfig(body.niche_summary, body.niche_keywords);

  const icp =
    body.niche_summary?.trim() ? { summary: body.niche_summary.trim(), source: "onboarding" } : {};

  for (let attempt = 0; attempt < 5; attempt++) {
    const trySlug = attempt === 0 ? orgSlug : `${orgSlug}-${attempt}`;
    const orgId = newOrgId();
    const clientId = newClientId();
    const { data: orgRow, error: orgErr } = await admin
      .from("organizations")
      .insert({
        id: orgId,
        name: orgName,
        slug: trySlug,
        plan: "agency",
      })
      .select("id")
      .single();

    if (!orgErr && orgRow) {
      orgSlug = trySlug;

      const { data: clientRow, error: clientErr } = await admin
        .from("clients")
        .insert({
          id: clientId,
          org_id: orgRow.id,
          slug: clientSlug,
          name: clientName,
          instagram_handle: ig,
          niche_config: nicheConfig,
          icp,
          products: {},
          language,
        })
        .select("slug")
        .single();

      if (clientErr || !clientRow) {
        await admin.from("organizations").delete().eq("id", orgRow.id);
        if (clientErr?.code === "23505") {
          return NextResponse.json(
            { error: "That creator URL slug is already used in this workspace. Pick another." },
            { status: 409 },
          );
        }
        return NextResponse.json(
          { error: clientErr?.message ?? "Failed to create client" },
          { status: 500 },
        );
      }

      const { error: memErr } = await admin.from("organization_members").insert({
        id: newMemberId(),
        org_id: orgRow.id,
        user_id: user.id,
        role: "owner",
      });

      if (memErr) {
        await admin.from("clients").delete().eq("org_id", orgRow.id);
        await admin.from("organizations").delete().eq("id", orgRow.id);
        return NextResponse.json(
          {
            error: `Could not add you to the workspace: ${memErr.message}. Nothing was saved — try again.`,
          },
          { status: 500 },
        );
      }

      const res = NextResponse.json({
        ok: true,
        org_slug: orgSlug,
        client_slug: clientRow.slug,
      });
      res.cookies.set(ACTIVE_CLIENT_SLUG_COOKIE, clientRow.slug, {
        path: "/",
        maxAge: 60 * 60 * 24 * 400,
        sameSite: "lax",
        httpOnly: true,
      });
      return res;
    }

    if (orgErr?.code === "23505") {
      continue;
    }
    return NextResponse.json({ error: orgErr?.message ?? "Failed to create organization" }, { status: 500 });
  }

  return NextResponse.json({ error: "Could not allocate a unique organization slug." }, { status: 409 });
}
