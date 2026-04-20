import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getCachedServerApiContext } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getCachedServerApiContext();
  if (!ctx.user) {
    const h = await headers();
    const nextPath = h.get("x-middleware-pathname")?.trim() || "/dashboard";
    redirect(`/login?next=${encodeURIComponent(nextPath.startsWith("/") ? nextPath : `/${nextPath}`)}`);
  }
  if (ctx.user && !ctx.tenancy) {
    redirect("/onboarding");
  }
  let clients: { slug: string; name: string }[] = ctx.workspaceClients ?? [];

  if (ctx.workspaceClients === null && ctx.user) {
    const supabase = await createClient();
    const { data: mem } = await supabase
      .from("organization_members")
      .select("org_id")
      .eq("user_id", ctx.user.id)
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (mem?.org_id) {
      const { data: rows } = await supabase
        .from("clients")
        .select("slug, name")
        .eq("org_id", mem.org_id)
        .order("name", { ascending: true });
      clients = rows ?? [];
    }
  }

  return (
    <DashboardShell
      clients={clients}
      activeClientSlug={ctx.clientSlug}
      orgLabel={ctx.tenancy?.orgSlug ?? ""}
    >
      {children}
    </DashboardShell>
  );
}
