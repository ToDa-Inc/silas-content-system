import { Database } from "lucide-react";

export default function ContextPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
      <div className="rounded-2xl border border-outline-variant/10 bg-surface-container p-10 text-center">
        <Database className="mx-auto mb-4 h-12 w-12 text-zinc-600" aria-hidden />
        <h1 className="text-2xl font-bold text-on-surface">Context</h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          Client brain: profile, memory graph, and docs — placeholder until wired to mock data.
        </p>
      </div>
    </main>
  );
}
