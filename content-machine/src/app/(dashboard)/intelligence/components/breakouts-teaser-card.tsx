"use client";

import Link from "next/link";

type Props = {
  count: number | string;
};

export function BreakoutsTeaserCard({ count }: Props) {
  return (
    <section>
      <Link
        href="/intelligence/breakouts"
        className="group block rounded-xl border border-zinc-200/60 bg-zinc-50/40 p-5 shadow-sm transition-colors hover:border-amber-400/35 hover:bg-zinc-100/70 dark:border-white/[0.08] dark:bg-white/[0.02] dark:hover:bg-white/[0.06]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-app-fg group-hover:text-amber-700 dark:group-hover:text-amber-400">
              Competitor breakouts
            </h2>
            <p className="mt-1 text-xs text-app-fg-muted">
              Reels that beat a competitor&apos;s usual performance — view all and sync.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-700 dark:bg-white/12 dark:text-app-fg-muted">
              {count}
            </span>
            <span
              className="text-lg font-medium text-app-fg-muted transition-transform group-hover:translate-x-0.5 group-hover:text-amber-600 dark:group-hover:text-amber-400"
              aria-hidden
            >
              →
            </span>
          </div>
        </div>
      </Link>
    </section>
  );
}
