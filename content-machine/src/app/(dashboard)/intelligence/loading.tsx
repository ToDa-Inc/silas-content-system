/** Intelligence-specific skeleton (toolbar + grid) while this segment streams. */
export default function IntelligenceLoading() {
  return (
    <main className="mx-auto max-w-[1100px] animate-pulse px-4 py-8 md:px-8">
      <div className="mb-6 flex justify-between gap-4">
        <div className="space-y-2">
          <div className="h-6 w-36 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-3 w-28 rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <div className="h-10 w-24 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="mb-10 flex flex-wrap gap-3">
        <div className="h-9 w-40 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-9 w-32 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-9 w-28 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="mb-4 h-4 w-28 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mb-12 space-y-3">
        <div className="h-24 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-24 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="mb-4 h-4 w-44 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        <div className="h-32 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-32 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-32 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      </div>
    </main>
  );
}
