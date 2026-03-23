import { Settings } from "lucide-react";

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
      <div className="rounded-2xl border border-outline-variant/10 bg-surface-container p-10 text-center">
        <Settings className="mx-auto mb-4 h-12 w-12 text-zinc-600" aria-hidden />
        <h1 className="text-2xl font-bold text-on-surface">Settings</h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          API status, scraper config, and thresholds — placeholder.
        </p>
      </div>
    </main>
  );
}
