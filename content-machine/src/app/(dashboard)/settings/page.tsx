import { KeyRound, Settings, Sparkles } from "lucide-react";
import { fetchClient, getCachedServerApiContext } from "@/lib/api";
import { ApiKeyPanel } from "./api-key-panel";
import { NicheProfilePanel } from "./niche-profile-panel";

export default async function SettingsPage() {
  const { clientSlug, orgSlug, user, tenancy } = await getCachedServerApiContext();
  const clientRes = await fetchClient();
  const client = clientRes.ok ? clientRes.data : null;
  const syncDisabled = Boolean(
    !clientSlug.trim() || !orgSlug.trim() || (user && !tenancy),
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
      <div className="mb-10 flex items-center gap-3">
        <Settings className="h-8 w-8 text-zinc-500" aria-hidden />
        <h1 className="text-lg font-semibold text-zinc-100">Settings</h1>
      </div>

      <section className="mb-10 rounded-2xl border border-outline-variant/10 bg-surface-container p-8">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden />
          <h2 className="text-lg font-bold text-on-surface">Niche profile</h2>
        </div>
        <p className="mb-6 text-sm text-zinc-400">
          Identity keywords and hashtags used for competitor discovery and Intelligence chips. Edit by re-running
          generation after your reels change.
        </p>
        <NicheProfilePanel clientSlug={clientSlug} orgSlug={orgSlug} client={client} disabled={syncDisabled} />
      </section>

      <section className="rounded-2xl border border-outline-variant/10 bg-surface-container p-8">
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" aria-hidden />
          <h2 className="text-lg font-bold text-on-surface">API key</h2>
        </div>
        <p className="mb-6 text-sm text-zinc-400">
          Your FastAPI requests use this key with <code className="text-zinc-500">X-Org-Slug</code>.
          It lives on your <code className="text-zinc-500">profiles</code> row in Supabase.
        </p>
        <ApiKeyPanel />
      </section>
    </main>
  );
}
