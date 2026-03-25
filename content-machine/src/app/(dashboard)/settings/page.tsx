import { KeyRound, Settings } from "lucide-react";
import { ApiKeyPanel } from "./api-key-panel";

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
      <div className="mb-10 flex items-center gap-3">
        <Settings className="h-8 w-8 text-zinc-500" aria-hidden />
        <h1 className="text-lg font-semibold text-zinc-100">Settings</h1>
      </div>

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
