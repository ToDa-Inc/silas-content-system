import { Database } from "lucide-react";

export default function ContextPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
      <div className="glass rounded-2xl border border-app-card-border p-10 text-center">
        <Database className="mx-auto mb-4 h-12 w-12 text-app-fg-muted" aria-hidden />
        <h1 className="text-lg font-semibold text-app-fg">Context</h1>
        <p className="mt-2 text-sm text-app-fg-secondary">
          Client brain: profile, memory graph, and docs — placeholder until wired to mock data.
        </p>
      </div>
    </main>
  );
}
