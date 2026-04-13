import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_CLIENT_SLUG_COOKIE } from "@/lib/workspace-cookie";

/**
 * Current creator slug from httpOnly cookie, validated for the signed-in user’s org.
 * Used by browser `clientApiContext()` (cookie is not readable from JS).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ slug: null as string | null });
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get(ACTIVE_CLIENT_SLUG_COOKIE)?.value?.trim() ?? "";
  if (!raw) {
    return NextResponse.json({ slug: null as string | null });
  }

  const { data: mem } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!mem?.org_id) {
    return NextResponse.json({ slug: null as string | null });
  }

  const { data: row } = await supabase
    .from("clients")
    .select("slug")
    .eq("org_id", mem.org_id)
    .eq("slug", raw)
    .maybeSingle();

  return NextResponse.json({ slug: row?.slug ?? null });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let slug: string;
  try {
    const b = (await request.json()) as { slug?: string };
    slug = (b.slug ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const { data: mem } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!mem?.org_id) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const { data: row } = await supabase
    .from("clients")
    .select("slug")
    .eq("org_id", mem.org_id)
    .eq("slug", slug)
    .maybeSingle();

  if (!row?.slug) {
    return NextResponse.json({ error: "Client not found in your org" }, { status: 404 });
  }

  const res = NextResponse.json({ ok: true, slug: row.slug });
  res.cookies.set(ACTIVE_CLIENT_SLUG_COOKIE, row.slug, {
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
    sameSite: "lax",
    httpOnly: true,
  });
  return res;
}
