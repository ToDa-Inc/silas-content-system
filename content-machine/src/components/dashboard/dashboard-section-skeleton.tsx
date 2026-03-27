/** Shared pulse skeleton while a dashboard route segment loads (see `app/(dashboard)/loading.tsx`). */
export function DashboardSectionSkeleton() {
  return (
    <main className="mx-auto max-w-[1100px] animate-pulse px-4 py-8 md:px-8">
      <div className="mb-8 space-y-2">
        <div className="h-7 w-48 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-3 max-w-md rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-24 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-24 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-24 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="space-y-3">
        <div className="h-36 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-36 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-36 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      </div>
    </main>
  );
}
