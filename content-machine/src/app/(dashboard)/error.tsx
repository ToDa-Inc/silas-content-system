"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

/** Catches render/data errors inside any dashboard route and keeps the sidebar usable. */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <AlertTriangle className="mb-4 h-8 w-8 text-amber-500" aria-hidden />
      <h1 className="text-base font-semibold text-app-fg">This page didn&apos;t load</h1>
      <p className="mt-2 text-xs leading-relaxed text-app-fg-muted">
        Something went wrong while loading this view. Your data is safe — try again, or head back to
        the dashboard.
      </p>
      {error.digest ? (
        <p className="mt-2 text-[10px] tabular-nums text-app-fg-faint">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-zinc-950"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-xl border border-zinc-200/90 px-4 py-2.5 text-xs font-semibold text-zinc-800 dark:border-white/15 dark:text-app-fg dark:hover:bg-zinc-800"
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
