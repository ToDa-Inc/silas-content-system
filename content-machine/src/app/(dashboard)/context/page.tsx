import { Database } from "lucide-react";
import { fetchClient, getCachedServerApiContext } from "@/lib/api";
import { ContextEditor } from "./context-editor";

export default async function ContextPage() {
  const { clientSlug, orgSlug, user, tenancy } = await getCachedServerApiContext();
  const clientRes = await fetchClient();
  const client = clientRes.ok ? clientRes.data : null;
  const disabled = Boolean(
    !clientSlug.trim() || !orgSlug.trim() || (user && !tenancy),
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-6">
      <div className="mb-8 flex items-center gap-3">
        <Database className="h-8 w-8 text-zinc-500" aria-hidden />
        <div>
          <h1 className="text-lg font-semibold text-app-fg">Context</h1>
          <p className="mt-1 text-sm text-app-fg-secondary">
            Transcript and strategy sections below feed your AI profile — what Silas uses to
            understand this creator for reel analysis (and future generators).
          </p>
        </div>
      </div>

      {user && !tenancy ? (
        <p className="mb-6 text-sm text-app-fg-muted">
          We can&apos;t see a workspace for this login. Finish onboarding or check your organization membership.
        </p>
      ) : null}

      {!clientRes.ok ? (
        <p className="text-sm text-app-fg-muted">
          {clientRes.error ?? "Couldn't load client. Try refreshing."}
        </p>
      ) : (
        <ContextEditor
          clientSlug={clientSlug}
          orgSlug={orgSlug}
          initialContext={client?.client_context}
          initialClientDna={client?.client_dna}
          disabled={disabled}
        />
      )}
    </main>
  );
}
